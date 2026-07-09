#include "OleEditSession.h"
#include "JsonHelper.h"
#include "NativeLog.h"
#include "Win32Check.h"
#include "OleFormulaIds.h"

#include <atomic>
#include <chrono>
#include <string>
#include <thread>
#include <vector>
#include <rpc.h>  // UuidCreate
#include <aclapi.h>  // SetEntriesInAclW
#include <shellapi.h>  // ShellExecuteExW

#pragma comment(lib, "rpcrt4.lib")
#pragma comment(lib, "advapi32.lib")

// g_dllModule is set by DllMain in OleFormulaHandlerModule.cpp
// Must be at file scope (not inside anonymous namespace) to have external linkage.
extern HMODULE g_dllModule;

namespace
{

// Forward declarations
std::wstring FindDesktopPath();

// ConnectNamedPipe with timeout (milliseconds).
// Returns true if connected, false on timeout/error.
bool ConnectNamedPipeWithTimeout(HANDLE pipe, DWORD timeoutMs)
{
    // Use overlapped ConnectNamedPipe with event for timeout support
    HANDLE event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (event == nullptr)
        return false;

    OVERLAPPED overlapped{};
    overlapped.hEvent = event;

    BOOL connected = ConnectNamedPipe(pipe, &overlapped);
    if (connected)
    {
        // Connected synchronously (unlikely but possible with a pending connection)
        CloseHandle(event);
        return true;
    }

    DWORD error = GetLastError();
    if (error == ERROR_PIPE_CONNECTED)
    {
        // Client already connected before we called ConnectNamedPipe
        CloseHandle(event);
        return true;
    }

    if (error != ERROR_IO_PENDING)
    {
        // Real error
        CloseHandle(event);
        return false;
    }

    // Wait for connection or timeout
    DWORD waitResult = WaitForSingleObject(event, timeoutMs);
    if (waitResult == WAIT_OBJECT_0)
    {
        // Connected
        DWORD bytesTransferred = 0;
        GetOverlappedResult(pipe, &overlapped, &bytesTransferred, FALSE);
        CloseHandle(event);
        return true;
    }

    // Timeout — cancel the pending operation
    CancelIo(pipe);
    CloseHandle(event);
    SetLastError(ERROR_TIMEOUT);
    return false;
}

std::wstring GenerateSessionToken()
{
    UUID uuid;
    UuidCreate(&uuid);
    RPC_WSTR str;
    UuidToStringW(&uuid, &str);
    std::wstring result(reinterpret_cast<const wchar_t*>(str));
    RpcStringFreeW(&str);
    return result;
}

// Build the JSON envelope string from current presentation state.
std::wstring JsonEscapeString(const std::wstring& input)
{
    std::wstring result;
    result.reserve(input.size() + 8);
    for (wchar_t ch : input)
    {
        switch (ch)
        {
        case L'"':  result += L"\\\""; break;
        case L'\\': result += L"\\\\"; break;
        case L'\n': result += L"\\n";  break;
        case L'\r': result += L"\\r";  break;
        case L'\t': result += L"\\t";  break;
        default:
            if (static_cast<unsigned>(ch) < 0x20)
            {
                // Control characters: encode as \u00XX
                wchar_t buf[8];
                swprintf_s(buf, L"\\u%04x", static_cast<unsigned>(ch));
                result += buf;
            }
            else
            {
                result += ch;
            }
            break;
        }
    }
    return result;
}

std::wstring BuildEnvelopeJson(const std::wstring& formulaId,
                                const FormulaPresentation& presentation,
                                int revision)
{
    // Convert HIMETRIC to points (1 pt = 1/72 inch, 1 HIMETRIC = 0.01 mm)
    int widthPt = static_cast<int>((static_cast<long long>(presentation.himetricSize.cx) * 72 + 1270) / 2540);
    int heightPt = static_cast<int>((static_cast<long long>(presentation.himetricSize.cy) * 72 + 1270) / 2540);
    if (widthPt <= 0) widthPt = 180;
    if (heightPt <= 0) heightPt = 42;

    std::wstring json;
    json += L"{\"protocolVersion\":2,";
    json += L"\"sessionType\":\"ole_edit_request\",";
    json += L"\"formulaId\":\"" + JsonEscapeString(formulaId) + L"\",";

    // Include full payloadJson if available (preserves omml, render, presentation, source etc.)
    if (!presentation.payloadJson.empty())
    {
        // Use the canonical payload JSON directly instead of individual fields.
        // The Rust side parses this and passes the full FormulaPayload to the frontend.
        // To avoid double-escaping, embed it as a raw JSON object value.
        json += L"\"payloadJson\":";
        json += presentation.payloadJson;
        json += L",";
        json += L"\"latex\":\"" + JsonEscapeString(presentation.latex) + L"\",";
        json += L"\"widthPt\":" + std::to_wstring(widthPt) + L",";
        json += L"\"heightPt\":" + std::to_wstring(heightPt) + L",";
        json += L"\"schemaVersion\":3,";
        json += L"\"revision\":" + std::to_wstring(revision);
    }
    else
    {
        json += L"\"latex\":\"" + JsonEscapeString(presentation.latex) + L"\",";
        json += L"\"widthPt\":" + std::to_wstring(widthPt) + L",";
        json += L"\"heightPt\":" + std::to_wstring(heightPt) + L",";
        json += L"\"schemaVersion\":3,";
        json += L"\"revision\":" + std::to_wstring(revision);
    }

    json += L"}";
    return json;
}

// Find LaTeXSnipper Desktop executable path.
// Derives the exe path from the OLE DLL's own module location,
// avoiding hardcoded registry keys (which may not exist for Tauri packages).
//   DLL: <root>\resources\NativeOffice\OleFormulaObject.x64.dll
//   EXE: <root>\LaTeXSnipper.exe
std::wstring FindDesktopPath()
{
    // Priority 1: Registry InstallPath (written by Rust register_install_path())
    // This is the most reliable location for production installs.
    {
        wchar_t basePath[MAX_PATH];
        HKEY keys[] = {HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        for (auto root : keys)
        {
            DWORD size = sizeof(basePath);
            if (RegGetValueW(root, L"Software\\LaTeXSnipper", L"InstallPath",
                             RRF_RT_REG_SZ, nullptr, basePath, &size) == ERROR_SUCCESS)
            {
                static const wchar_t* exeNames[] = {
                    L"LaTeXSnipper Office.exe",
                    L"LaTeXSnipper.exe",
                    L"LaTeXSnipper-Office.exe",
                    L"latexsnipper-office.exe",
                };
                for (auto name : exeNames)
                {
                    std::wstring exe = std::wstring(basePath) + L"\\" + name;
                    if (GetFileAttributesW(exe.c_str()) != INVALID_FILE_ATTRIBUTES)
                    {
                        WriteNativeOleLog(L"FindDesktopPath: found via registry InstallPath");
                        return exe;
                    }
                }
            }
        }
    }

    // Priority 2: DLL relative path (dev / portable builds)
    {
        wchar_t dllPath[MAX_PATH];
        DWORD len = GetModuleFileNameW(g_dllModule, dllPath, MAX_PATH);
        if (len > 0 && len < MAX_PATH)
        {
            std::wstring path(dllPath, len);

            // Walk up from DLL to find the application root.
            // DLL: <root>\resources\NativeOffice\OleFormulaObject.x64.dll
            for (int i = 0; i < 3; ++i)
            {
                size_t pos = path.find_last_of(L"\\/");
                if (pos == std::wstring::npos)
                    break;
                path = path.substr(0, pos);
            }

            static const wchar_t* exeNames[] = {
                L"LaTeXSnipper Office.exe",
                L"LaTeXSnipper.exe",
                L"LaTeXSnipper-Office.exe",
                L"latexsnipper-office.exe",
            };
            for (auto name : exeNames)
            {
                std::wstring exe = path + L"\\" + name;
                if (GetFileAttributesW(exe.c_str()) != INVALID_FILE_ATTRIBUTES)
                {
                    WriteNativeOleLog(L"FindDesktopPath: found via DLL relative path");
                    return exe;
                }
            }
        }
    }

    // Priority 3: Windows App Paths in registry
    {
        static const wchar_t* appNames[] = {
            L"LaTeXSnipper Office.exe",
            L"LaTeXSnipper.exe",
            L"LaTeXSnipper-Office.exe",
        };
        for (auto appName : appNames)
        {
            std::wstring keyPath = std::wstring(L"Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\") + appName;
            wchar_t exePath[MAX_PATH];
            DWORD size = sizeof(exePath);
            if (RegGetValueW(HKEY_LOCAL_MACHINE, keyPath.c_str(), nullptr,
                             RRF_RT_REG_SZ, nullptr, exePath, &size) == ERROR_SUCCESS)
            {
                if (GetFileAttributesW(exePath) != INVALID_FILE_ATTRIBUTES)
                {
                    WriteNativeOleLog(L"FindDesktopPath: found via App Paths");
                    return std::wstring(exePath);
                }
            }
        }
    }

    // Priority 4: Absolute PATH fallback
    WriteNativeOleLog(L"FindDesktopPath: fallback to PATH");
    return L"LaTeXSnipper.exe";
}

} // anonymous namespace

// Create SECURITY_ATTRIBUTES with DACL allowing only the current user.
// Caller must free the returned pointer via HeapFree() after use.
static SECURITY_ATTRIBUTES* CreateCurrentUserOnlySecurityAttributes()
{
    HANDLE token = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token))
        return nullptr;

    DWORD tokenInfoLength = 0;
    GetTokenInformation(token, TokenUser, nullptr, 0, &tokenInfoLength);
    if (tokenInfoLength == 0)
    {
        CloseHandle(token);
        return nullptr;
    }

    auto* tokenUser = static_cast<TOKEN_USER*>(HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, tokenInfoLength));
    if (tokenUser == nullptr)
    {
        CloseHandle(token);
        return nullptr;
    }

    if (!GetTokenInformation(token, TokenUser, tokenUser, tokenInfoLength, &tokenInfoLength))
    {
        CloseHandle(token);
        HeapFree(GetProcessHeap(), 0, tokenUser);
        return nullptr;
    }
    CloseHandle(token);

    // Build EXPLICIT_ACCESS granting full control to the user's SID
    EXPLICIT_ACCESS_W explicitAccess{};
    explicitAccess.grfAccessPermissions = GENERIC_ALL;
    explicitAccess.grfAccessMode = GRANT_ACCESS;
    explicitAccess.grfInheritance = NO_INHERITANCE;
    explicitAccess.Trustee.TrusteeForm = TRUSTEE_IS_SID;
    explicitAccess.Trustee.TrusteeType = TRUSTEE_IS_USER;
    explicitAccess.Trustee.ptstrName = reinterpret_cast<LPWCH>(tokenUser->User.Sid);

    PACL acl = nullptr;
    DWORD result = SetEntriesInAclW(1, &explicitAccess, nullptr, &acl);
    if (result != ERROR_SUCCESS)
    {
        HeapFree(GetProcessHeap(), 0, tokenUser);
        return nullptr;
    }

    auto* sa = static_cast<SECURITY_ATTRIBUTES*>(HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(SECURITY_ATTRIBUTES)));
    if (sa == nullptr)
    {
        LocalFree(acl);
        HeapFree(GetProcessHeap(), 0, tokenUser);
        return nullptr;
    }

    auto* sd = static_cast<SECURITY_DESCRIPTOR*>(HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, SECURITY_DESCRIPTOR_MIN_LENGTH));
    if (sd == nullptr)
    {
        LocalFree(acl);
        HeapFree(GetProcessHeap(), 0, sa);
        HeapFree(GetProcessHeap(), 0, tokenUser);
        return nullptr;
    }

    InitializeSecurityDescriptor(sd, SECURITY_DESCRIPTOR_REVISION);
    SetSecurityDescriptorDacl(sd, TRUE, acl, FALSE);

    sa->nLength = sizeof(SECURITY_ATTRIBUTES);
    sa->lpSecurityDescriptor = sd;
    sa->bInheritHandle = FALSE;

    HeapFree(GetProcessHeap(), 0, tokenUser);
    return sa;
}

static void FreeSecurityAttributes(SECURITY_ATTRIBUTES* sa)
{
    if (sa == nullptr) return;
    if (sa->lpSecurityDescriptor)
    {
        auto* sd = static_cast<SECURITY_DESCRIPTOR*>(sa->lpSecurityDescriptor);
        BOOL hasDacl = FALSE;
        PACL acl = nullptr;
        BOOL defaulted = FALSE;
        if (GetSecurityDescriptorDacl(sd, &hasDacl, &acl, &defaulted) && hasDacl && acl)
        {
            LocalFree(acl);
        }
        HeapFree(GetProcessHeap(), 0, sd);
    }
    HeapFree(GetProcessHeap(), 0, sa);
}

// ReadFile with timeout (overlapped I/O).
// Returns true if read completed, false on timeout/error.
static bool ReadFileWithTimeout(HANDLE pipe, void* buffer, DWORD bytesToRead, DWORD* bytesRead, DWORD timeoutMs)
{
    HANDLE event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (event == nullptr)
        return false;

    OVERLAPPED overlapped{};
    overlapped.hEvent = event;

    BOOL result = ReadFile(pipe, buffer, bytesToRead, bytesRead, &overlapped);
    if (result)
    {
        // Completed synchronously
        CloseHandle(event);
        return true;
    }

    if (GetLastError() != ERROR_IO_PENDING)
    {
        CloseHandle(event);
        return false;
    }

    // Wait for completion or timeout
    DWORD waitResult = WaitForSingleObject(event, timeoutMs);
    if (waitResult == WAIT_OBJECT_0)
    {
        GetOverlappedResult(pipe, &overlapped, bytesRead, FALSE);
        CloseHandle(event);
        return true;
    }

    // Timeout — cancel pending operation
    CancelIo(pipe);
    CloseHandle(event);
    SetLastError(ERROR_TIMEOUT);
    return false;
}

HRESULT StartEditSessionPipe(const std::wstring& formulaId,
                              FormulaPresentation* presentation,
                              HWND parentWindow)
{
    if (presentation == nullptr)
        return E_POINTER;

    WriteNativeOleLog(L"OleEditSession: Starting pipe server...");

    // 1. Generate unique session token
    std::wstring token = GenerateSessionToken();
    std::wstring pipeName = std::wstring(kOleEditPipePrefix) + token;

    // 2. Build envelope JSON with real size and revision from payload
    int revision = 0;
    if (!presentation->payloadJson.empty())
    {
        double rev = ExtractJsonNumber(presentation->payloadJson, L"revision");
        if (rev > 0) revision = static_cast<int>(rev);
    }
    std::wstring envelope = BuildEnvelopeJson(formulaId, *presentation, revision);
    DWORD envelopeSize = static_cast<DWORD>((envelope.size() + 1) * sizeof(wchar_t));

    // 3. Create Named Pipe Server (single instance, current user only, overlapped for timeout)
    SECURITY_ATTRIBUTES* pipeSa = CreateCurrentUserOnlySecurityAttributes();
    HANDLE pipe = CreateNamedPipeW(
        pipeName.c_str(),
        PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
        PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
        1,                    // max instances
        65536,                // out buffer
        65536,                // in buffer
        5000,                 // default timeout ms
        pipeSa                // security: current user only
    );

    if (pipeSa != nullptr)
    {
        FreeSecurityAttributes(pipeSa);
    }

    if (pipe == INVALID_HANDLE_VALUE)
    {
        WriteNativeOleLog(L"OleEditSession: CreateNamedPipe failed.");
        return HResultFromWin32LastError();
    }

    // WriteNativeOleLog(L"OleEditSession: Pipe created, launching Desktop...");

    // 4. Launch Desktop app with pipe name as argument
    std::wstring desktopPath = FindDesktopPath();
    std::wstring args = L"--ole-edit \"" + pipeName + L"\"";

    SHELLEXECUTEINFOW sei = {sizeof(sei)};
    sei.fMask = SEE_MASK_NOCLOSEPROCESS;
    sei.hwnd = parentWindow;
    sei.lpVerb = L"open";
    sei.lpFile = desktopPath.c_str();
    sei.lpParameters = args.c_str();
    sei.nShow = SW_SHOWNORMAL;

    if (!ShellExecuteExW(&sei))
    {
        WriteNativeOleLog(L"OleEditSession: Failed to launch Desktop.");
        CloseHandle(pipe);
        return HResultFromWin32LastError();
    }

    // 5. Wait for Desktop to connect with 60-second timeout
    // Use overlapped I/O for timeout support to avoid blocking Office UI thread
    BOOL connected = ConnectNamedPipeWithTimeout(pipe, 60000);
    if (!connected)
    {
        DWORD err = GetLastError();
        WriteNativeOleLog(err == ERROR_TIMEOUT
            ? L"OleEditSession: Desktop did not connect within 60s timeout."
            : L"OleEditSession: Desktop connection failed.");
        CloseHandle(pipe);
        return err == ERROR_TIMEOUT ? HRESULT_FROM_WIN32(ERROR_TIMEOUT) : HResultFromWin32LastError();
    }

    WriteNativeOleLog(L"OleEditSession: Desktop connected.");

    // 6. Send envelope to Desktop
    DWORD written = 0;
    // Send size first, then payload
    if (!WriteFile(pipe, &envelopeSize, sizeof(envelopeSize), &written, nullptr))
    {
        WriteNativeOleLog(L"OleEditSession: Failed to send size.");
        CloseHandle(pipe);
        return HResultFromWin32LastError();
    }

    if (!WriteFile(pipe, envelope.c_str(), envelopeSize, &written, nullptr))
    {
        WriteNativeOleLog(L"OleEditSession: Failed to send envelope.");
        CloseHandle(pipe);
        return HResultFromWin32LastError();
    }

    // 7. Wait for response from Desktop (SAVE / CANCEL) with 10-minute total timeout
    // Response format: 4 bytes = response size, then response JSON (UTF-16)
    constexpr DWORD kEditTotalTimeoutMs = 600000; // 10 minutes
    DWORD responseSize = 0;
    DWORD readBytes = 0;
    if (!ReadFileWithTimeout(pipe, &responseSize, sizeof(responseSize), &readBytes, kEditTotalTimeoutMs))
    {
        WriteNativeOleLog(L"OleEditSession: Timed out waiting for response size.");
        CloseHandle(pipe);
        return HRESULT_FROM_WIN32(ERROR_TIMEOUT);
    }

    // Response body limit: support full FormulaPayload including PNG/SVG base64
    if (responseSize == 0 || responseSize > 4 * 1024 * 1024)
    {
        // Empty response = cancel; oversized = protocol error
        if (responseSize == 0)
        {
            WriteNativeOleLog(L"OleEditSession: Empty response (cancel).");
            CloseHandle(pipe);
            return S_FALSE;
        }
        WriteNativeOleLog(L"OleEditSession: Response too large.");
        CloseHandle(pipe);
        return E_FAIL;
    }

    std::vector<wchar_t> responseBuffer(responseSize / sizeof(wchar_t) + 1, 0);
    if (!ReadFileWithTimeout(pipe, responseBuffer.data(), responseSize, &readBytes, kEditTotalTimeoutMs))
    {
        WriteNativeOleLog(L"OleEditSession: Failed to read response.");
        CloseHandle(pipe);
        return HResultFromWin32LastError();
    }

    std::wstring response(responseBuffer.data());

    // 8. Parse response using JsonHelper (nlohmann/json if available, else fallback)
    std::wstring action = JsonReadString(response, L"action");
    bool isSave = (action == L"save");

    if (isSave)
    {
        // Read full payload from "formula" sub-object using proper JSON parsing
        std::wstring newPayloadJson;
#if HAS_NLOHMANN_JSON
        try
        {
            nlohmann::json doc = nlohmann::json::parse(response);
            if (doc.contains("formula") && doc["formula"].is_object())
            {
                std::string narrow = doc["formula"].dump();
                newPayloadJson.assign(narrow.begin(), narrow.end());
            }
        }
        catch (...) {}
#else
        // Fallback: manual brace matching (fragile with nested objects)
        size_t formulaStart = response.find(L"\"formula\":{");
        if (formulaStart != std::wstring::npos)
        {
            size_t braceStart = response.find(L'{', formulaStart + 10);
            if (braceStart != std::wstring::npos)
            {
                int depth = 1;
                size_t end = braceStart + 1;
                while (end < response.size() && depth > 0)
                {
                    if (response[end] == L'{') ++depth;
                    else if (response[end] == L'}') --depth;
                    ++end;
                }
                if (depth == 0)
                {
                    newPayloadJson = L"{" + response.substr(braceStart + 1, end - braceStart - 2) + L"}";
                }
            }
        }
#endif

        // Extract latex (from formula.latex or top-level latex)
        std::wstring newLatex;
        if (!newPayloadJson.empty())
        {
            newLatex = JsonReadString(newPayloadJson, L"latex");
        }
        if (newLatex.empty())
        {
            newLatex = JsonReadString(response, L"latex");
        }

        if (!newLatex.empty())
        {
            presentation->latex = newLatex;

            // If we have a full payload JSON, rebuild the entire presentation
            if (!newPayloadJson.empty())
            {
                FormulaPresentation fresh = CreatePresentationFromPayload(newPayloadJson);
                if (!fresh.enhancedMetafile.empty())
                {
                    presentation->enhancedMetafile = std::move(fresh.enhancedMetafile);
                    presentation->himetricSize = fresh.himetricSize;
                }
                presentation->payloadJson = newPayloadJson;
            }
            else
            {
                // Fallback: placeholder renderer
                FormulaPresentation fresh = CreatePlaceholderPresentation(newLatex);
                if (!fresh.enhancedMetafile.empty())
                {
                    presentation->enhancedMetafile = std::move(fresh.enhancedMetafile);
                    presentation->himetricSize = fresh.himetricSize;
                }
            }

            WriteNativeOleLog(L"OleEditSession: Formula updated from Desktop.");
            CloseHandle(pipe);
            return S_OK;
        }
    }

    // Check for explicit cancel
    if (action == L"cancel")
    {
        WriteNativeOleLog(L"OleEditSession: Desktop cancelled editing.");
        CloseHandle(pipe);
        return S_FALSE;
    }

    WriteNativeOleLog(L"OleEditSession: Desktop cancelled or invalid response.");
    CloseHandle(pipe);
    return S_FALSE;
}

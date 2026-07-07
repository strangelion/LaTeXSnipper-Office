#include "OleEditSession.h"
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

namespace
{

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
                                const FormulaPresentation& presentation)
{
    std::wstring json;
    json += L"{\"protocolVersion\":1,";
    json += L"\"sessionType\":\"ole_edit_request\",";
    json += L"\"formulaId\":\"" + JsonEscapeString(formulaId) + L"\",";
    json += L"\"latex\":\"" + JsonEscapeString(presentation.latex) + L"\",";
    json += L"\"widthPt\":180,";
    json += L"\"heightPt\":42,";
    json += L"\"schemaVersion\":3,";
    json += L"\"revision\":0";
    json += L"}";
    return json;
}

// Find LaTeXSnipper Desktop executable path.
std::wstring FindDesktopPath()
{
    wchar_t path[MAX_PATH];
    // Try HKCU first, then HKLM
    HKEY keys[] = {HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    for (auto root : keys)
    {
        DWORD size = sizeof(path);
        if (RegGetValueW(root, L"Software\\LaTeXSnipper", L"InstallPath",
                         RRF_RT_REG_SZ, nullptr, path, &size) == ERROR_SUCCESS)
        {
            std::wstring exe = std::wstring(path) + L"\\LaTeXSnipper.exe";
            if (GetFileAttributesW(exe.c_str()) != INVALID_FILE_ATTRIBUTES)
                return exe;
        }
    }
    return L"LaTeXSnipper.exe";  // fallback: rely on PATH
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

    // 2. Build envelope JSON
    std::wstring envelope = BuildEnvelopeJson(formulaId, *presentation);
    DWORD envelopeSize = static_cast<DWORD>((envelope.size() + 1) * sizeof(wchar_t));

    // 3. Create Named Pipe Server (single instance, current user only)
    SECURITY_ATTRIBUTES* pipeSa = CreateCurrentUserOnlySecurityAttributes();
    HANDLE pipe = CreateNamedPipeW(
        pipeName.c_str(),
        PIPE_ACCESS_DUPLEX,
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

    // 7. Wait for response from Desktop (SAVE / CANCEL)
    // Response format: 4 bytes = response size, then response JSON
    DWORD responseSize = 0;
    DWORD readBytes = 0;
    if (!ReadFile(pipe, &responseSize, sizeof(responseSize), &readBytes, nullptr))
    {
        WriteNativeOleLog(L"OleEditSession: Failed to read response size.");
        CloseHandle(pipe);
        return HResultFromWin32LastError();
    }

    if (responseSize == 0 || responseSize > 65536)
    {
        // Empty response = cancel
        WriteNativeOleLog(L"OleEditSession: Empty response (cancel).");
        CloseHandle(pipe);
        return S_FALSE;
    }

    std::vector<wchar_t> responseBuffer(responseSize / sizeof(wchar_t) + 1, 0);
    if (!ReadFile(pipe, responseBuffer.data(), responseSize, &readBytes, nullptr))
    {
        WriteNativeOleLog(L"OleEditSession: Failed to read response.");
        CloseHandle(pipe);
        return HResultFromWin32LastError();
    }

    std::wstring response(responseBuffer.data());

    // 8. Parse response — check for "action": "save"
    bool isSave = (response.find(L"\"action\":\"save\"") != std::wstring::npos) ||
                  (response.find(L"\"action\": \"save\"") != std::wstring::npos);

    if (isSave)
    {
        // Extract updated latex
        std::wstring newLatex;
        size_t latexStart;
        if ((latexStart = response.find(L"\"latex\":")) != std::wstring::npos)
        {
            latexStart = response.find(L'"', latexStart + 8);
            if (latexStart != std::wstring::npos)
            {
                ++latexStart;
                for (size_t i = latexStart; i < response.size(); ++i)
                {
                    if (response[i] == L'"') break;
                    newLatex += response[i];
                }
            }
        }

        // Update presentation
        if (!newLatex.empty())
        {
            presentation->latex = newLatex;

            // Regenerate EMF preview — use placeholder renderer
            // In production, Desktop should also send updated EMF/SVG
            FormulaPresentation fresh = CreatePlaceholderPresentation(newLatex);
            if (!fresh.enhancedMetafile.empty())
            {
                presentation->enhancedMetafile = std::move(fresh.enhancedMetafile);
                presentation->himetricSize = fresh.himetricSize;
            }

            WriteNativeOleLog(L"OleEditSession: Formula updated from Desktop.");
            CloseHandle(pipe);
            return S_OK;
        }
    }

    WriteNativeOleLog(L"OleEditSession: Desktop cancelled or invalid response.");
    CloseHandle(pipe);
    return S_FALSE;
}

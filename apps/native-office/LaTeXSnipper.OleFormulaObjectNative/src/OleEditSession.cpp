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
#include <utility>
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

class ScopedHandle final
{
public:
    explicit ScopedHandle(HANDLE value = INVALID_HANDLE_VALUE) noexcept : value_(value) {}
    ~ScopedHandle() { reset(); }
    ScopedHandle(const ScopedHandle&) = delete;
    ScopedHandle& operator=(const ScopedHandle&) = delete;
    ScopedHandle(ScopedHandle&& other) noexcept : value_(other.release()) {}
    ScopedHandle& operator=(ScopedHandle&& other) noexcept
    {
        if (this != &other) reset(other.release());
        return *this;
    }
    HANDLE get() const noexcept { return value_; }
    explicit operator bool() const noexcept { return value_ != nullptr && value_ != INVALID_HANDLE_VALUE; }
    HANDLE release() noexcept { return std::exchange(value_, INVALID_HANDLE_VALUE); }
    void reset(HANDLE value = INVALID_HANDLE_VALUE) noexcept
    {
        if (*this) CloseHandle(value_);
        value_ = value;
    }
private:
    HANDLE value_;
};

class EditSessionGuard final
{
public:
    explicit EditSessionGuard(std::atomic_bool& active) noexcept
        : active_(active), acquired_(!active.exchange(true, std::memory_order_acq_rel)) {}
    ~EditSessionGuard() { if (acquired_) active_.store(false, std::memory_order_release); }
    bool acquired() const noexcept { return acquired_; }
private:
    std::atomic_bool& active_;
    bool acquired_;
};

std::atomic_bool g_editSessionActive{false};

// Forward declarations
std::wstring FindDesktopPath();

constexpr wchar_t kOleEditDispatcherPipe[] = L"\\\\.\\pipe\\LaTeXSnipper.OleEditDispatcher.v1";

// Forward an edit request to the already-running desktop process. The desktop
// acknowledges only after it has accepted responsibility for connecting to the
// one-shot OLE session pipe. Returning false lets the caller start Desktop when
// no existing instance is available.
bool TryDispatchToRunningDesktop(const std::wstring& sessionPipeName)
{
    ScopedHandle dispatcher(CreateFileW(
        kOleEditDispatcherPipe,
        GENERIC_READ | GENERIC_WRITE,
        0,
        nullptr,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        nullptr));
    if (!dispatcher)
    {
        return false;
    }

    const DWORD payloadSize = static_cast<DWORD>(sessionPipeName.size() * sizeof(wchar_t));
    DWORD transferred = 0;
    bool ok = WriteFile(dispatcher.get(), &payloadSize, sizeof(payloadSize), &transferred, nullptr)
        && transferred == sizeof(payloadSize);
    if (ok && payloadSize > 0)
    {
        transferred = 0;
        ok = WriteFile(dispatcher.get(), sessionPipeName.data(), payloadSize, &transferred, nullptr)
            && transferred == payloadSize;
    }

    DWORD acknowledgement = 0;
    if (ok)
    {
        transferred = 0;
        ok = ReadFile(dispatcher.get(), &acknowledgement, sizeof(acknowledgement), &transferred, nullptr)
            && transferred == sizeof(acknowledgement)
            && acknowledgement == 1;
    }

    return ok;
}

// ConnectNamedPipe with timeout (milliseconds).
// Returns true if connected, false on timeout/error.
bool ConnectNamedPipeWithTimeout(HANDLE pipe, DWORD timeoutMs)
{
    // Use overlapped ConnectNamedPipe with event for timeout support
    ScopedHandle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!event)
        return false;

    OVERLAPPED overlapped{};
    overlapped.hEvent = event.get();

    BOOL connected = ConnectNamedPipe(pipe, &overlapped);
    if (connected)
    {
        // Connected synchronously (unlikely but possible with a pending connection)
        return true;
    }

    DWORD error = GetLastError();
    if (error == ERROR_PIPE_CONNECTED)
    {
        // Client already connected before we called ConnectNamedPipe
        return true;
    }

    if (error != ERROR_IO_PENDING)
    {
        // Real error
        return false;
    }

    // Wait for connection or timeout
    DWORD waitResult = WaitForSingleObject(event.get(), timeoutMs);
    if (waitResult == WAIT_OBJECT_0)
    {
        // Connected
        DWORD bytesTransferred = 0;
        if (!GetOverlappedResult(pipe, &overlapped, &bytesTransferred, FALSE)) return false;
        return true;
    }

    // Timeout — cancel the pending operation
    CancelIo(pipe);
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
    json += L"{\"protocolVersion\":" + std::to_wstring(kOleEditProtocolVersion) + L",";
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
static bool ReadChunkWithTimeout(HANDLE pipe, void* buffer, DWORD bytesToRead, DWORD* bytesRead, DWORD timeoutMs)
{
    ScopedHandle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!event)
        return false;

    OVERLAPPED overlapped{};
    overlapped.hEvent = event.get();

    BOOL result = ReadFile(pipe, buffer, bytesToRead, bytesRead, &overlapped);
    if (result)
    {
        // Completed synchronously
        return true;
    }

    const DWORD initialError = GetLastError();
    if (initialError == ERROR_MORE_DATA && *bytesRead > 0)
    {
        return true;
    }
    if (initialError != ERROR_IO_PENDING) return false;

    // Wait for completion or timeout
    DWORD waitResult = WaitForSingleObject(event.get(), timeoutMs);
    if (waitResult == WAIT_OBJECT_0)
    {
        if (GetOverlappedResult(pipe, &overlapped, bytesRead, FALSE)) return true;
        return GetLastError() == ERROR_MORE_DATA && *bytesRead > 0;
    }

    // Timeout — cancel pending operation
    CancelIoEx(pipe, &overlapped);
    GetOverlappedResult(pipe, &overlapped, bytesRead, TRUE);
    SetLastError(ERROR_TIMEOUT);
    return false;
}

static bool TransferExactWithTimeout(HANDLE pipe,
                                     void* buffer,
                                     DWORD byteCount,
                                     DWORD timeoutMs,
                                     bool write,
                                     DWORD* errorCode)
{
    auto* bytes = static_cast<unsigned char*>(buffer);
    DWORD offset = 0;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
    while (offset < byteCount)
    {
        const auto now = std::chrono::steady_clock::now();
        if (now >= deadline)
        {
            *errorCode = ERROR_TIMEOUT;
            return false;
        }

        const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - now);
        const DWORD waitMs = remaining.count() > MAXDWORD ? MAXDWORD : static_cast<DWORD>(remaining.count());
        DWORD transferred = 0;
        bool completed = false;
        if (write)
        {
            ScopedHandle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
            if (!event)
            {
                *errorCode = GetLastError();
                return false;
            }
            OVERLAPPED overlapped{};
            overlapped.hEvent = event.get();
            BOOL result = WriteFile(pipe, bytes + offset, byteCount - offset, &transferred, &overlapped);
            DWORD operationError = result ? ERROR_SUCCESS : GetLastError();
            if (!result && operationError == ERROR_IO_PENDING)
            {
                if (WaitForSingleObject(event.get(), waitMs) != WAIT_OBJECT_0)
                {
                    CancelIoEx(pipe, &overlapped);
                    GetOverlappedResult(pipe, &overlapped, &transferred, TRUE);
                    *errorCode = ERROR_TIMEOUT;
                    return false;
                }
                result = GetOverlappedResult(pipe, &overlapped, &transferred, FALSE);
                operationError = result ? ERROR_SUCCESS : GetLastError();
            }
            if (!result)
            {
                *errorCode = operationError;
                return false;
            }
            completed = true;
        }
        else
        {
            completed = ReadChunkWithTimeout(pipe, bytes + offset, byteCount - offset, &transferred, waitMs);
            if (!completed)
            {
                *errorCode = GetLastError();
                return false;
            }
        }

        if (!completed || transferred == 0)
        {
            *errorCode = ERROR_BROKEN_PIPE;
            return false;
        }
        offset += transferred;
    }
    *errorCode = ERROR_SUCCESS;
    return true;
}

static bool ReadExactWithTimeout(HANDLE pipe, void* buffer, DWORD byteCount, DWORD timeoutMs, DWORD* errorCode)
{
    return TransferExactWithTimeout(pipe, buffer, byteCount, timeoutMs, false, errorCode);
}

static bool WriteExactWithTimeout(HANDLE pipe, const void* buffer, DWORD byteCount, DWORD timeoutMs, DWORD* errorCode)
{
    return TransferExactWithTimeout(pipe, const_cast<void*>(buffer), byteCount, timeoutMs, true, errorCode);
}

static bool SendCommitAck(HANDLE pipe, bool success, const wchar_t* errorCode, HRESULT result)
{
    std::wstring ack = L"{\"protocolVersion\":" + std::to_wstring(kOleEditProtocolVersion)
        + L",\"success\":" + (success ? L"true" : L"false")
        + L",\"errorCode\":\"" + JsonEscapeString(errorCode == nullptr ? L"" : errorCode)
        + L"\",\"hresult\":" + std::to_wstring(static_cast<unsigned long>(result)) + L"}";
    const DWORD size = static_cast<DWORD>((ack.size() + 1) * sizeof(wchar_t));
    DWORD ioError = ERROR_SUCCESS;
    return WriteExactWithTimeout(pipe, &size, sizeof(size), 30000, &ioError)
        && WriteExactWithTimeout(pipe, ack.c_str(), size, 30000, &ioError);
}

HRESULT StartEditSessionPipe(const std::wstring& formulaId,
                              FormulaPresentation* presentation,
                              HWND parentWindow)
{
    if (presentation == nullptr)
        return E_POINTER;

    EditSessionGuard sessionGuard(g_editSessionActive);
    if (!sessionGuard.acquired())
    {
        WriteNativeOleLog(L"OleEditSession: Rejected concurrent edit (OLE_EDIT_BUSY).");
        return OLE_EDIT_BUSY;
    }

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
    ScopedHandle pipe(CreateNamedPipeW(
        pipeName.c_str(),
        PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
        PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
        1,                    // max instances
        65536,                // out buffer
        65536,                // in buffer
        5000,                 // default timeout ms
        pipeSa));             // security: current user only

    if (pipeSa != nullptr)
    {
        FreeSecurityAttributes(pipeSa);
    }

    if (!pipe)
    {
        const DWORD error = GetLastError();
        WriteNativeOleLog(L"OleEditSession: CreateNamedPipe failed.");
        return HRESULT_FROM_WIN32(error);
    }

    // WriteNativeOleLog(L"OleEditSession: Pipe created, launching Desktop...");

    // 4. Reuse the running Desktop instance whenever possible. Starting a
    // second process here creates a second editor window and loses the user's
    // current UI state. If no dispatcher exists, launch Desktop once as the
    // fallback for a cold start.
    if (TryDispatchToRunningDesktop(pipeName))
    {
        WriteNativeOleLog(L"OleEditSession: Dispatched to running Desktop.");
    }
    else
    {
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
            const DWORD error = GetLastError();
            WriteNativeOleLog(L"OleEditSession: Failed to launch Desktop.");
            return HRESULT_FROM_WIN32(error);
        }
        WriteNativeOleLog(L"OleEditSession: Started Desktop for a cold edit session.");
    }

    // 5. Wait for Desktop to connect with 60-second timeout
    // Use overlapped I/O for timeout support to avoid blocking Office UI thread
    BOOL connected = ConnectNamedPipeWithTimeout(pipe.get(), 60000);
    if (!connected)
    {
        DWORD err = GetLastError();
        WriteNativeOleLog(err == ERROR_TIMEOUT
            ? L"OleEditSession: Desktop did not connect within 60s timeout."
            : L"OleEditSession: Desktop connection failed.");
        return HRESULT_FROM_WIN32(err == ERROR_SUCCESS ? ERROR_GEN_FAILURE : err);
    }

    WriteNativeOleLog(L"OleEditSession: Desktop connected.");

    // 6. Send envelope to Desktop
    DWORD ioError = ERROR_SUCCESS;
    if (!WriteExactWithTimeout(pipe.get(), &envelopeSize, sizeof(envelopeSize), 30000, &ioError))
    {
        WriteNativeOleLog(L"OleEditSession: Failed to send size.");
        return HRESULT_FROM_WIN32(ioError);
    }

    if (!WriteExactWithTimeout(pipe.get(), envelope.c_str(), envelopeSize, 30000, &ioError))
    {
        WriteNativeOleLog(L"OleEditSession: Failed to send envelope.");
        return HRESULT_FROM_WIN32(ioError);
    }

    // 7. Wait for response from Desktop (SAVE / CANCEL) with 10-minute total timeout
    // Response format: 4 bytes = response size, then response JSON (UTF-16)
    constexpr DWORD kEditTotalTimeoutMs = 600000; // 10 minutes
    DWORD responseSize = 0;
    if (!ReadExactWithTimeout(pipe.get(), &responseSize, sizeof(responseSize), kEditTotalTimeoutMs, &ioError))
    {
        WriteNativeOleLog(L"OleEditSession: Timed out waiting for response size.");
        return HRESULT_FROM_WIN32(ioError);
    }

    // Response body limit: support full FormulaPayload including PNG/SVG base64
    if (responseSize < sizeof(wchar_t) || responseSize > kOleEditMaxPayloadBytes || responseSize % sizeof(wchar_t) != 0)
    {
        WriteNativeOleLog(L"OleEditSession: Invalid response size.");
        SendCommitAck(pipe.get(), false, L"OLE_EDIT_PROTOCOL_ERROR", OLE_EDIT_PROTOCOL_ERROR);
        return OLE_EDIT_PROTOCOL_ERROR;
    }

    std::vector<wchar_t> responseBuffer(responseSize / sizeof(wchar_t) + 1, 0);
    if (!ReadExactWithTimeout(pipe.get(), responseBuffer.data(), responseSize, kEditTotalTimeoutMs, &ioError))
    {
        WriteNativeOleLog(L"OleEditSession: Failed to read response.");
        return HRESULT_FROM_WIN32(ioError);
    }

    if (responseBuffer[responseSize / sizeof(wchar_t) - 1] != L'\0')
    {
        SendCommitAck(pipe.get(), false, L"OLE_EDIT_PROTOCOL_ERROR", OLE_EDIT_PROTOCOL_ERROR);
        return OLE_EDIT_PROTOCOL_ERROR;
    }

    std::wstring response(responseBuffer.data());

    if (static_cast<DWORD>(ExtractJsonNumber(response, L"protocolVersion")) != kOleEditProtocolVersion)
    {
        WriteNativeOleLog(L"OleEditSession: Protocol version mismatch.");
        SendCommitAck(pipe.get(), false, L"OLE_EDIT_PROTOCOL_ERROR", OLE_EDIT_PROTOCOL_ERROR);
        return OLE_EDIT_PROTOCOL_ERROR;
    }

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
                // Convert UTF-8 to wide string properly
                int wideLen = MultiByteToWideChar(CP_UTF8, 0, narrow.data(), (int)narrow.size(), nullptr, 0);
                newPayloadJson.resize(wideLen);
                MultiByteToWideChar(CP_UTF8, 0, narrow.data(), (int)narrow.size(), &newPayloadJson[0], wideLen);
            }
        }
        catch (const std::exception& error)
        {
            UNREFERENCED_PARAMETER(error);
            WriteNativeOleLog(L"OleEditSession: Failed to parse save response JSON.");
        }
#else
        // Fallback: ExtractJsonString handles JSON escape sequences correctly
        newPayloadJson = ExtractJsonString(response, L"formula");
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

        const int responseRevision = static_cast<int>(ExtractJsonNumber(newPayloadJson, L"revision"));
        if (responseRevision != revision + 1)
        {
            WriteNativeOleLog(L"OleEditSession: Revision conflict.");
            SendCommitAck(pipe.get(), false, L"OLE_EDIT_REVISION_CONFLICT", OLE_EDIT_REVISION_CONFLICT);
            return OLE_EDIT_REVISION_CONFLICT;
        }

        if (!newLatex.empty())
        {
            // P0-6: All-or-nothing update — do NOT commit new LaTeX without valid preview.
            // If the new payload has no EMF, we must keep the entire old presentation
            // to prevent "new LaTeX + old preview" inconsistency.
            bool hasValidPreview = false;
            if (!newPayloadJson.empty())
            {
                FormulaPresentation fresh = CreatePresentationFromPayload(newPayloadJson);
                if (!fresh.enhancedMetafile.empty())
                {
                    hasValidPreview = true;
                    presentation->latex = newLatex;
                    presentation->enhancedMetafile = std::move(fresh.enhancedMetafile);
                    presentation->himetricSize = fresh.himetricSize;
                    presentation->payloadJson = newPayloadJson;
                }
            }
            if (!hasValidPreview)
            {
                // P0-6: Preview generation failed — reject the save entirely.
                // Return the old presentation unchanged.
                WriteNativeOleLog(L"OleEditSession: Save rejected — new formula has no valid EMF preview.");
                SendCommitAck(pipe.get(), false, L"OLE_EDIT_PREVIEW_FAILED", OLE_EDIT_PREVIEW_FAILED);
                return OLE_EDIT_PREVIEW_FAILED;
            }

            WriteNativeOleLog(L"OleEditSession: Formula updated from Desktop.");
            if (!SendCommitAck(pipe.get(), true, L"", S_OK))
            {
                WriteNativeOleLog(L"OleEditSession: Formula committed but commit ACK could not be delivered.");
            }
            return S_OK;
        }

        SendCommitAck(pipe.get(), false, L"OLE_EDIT_INVALID_FORMULA", E_INVALIDARG);
        return E_INVALIDARG;
    }

    // Check for explicit cancel
    if (action == L"cancel")
    {
        WriteNativeOleLog(L"OleEditSession: Desktop cancelled editing.");
        SendCommitAck(pipe.get(), true, L"", S_FALSE);
        return S_FALSE;
    }

    if (action == L"error")
    {
        const std::wstring errorCode = JsonReadString(response, L"errorCode");
        if (errorCode == L"OLE_EDIT_BUSY") return OLE_EDIT_BUSY;
        if (errorCode == L"OLE_EDIT_REVISION_CONFLICT") return OLE_EDIT_REVISION_CONFLICT;
        return OLE_EDIT_PROTOCOL_ERROR;
    }

    WriteNativeOleLog(L"OleEditSession: Desktop cancelled or invalid response.");
    SendCommitAck(pipe.get(), false, L"OLE_EDIT_PROTOCOL_ERROR", OLE_EDIT_PROTOCOL_ERROR);
    return OLE_EDIT_PROTOCOL_ERROR;
}

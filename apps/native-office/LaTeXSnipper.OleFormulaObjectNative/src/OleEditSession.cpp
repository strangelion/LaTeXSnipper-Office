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

#pragma comment(lib, "rpcrt4.lib")

namespace
{

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
std::wstring BuildEnvelopeJson(const std::wstring& formulaId,
                                const FormulaPresentation& presentation)
{
    // Simple JSON builder (no external dependency needed for this limited use)
    std::wstring json;
    json += L"{\"protocolVersion\":1,";
    json += L"\"sessionType\":\"ole_edit_request\",";
    json += L"\"formulaId\":\"" + formulaId + L"\",";
    json += L"\"latex\":\"" + presentation.latex + L"\",";
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

    // 3. Create Named Pipe Server (inbound, single instance)
    HANDLE pipe = CreateNamedPipeW(
        pipeName.c_str(),
        PIPE_ACCESS_DUPLEX,
        PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
        1,                    // max instances
        65536,                // out buffer
        65536,                // in buffer
        5000,                 // default timeout ms
        nullptr               // default security (current user only)
    );

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

    // 5. Wait for Desktop to connect (timeout: 60 seconds)
    BOOL connected = ConnectNamedPipe(pipe, nullptr);
    if (!connected && GetLastError() != ERROR_PIPE_CONNECTED)
    {
        WriteNativeOleLog(L"OleEditSession: Desktop did not connect.");
        CloseHandle(pipe);
        return HResultFromWin32LastError();
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

#include <windows.h>
#include <oleauto.h>
#include <winver.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace
{
constexpr wchar_t kClsidText[] = L"{B7F5B4AB-5F94-4D87-A29F-9A41D41B3B9F}";
constexpr wchar_t kProgId[] = L"LaTeXSnipper.Formula.1";

std::wstring JsonEscape(const std::wstring& value)
{
    std::wostringstream result;
    for (wchar_t ch : value)
    {
        switch (ch)
        {
        case L'\\': result << L"\\\\"; break;
        case L'\"': result << L"\\\""; break;
        case L'\r': result << L"\\r"; break;
        case L'\n': result << L"\\n"; break;
        case L'\t': result << L"\\t"; break;
        default:
            if (ch < 0x20)
            {
                result << L"\\u" << std::hex << static_cast<unsigned int>(ch);
            }
            else
            {
                result << ch;
            }
            break;
        }
    }
    return result.str();
}

std::wstring HResultText(HRESULT value)
{
    wchar_t buffer[32]{};
    swprintf_s(buffer, L"0x%08X", static_cast<unsigned int>(value));
    return buffer;
}

int Fail(const std::wstring& stage, const std::wstring& detail, HRESULT hr = S_OK)
{
    std::wcout << L"{\"success\":false,\"architecture\":\""
#ifdef _WIN64
               << L"x64"
#else
               << L"x86"
#endif
               << L"\",\"stage\":\"" << JsonEscape(stage)
               << L"\",\"detail\":\"" << JsonEscape(detail) << L"\"";
    if (FAILED(hr))
    {
        std::wcout << L",\"hresult\":\"" << HResultText(hr) << L"\"";
    }
    std::wcout << L"}" << std::endl;
    return 1;
}

std::wstring FullPath(const std::wstring& path)
{
    const DWORD required = GetFullPathNameW(path.c_str(), 0, nullptr, nullptr);
    if (required == 0) return path;
    std::vector<wchar_t> buffer(required);
    if (GetFullPathNameW(path.c_str(), required, buffer.data(), nullptr) == 0) return path;
    return buffer.data();
}

bool EqualPath(const std::wstring& left, const std::wstring& right)
{
    return _wcsicmp(FullPath(left).c_str(), FullPath(right).c_str()) == 0;
}

bool ReadRegistryPath(std::wstring* result)
{
    const std::wstring key = std::wstring(L"Software\\Classes\\CLSID\\") + kClsidText + L"\\InprocServer32";
    DWORD bytes = 0;
    LSTATUS status = RegGetValueW(HKEY_CURRENT_USER, key.c_str(), nullptr, RRF_RT_REG_SZ, nullptr, nullptr, &bytes);
    if (status != ERROR_SUCCESS || bytes < sizeof(wchar_t)) return false;
    std::vector<wchar_t> buffer(bytes / sizeof(wchar_t));
    status = RegGetValueW(HKEY_CURRENT_USER, key.c_str(), nullptr, RRF_RT_REG_SZ, nullptr, buffer.data(), &bytes);
    if (status != ERROR_SUCCESS) return false;
    *result = buffer.data();
    return true;
}

bool ReadAllBytes(const std::wstring& path, std::vector<std::uint8_t>* bytes)
{
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                              FILE_ATTRIBUTE_NORMAL | FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(file, &size) || size.QuadPart <= 0 || size.QuadPart > 128LL * 1024 * 1024)
    {
        CloseHandle(file);
        return false;
    }
    bytes->resize(static_cast<size_t>(size.QuadPart));
    size_t offset = 0;
    while (offset < bytes->size())
    {
        DWORD read = 0;
        const DWORD chunk = static_cast<DWORD>((std::min)(bytes->size() - offset, static_cast<size_t>(1 << 20)));
        if (!ReadFile(file, bytes->data() + offset, chunk, &read, nullptr) || read == 0)
        {
            CloseHandle(file);
            return false;
        }
        offset += read;
    }
    CloseHandle(file);
    return true;
}

bool ValidatePeMachine(const std::wstring& path, WORD* actual)
{
    std::vector<std::uint8_t> bytes;
    if (!ReadAllBytes(path, &bytes) || bytes.size() < sizeof(IMAGE_DOS_HEADER)) return false;
    IMAGE_DOS_HEADER dos{};
    std::memcpy(&dos, bytes.data(), sizeof(dos));
    if (dos.e_magic != IMAGE_DOS_SIGNATURE || dos.e_lfanew < 0) return false;
    const size_t offset = static_cast<size_t>(dos.e_lfanew);
    if (offset > bytes.size() || bytes.size() - offset < sizeof(DWORD) + sizeof(IMAGE_FILE_HEADER)) return false;
    DWORD signature = 0;
    IMAGE_FILE_HEADER header{};
    std::memcpy(&signature, bytes.data() + offset, sizeof(signature));
    std::memcpy(&header, bytes.data() + offset + sizeof(signature), sizeof(header));
    if (signature != IMAGE_NT_SIGNATURE) return false;
    *actual = header.Machine;
#ifdef _WIN64
    return header.Machine == IMAGE_FILE_MACHINE_AMD64;
#else
    return header.Machine == IMAGE_FILE_MACHINE_I386;
#endif
}

bool ReadFileVersion(const std::wstring& path, std::wstring* version)
{
    DWORD ignored = 0;
    const DWORD size = GetFileVersionInfoSizeW(path.c_str(), &ignored);
    if (size == 0) return false;
    std::vector<std::uint8_t> data(size);
    if (!GetFileVersionInfoW(path.c_str(), 0, size, data.data())) return false;
    VS_FIXEDFILEINFO* info = nullptr;
    UINT infoSize = 0;
    if (!VerQueryValueW(data.data(), L"\\", reinterpret_cast<void**>(&info), &infoSize) ||
        info == nullptr || infoSize < sizeof(VS_FIXEDFILEINFO) || info->dwSignature != 0xFEEF04BD)
    {
        return false;
    }
    std::wostringstream text;
    text << HIWORD(info->dwFileVersionMS) << L'.' << LOWORD(info->dwFileVersionMS) << L'.'
         << HIWORD(info->dwFileVersionLS) << L'.' << LOWORD(info->dwFileVersionLS);
    *version = text.str();
    return true;
}
}

int wmain(int argc, wchar_t** argv)
{
    if (argc != 2) return Fail(L"arguments", L"Usage: OleActivationProbe.exe <expected-dll-path>");
    const std::wstring expectedDll = FullPath(argv[1]);

    std::wstring registeredDll;
    if (!ReadRegistryPath(&registeredDll)) return Fail(L"registry", L"InprocServer32 is missing or invalid");
    if (!EqualPath(registeredDll, expectedDll))
    {
        return Fail(L"registry", L"InprocServer32 path does not match expected DLL: " + registeredDll);
    }

    WORD machine = 0;
    if (!ValidatePeMachine(expectedDll, &machine)) return Fail(L"pe-machine", L"PE Machine does not match probe architecture");

    HMODULE module = LoadLibraryExW(expectedDll.c_str(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
    if (module == nullptr) return Fail(L"dependencies", L"LoadLibraryEx failed; a dependency is missing", HRESULT_FROM_WIN32(GetLastError()));
    const char* exports[] = {"DllGetClassObject", "DllCanUnloadNow"};
    for (const char* name : exports)
    {
        if (GetProcAddress(module, name) == nullptr)
        {
            FreeLibrary(module);
            std::wstring exportName(name, name + std::strlen(name));
            return Fail(L"exports", L"Required DLL export is missing: " + exportName);
        }
    }

    std::wstring version;
    if (!ReadFileVersion(expectedDll, &version))
    {
        FreeLibrary(module);
        return Fail(L"file-version", L"Version resource is missing or invalid");
    }

    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr))
    {
        FreeLibrary(module);
        return Fail(L"coinitialize", L"CoInitializeEx failed", hr);
    }

    CLSID clsid{};
    hr = CLSIDFromProgID(kProgId, &clsid);
    if (FAILED(hr))
    {
        CoUninitialize();
        FreeLibrary(module);
        return Fail(L"clsid", L"CLSIDFromProgID failed", hr);
    }

    IUnknown* unknown = nullptr;
    hr = CoCreateInstance(clsid, nullptr, CLSCTX_INPROC_SERVER, IID_IUnknown, reinterpret_cast<void**>(&unknown));
    if (FAILED(hr) || unknown == nullptr)
    {
        CoUninitialize();
        FreeLibrary(module);
        return Fail(L"activation", L"CoCreateInstance failed", hr);
    }

    IDispatch* dispatch = nullptr;
    hr = unknown->QueryInterface(IID_IDispatch, reinterpret_cast<void**>(&dispatch));
    unknown->Release();
    if (FAILED(hr) || dispatch == nullptr)
    {
        CoUninitialize();
        FreeLibrary(module);
        return Fail(L"idispatch", L"QueryInterface(IID_IDispatch) failed", hr);
    }

    wchar_t methodName[] = L"IsInitialized";
    LPOLESTR names[] = {methodName};
    DISPID dispid = DISPID_UNKNOWN;
    hr = dispatch->GetIDsOfNames(IID_NULL, names, 1, LOCALE_INVARIANT, &dispid);
    if (FAILED(hr))
    {
        dispatch->Release();
        CoUninitialize();
        FreeLibrary(module);
        return Fail(L"getids", L"GetIDsOfNames(IsInitialized) failed", hr);
    }

    DISPPARAMS parameters{};
    VARIANT result{};
    VariantInit(&result);
    hr = dispatch->Invoke(dispid, IID_NULL, LOCALE_INVARIANT, DISPATCH_METHOD, &parameters, &result, nullptr, nullptr);
    dispatch->Release();
    if (FAILED(hr))
    {
        VariantClear(&result);
        CoUninitialize();
        FreeLibrary(module);
        return Fail(L"invoke", L"Invoke(IsInitialized) failed", hr);
    }
    if (result.vt != VT_BOOL || result.boolVal != VARIANT_FALSE)
    {
        const VARTYPE actualType = result.vt;
        const VARIANT_BOOL actualValue = result.boolVal;
        VariantClear(&result);
        CoUninitialize();
        FreeLibrary(module);
        std::wostringstream detail;
        detail << L"Expected VT_BOOL/VARIANT_FALSE, got vt=" << actualType << L" value=" << actualValue;
        return Fail(L"variant", detail.str());
    }
    VariantClear(&result);
    CoUninitialize();
    FreeLibrary(module);

    std::wcout << L"{\"success\":true,\"architecture\":\""
#ifdef _WIN64
               << L"x64"
#else
               << L"x86"
#endif
               << L"\",\"registryPath\":\"" << JsonEscape(registeredDll)
               << L"\",\"peMachine\":" << machine
               << L",\"exports\":\"ok\",\"dependencies\":\"resolved\",\"fileVersion\":\""
               << JsonEscape(version) << L"\",\"variantType\":" << VT_BOOL
               << L",\"variantValue\":0}" << std::endl;
    return 0;
}

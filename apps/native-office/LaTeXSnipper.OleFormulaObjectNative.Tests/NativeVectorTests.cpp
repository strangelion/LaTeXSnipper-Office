#include "Presentation.h"
#include "JsonHelper.h"
#include "LaTeXSnipperFormula.h"
#include "OleFormulaIds.h"
#include "SvgPathParser.h"
#include "SvgToEmf.h"
#include "StorageUtil.h"

#include <windows.h>
#include <objidl.h>
#include <gdiplus.h>
#include <bcrypt.h>
#include <shlobj.h>

#include <algorithm>
#include <cmath>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

ULONG_PTR g_gdiplusToken = 0;

namespace
{
int failures = 0;

void Expect(bool condition, const std::wstring& message)
{
    if (!condition)
    {
        std::wcerr << L"FAIL: " << message << std::endl;
        ++failures;
    }
}

void TestVectorFixture(const std::wstring& name, const std::wstring& body, double widthPt = 120.0, double heightPt = 40.0)
{
    const std::wstring svg = L"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 40'>" + body + L"</svg>";
    SvgToEmfResult result = ConvertMathJaxSvgToVectorEmf(svg, widthPt, heightPt, L"#123456");
    Expect(result.success, name + L": conversion failed: " + result.error);
    if (!result.success) return;
    Expect(HasValidEmf(result.emfBytes), name + L": invalid EMF header");
    std::wstring reason;
    Expect(!ContainsRasterEmfRecords(result.emfBytes, &reason), name + L": raster record found: " + reason);
    Expect(HasVectorDrawingEmfRecords(result.emfBytes, &reason), name + L": vector drawing record missing: " + reason);
    HENHMETAFILE emf = SetEnhMetaFileBits(static_cast<UINT>(result.emfBytes.size()), result.emfBytes.data());
    ENHMETAHEADER header{};
    Expect(emf != nullptr && GetEnhMetaFileHeader(emf, sizeof(header), &header) != 0, name + L": cannot read EMF header");
    if (emf != nullptr)
    {
        const double paddingXPt = std::clamp(widthPt * 0.02, 1.5, 4.0);
        const double paddingYPt = std::clamp(heightPt * 0.08, 1.0, 3.0);
        const LONG unpaddedWidth = static_cast<LONG>(std::lround(widthPt * 2540.0 / 72.0));
        const LONG unpaddedHeight = static_cast<LONG>(std::lround(heightPt * 2540.0 / 72.0));
        const LONG expectedWidth = static_cast<LONG>(std::lround((widthPt + paddingXPt * 2.0) * 2540.0 / 72.0));
        const LONG expectedHeight = static_cast<LONG>(std::lround((heightPt + paddingYPt * 2.0) * 2540.0 / 72.0));
        Expect(std::abs((header.rclFrame.right - header.rclFrame.left) - expectedWidth) <= 2, name + L": frame width mismatch");
        Expect(std::abs((header.rclFrame.bottom - header.rclFrame.top) - expectedHeight) <= 2, name + L": frame height mismatch");
        Expect((header.rclFrame.right - header.rclFrame.left) > unpaddedWidth, name + L": horizontal safety margin missing");
        Expect((header.rclFrame.bottom - header.rclFrame.top) > unpaddedHeight, name + L": vertical safety margin missing");
        DeleteEnhMetaFile(emf);
    }
}

void TestInvalid(const std::wstring& name, const std::wstring& svg, const std::wstring& expectedCode)
{
    SvgToEmfResult result = ConvertMathJaxSvgToVectorEmf(svg, 120.0, 40.0, L"black");
    Expect(!result.success, name + L": invalid SVG unexpectedly succeeded");
    Expect(result.error.find(expectedCode) != std::wstring::npos, name + L": unexpected error: " + result.error);
}

void TestPathParser()
{
    const std::wstring data = L"M1 2 3 4 l5 -6 h7 v8 C1e1,2e1 30,40 50,60 s10,20 30,40 Q80 20 90 30 t10 5 A10 5 30 0 1 110 35 z";
    SvgPathParseResult result = ParseSvgPathData(data);
    Expect(result.success, L"path parser rejected complete command coverage: " + result.error);
    Expect(result.commandCount >= 10, L"path parser did not emit expected operations");
    Expect(!ParseSvgPathData(L"M 0 0 L").success, L"incomplete path unexpectedly succeeded");
    Expect(!ParseSvgPathData(L"M NaN 0").success, L"NaN path unexpectedly succeeded");
    Expect(!ParseSvgPathData(L"M 0 0 A 1 1 0 2 0 2 2").success, L"invalid arc flag unexpectedly succeeded");
}

void TestPngFallback()
{
    const std::wstring png = L"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const std::wstring payload = L"{\"latex\":\"x\",\"widthPt\":72,\"heightPt\":72,\"png\":\"" + png + L"\"}";
    FormulaPresentation result = CreatePresentationFromPayloadPng(payload);
    Expect(!result.enhancedMetafile.empty(), L"PNG fallback failed: " + result.diagnostic);
    Expect(result.previewKind == PreviewKind::RasterEmfFallback, L"PNG fallback has incorrect preview kind");
    Expect(!result.isVector, L"PNG fallback was marked vector");
    std::wstring reason;
    Expect(ContainsRasterEmfRecords(result.enhancedMetafile, &reason), L"PNG fallback raster record was not detected");
}

void TestStorageValidation()
{
    SvgToEmfResult vector = ConvertMathJaxSvgToVectorEmf(
        L"<svg viewBox='0 0 10 10'><path d='M1 1 L9 1 L5 9 Z'/></svg>", 72.0, 72.0, L"black");
    Expect(vector.success, L"storage fixture vector generation failed");
    if (!vector.success) return;

    ILockBytes* lockBytes = nullptr;
    IStorage* storage = nullptr;
    Expect(SUCCEEDED(CreateILockBytesOnHGlobal(nullptr, TRUE, &lockBytes)), L"CreateILockBytesOnHGlobal failed");
    if (lockBytes == nullptr) return;
    HRESULT created = StgCreateDocfileOnILockBytes(lockBytes, STGM_CREATE | STGM_READWRITE | STGM_SHARE_EXCLUSIVE, 0, &storage);
    Expect(SUCCEEDED(created) && storage != nullptr, L"StgCreateDocfileOnILockBytes failed");
    if (storage == nullptr) { lockBytes->Release(); return; }

    FormulaPresentation source{};
    source.latex = L"storage-test";
    source.payloadJson = L"{\"schemaVersion\":3,\"formulaId\":\"storage-fixture\",\"latex\":\"storage-test\",\"widthPt\":72,\"heightPt\":72}";
    source.himetricSize = vector.himetricSize;
    source.enhancedMetafile = vector.emfBytes;
    source.previewKind = PreviewKind::GeneratedVectorEmf;
    source.isVector = true;
    Expect(SUCCEEDED(SavePresentationToStorage(storage, source)), L"valid presentation save failed");
    storage->Commit(STGC_DEFAULT);

    FormulaPresentation loaded{};
    Expect(SUCCEEDED(LoadPresentationFromStorage(storage, &loaded)), L"valid presentation load failed");
    Expect(loaded.latex == source.latex && HasValidEmf(loaded.enhancedMetafile), L"valid presentation did not round-trip");

    IStream* corrupt = nullptr;
    if (SUCCEEDED(storage->CreateStream(L"PresentationEmf", STGM_CREATE | STGM_WRITE | STGM_SHARE_EXCLUSIVE, 0, 0, &corrupt)))
    {
        const BYTE invalid[] = {1, 2, 3, 4};
        ULONG written = 0;
        corrupt->Write(invalid, sizeof(invalid), &written);
        corrupt->Release();
    }
    FormulaPresentation sentinel{};
    sentinel.latex = L"sentinel";
    Expect(FAILED(LoadPresentationFromStorage(storage, &sentinel)), L"corrupt EMF stream unexpectedly loaded");
    Expect(sentinel.latex == L"sentinel", L"failed load overwrote the previous presentation state");

    IStream* oversized = nullptr;
    if (SUCCEEDED(storage->CreateStream(L"PresentationEmf", STGM_CREATE | STGM_WRITE | STGM_SHARE_EXCLUSIVE, 0, 0, &oversized)))
    {
        LARGE_INTEGER offset{};
        offset.QuadPart = 64LL * 1024LL * 1024LL;
        ULARGE_INTEGER newPosition{};
        HRESULT seekResult = oversized->Seek(offset, STREAM_SEEK_SET, &newPosition);
        BYTE marker = 1;
        ULONG written = 0;
        HRESULT writeResult = oversized->Write(&marker, 1, &written);
        oversized->Release();
        Expect(SUCCEEDED(seekResult) && SUCCEEDED(writeResult) && written == 1, L"oversized storage fixture could not be created");
        if (SUCCEEDED(seekResult) && SUCCEEDED(writeResult) && written == 1)
        {
            FormulaPresentation target{};
            const HRESULT loadResult = LoadPresentationFromStorage(storage, &target);
            Expect(loadResult == STG_E_MEDIUMFULL, L"oversized EMF stream was not rejected at the size limit; HRESULT=" + std::to_wstring(loadResult));
        }
    }

    storage->Release();
    lockBytes->Release();
}

using DllGetClassObjectFn = HRESULT(STDAPICALLTYPE*)(REFCLSID, REFIID, void**);

std::wstring PendingValueName(DWORD pid)
{
    return L"PendingPayload." + std::to_wstring(pid);
}

void TestValidSvgSurvivesInvalidPngFallback()
{
    const std::wstring payload =
        L"{\"latex\":\"x\",\"widthPt\":72,\"heightPt\":72,\"render\":{"
        L"\"widthPt\":72,\"heightPt\":72,\"svg\":\"<svg viewBox='0 0 10 10'><path d='M1 1L9 1L5 9Z'/></svg>\","
        L"\"png\":\"not-valid-base64\"}}";
    FormulaPresentation result = CreatePresentationFromPayload(payload);
    Expect(!result.enhancedMetafile.empty(), L"valid SVG was discarded when PNG fallback was invalid: " + result.diagnostic);
    Expect(result.previewKind == PreviewKind::GeneratedVectorEmf, L"valid SVG did not remain the selected preview route");
    Expect(result.isVector, L"valid SVG result was not marked vector");
}

void TestEmfCorruptionValidation()
{
    SvgToEmfResult source = ConvertMathJaxSvgToVectorEmf(
        L"<svg viewBox='0 0 10 10'><path d='M1 1L9 1L5 9Z'/></svg>", 72.0, 72.0, L"black");
    Expect(source.success, L"EMF corruption fixture generation failed");
    if (!source.success) return;
    std::wstring reason;

    std::vector<BYTE> trailing = source.emfBytes;
    trailing.insert(trailing.end(), 4, 0);
    Expect(!ValidateEmfRecords(trailing, &reason), L"EMF trailing data was accepted");

    std::vector<BYTE> truncated = source.emfBytes;
    truncated.resize(truncated.size() - sizeof(EMREOF));
    Expect(!ValidateEmfRecords(truncated, &reason), L"EMF missing EOF was accepted");

    std::vector<BYTE> badCount = source.emfBytes;
    DWORD count = 0;
    std::memcpy(&count, badCount.data() + offsetof(ENHMETAHEADER, nRecords), sizeof(count));
    ++count;
    std::memcpy(badCount.data() + offsetof(ENHMETAHEADER, nRecords), &count, sizeof(count));
    Expect(!ValidateEmfRecords(badCount, &reason), L"EMF record count mismatch was accepted");
}

void TestMathJaxGoldenFixtures(const std::filesystem::path& directory)
{
    size_t count = 0;
    for (const auto& entry : std::filesystem::directory_iterator(directory))
    {
        if (!entry.is_regular_file() || entry.path().extension() != L".svg") continue;
        std::ifstream input(entry.path(), std::ios::binary);
        std::string utf8((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
        const int wideLength = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8.data(),
            static_cast<int>(utf8.size()), nullptr, 0);
        Expect(wideLength > 0, L"golden fixture is not valid UTF-8: " + entry.path().wstring());
        if (wideLength <= 0) continue;
        std::wstring svg(static_cast<size_t>(wideLength), L'\0');
        MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8.data(), static_cast<int>(utf8.size()),
            svg.data(), wideLength);
        SvgToEmfResult result = ConvertMathJaxSvgToVectorEmf(svg, 180.0, 60.0, L"black");
        Expect(result.success, L"real MathJax fixture failed: " + entry.path().filename().wstring() + L": " + result.error);
        ++count;
    }
    Expect(count >= 4, L"real MathJax golden fixture set is incomplete");
}

std::map<DWORD, std::wstring> g_pendingPayloadPaths;

std::string Sha256Hex(const std::string& bytes)
{
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    DWORD objectBytes = 0;
    DWORD hashBytes = 0;
    DWORD resultBytes = 0;
    NTSTATUS status = BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0);
    Expect(status >= 0, L"cannot open SHA-256 provider");
    if (status < 0) return {};
    status = BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectBytes), sizeof(objectBytes), &resultBytes, 0);
    if (status >= 0) status = BCryptGetProperty(algorithm, BCRYPT_HASH_LENGTH, reinterpret_cast<PUCHAR>(&hashBytes), sizeof(hashBytes), &resultBytes, 0);
    std::vector<BYTE> object(objectBytes);
    std::vector<BYTE> digest(hashBytes);
    if (status >= 0) status = BCryptCreateHash(algorithm, &hash, object.data(), objectBytes, nullptr, 0, 0);
    if (status >= 0) status = BCryptHashData(hash, reinterpret_cast<PUCHAR>(const_cast<char*>(bytes.data())), static_cast<ULONG>(bytes.size()), 0);
    if (status >= 0) status = BCryptFinishHash(hash, digest.data(), hashBytes, 0);
    if (hash != nullptr) BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(algorithm, 0);
    Expect(status >= 0 && digest.size() == 32, L"cannot compute SHA-256");
    if (status < 0 || digest.size() != 32) return {};
    static constexpr char kHex[] = "0123456789abcdef";
    std::string result;
    for (BYTE value : digest)
    {
        result.push_back(kHex[value >> 4]);
        result.push_back(kHex[value & 15]);
    }
    return result;
}

std::wstring PendingPayloadPath(const std::string& token)
{
    PWSTR localAppData = nullptr;
    const HRESULT result = SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_DEFAULT, nullptr, &localAppData);
    Expect(SUCCEEDED(result) && localAppData != nullptr, L"cannot resolve LocalAppData for payload fixture");
    if (FAILED(result) || localAppData == nullptr) return {};
    std::filesystem::path path(localAppData);
    CoTaskMemFree(localAppData);
    path /= L"LaTeXSnipper";
    path /= L"OfficePlugin";
    path /= L"PendingPayloads";
    std::filesystem::create_directories(path);
    path /= std::wstring(token.begin(), token.end()) + L".json";
    return path.wstring();
}

void WritePendingPayload(DWORD pid, const std::wstring& payload, long long referenceTicks)
{
    const std::string utf8 = WideToUtf8(payload);
    const std::string hash = Sha256Hex(utf8);
    const std::string token = Sha256Hex(utf8 + std::to_string(pid));
    const std::wstring payloadPath = PendingPayloadPath(token);
    {
        std::ofstream output(payloadPath, std::ios::binary | std::ios::trunc);
        output.write(utf8.data(), static_cast<std::streamsize>(utf8.size()));
        Expect(output.good(), L"cannot write pending payload fixture file");
    }
    g_pendingPayloadPaths[pid] = payloadPath;
    std::wstringstream reference;
    reference << L"{\"schemaVersion\":1,\"token\":\"" << std::wstring(token.begin(), token.end())
              << L"\",\"createdUtcTicks\":" << referenceTicks << L",\"byteLength\":" << utf8.size()
              << L",\"sha256\":\"" << std::wstring(hash.begin(), hash.end()) << L"\"}";
    HKEY key = nullptr;
    const LSTATUS opened = RegCreateKeyExW(
        HKEY_CURRENT_USER,
        L"Software\\LaTeXSnipper\\OfficePlugin\\OleFormulaObject",
        0,
        nullptr,
        0,
        KEY_READ | KEY_WRITE,
        nullptr,
        &key,
        nullptr);
    Expect(opened == ERROR_SUCCESS && key != nullptr, L"cannot create pending payload test key");
    if (key == nullptr) return;
    const std::wstring name = PendingValueName(pid);
    const std::wstring referenceText = reference.str();
    const DWORD bytes = static_cast<DWORD>((referenceText.size() + 1) * sizeof(wchar_t));
    const LSTATUS written = RegSetValueExW(
        key,
        name.c_str(),
        0,
        REG_SZ,
        reinterpret_cast<const BYTE*>(referenceText.c_str()),
        bytes);
    Expect(written == ERROR_SUCCESS, L"cannot write pending payload test value");
    RegCloseKey(key);
}

bool PendingValueExists(DWORD pid)
{
    HKEY key = nullptr;
    if (RegOpenKeyExW(
        HKEY_CURRENT_USER,
        L"Software\\LaTeXSnipper\\OfficePlugin\\OleFormulaObject",
        0,
        KEY_READ,
        &key) != ERROR_SUCCESS)
        return false;
    const std::wstring name = PendingValueName(pid);
    const LSTATUS result = RegQueryValueExW(key, name.c_str(), nullptr, nullptr, nullptr, nullptr);
    RegCloseKey(key);
    return result == ERROR_SUCCESS;
}

void DeletePendingValue(DWORD pid)
{
    HKEY key = nullptr;
    if (RegOpenKeyExW(
        HKEY_CURRENT_USER,
        L"Software\\LaTeXSnipper\\OfficePlugin\\OleFormulaObject",
        0,
        KEY_WRITE,
        &key) != ERROR_SUCCESS)
        return;
    const std::wstring name = PendingValueName(pid);
    RegDeleteValueW(key, name.c_str());
    RegCloseKey(key);
    auto path = g_pendingPayloadPaths.find(pid);
    if (path != g_pendingPayloadPaths.end())
    {
        DeleteFileW(path->second.c_str());
        g_pendingPayloadPaths.erase(path);
    }
}

std::wstring BuildPendingPayload(const std::wstring& formulaId, long long createdUtcTicks)
{
    std::wstringstream json;
    json << L"{\"schemaVersion\":3,\"formulaId\":\"" << formulaId
         << L"\",\"latex\":\"x^2\",\"createdUtcTicks\":" << createdUtcTicks
         << L",\"render\":{\"widthPt\":72,\"heightPt\":72,\"svg\":\""
         << L"<svg viewBox='0 0 10 10'><path d='M1 1L9 1L5 9Z'/></svg>\"}}";
    return json.str();
}

long long CurrentDotNetTicks()
{
    const auto unixTicks = std::chrono::duration_cast<std::chrono::duration<long long, std::ratio<1, 10000000>>>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    return unixTicks + 621355968000000000LL;
}

struct ActivationResult
{
    HRESULT result = E_FAIL;
    DWORD threadId = 0;
    VARIANT_BOOL initialized = VARIANT_FALSE;
    std::wstring formulaId;
};

ActivationResult ActivateThroughClassFactory(DllGetClassObjectFn getClassObject)
{
    ActivationResult activation{};
    activation.threadId = GetCurrentThreadId();
    const HRESULT initializedCom = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    IClassFactory* factory = nullptr;
    activation.result = getClassObject(CLSID_LaTeXSnipperFormula, IID_IClassFactory, reinterpret_cast<void**>(&factory));
    if (SUCCEEDED(activation.result) && factory != nullptr)
    {
        ILatexSnipperFormula* formula = nullptr;
        activation.result = factory->CreateInstance(nullptr, IID_ILatexSnipperFormula, reinterpret_cast<void**>(&formula));
        if (SUCCEEDED(activation.result) && formula != nullptr)
        {
            activation.result = formula->IsInitialized(&activation.initialized);
            BSTR id = nullptr;
            if (SUCCEEDED(activation.result) && SUCCEEDED(formula->GetFormulaId(&id)) && id != nullptr)
            {
                activation.formulaId.assign(id, SysStringLen(id));
                SysFreeString(id);
            }
            formula->Release();
        }
        factory->Release();
    }
    if (SUCCEEDED(initializedCom)) CoUninitialize();
    return activation;
}

void TestPendingPayloadConstructor(const std::wstring& dllPath)
{
    HMODULE module = LoadLibraryW(dllPath.c_str());
    Expect(module != nullptr, L"cannot load OLE DLL for pending payload constructor test: " + dllPath);
    if (module == nullptr) return;
    const auto getClassObject = reinterpret_cast<DllGetClassObjectFn>(GetProcAddress(module, "DllGetClassObject"));
    Expect(getClassObject != nullptr, L"OLE DLL does not export DllGetClassObject");
    if (getClassObject == nullptr)
    {
        FreeLibrary(module);
        return;
    }

    const DWORD pid = GetCurrentProcessId();
    const DWORD unrelatedPid = pid == MAXDWORD ? pid - 1 : pid + 1;
    DeletePendingValue(pid);
    DeletePendingValue(unrelatedPid);
    WritePendingPayload(pid, BuildPendingPayload(L"cross-sta-constructor", CurrentDotNetTicks()), CurrentDotNetTicks());
    WritePendingPayload(unrelatedPid, L"unrelated-process-fixture", CurrentDotNetTicks());

    ActivationResult activation{};
    std::thread worker([&]() { activation = ActivateThroughClassFactory(getClassObject); });
    worker.join();
    Expect(activation.threadId != GetCurrentThreadId(), L"constructor test did not use a different thread");
    Expect(SUCCEEDED(activation.result), L"cross-thread class factory activation failed: " + std::to_wstring(activation.result));
    Expect(activation.initialized == VARIANT_TRUE, L"constructor did not initialize from the same-PID payload");
    Expect(activation.formulaId == L"cross-sta-constructor", L"constructor consumed the wrong payload");
    Expect(PendingValueExists(pid), L"valid pending payload reference should remain during the active lease");
    Expect(PendingValueExists(unrelatedPid), L"constructor removed another PID's payload");
    DeletePendingValue(pid);
    DeletePendingValue(unrelatedPid);

    WritePendingPayload(pid, BuildPendingPayload(L"stale", 1), 1);
    ActivationResult stale = ActivateThroughClassFactory(getClassObject);
    Expect(SUCCEEDED(stale.result), L"stale payload activation failed unexpectedly");
    Expect(stale.initialized == VARIANT_FALSE, L"stale payload initialized the OLE object");
    Expect(!PendingValueExists(pid), L"stale payload was not cleaned up");

    WritePendingPayload(pid, BuildPendingPayload(L"tampered", CurrentDotNetTicks()), CurrentDotNetTicks());
    const std::wstring tamperedPath = g_pendingPayloadPaths[pid];
    {
        std::ofstream output(tamperedPath, std::ios::binary | std::ios::trunc);
        output << "tampered";
    }
    ActivationResult tampered = ActivateThroughClassFactory(getClassObject);
    Expect(SUCCEEDED(tampered.result), L"tampered payload activation failed unexpectedly");
    Expect(tampered.initialized == VARIANT_FALSE, L"tampered payload initialized the OLE object");
    Expect(!PendingValueExists(pid), L"tampered payload reference was not cleaned up");
    Expect(GetFileAttributesW(tamperedPath.c_str()) == INVALID_FILE_ATTRIBUTES, L"tampered payload file was not cleaned up");
    g_pendingPayloadPaths.erase(pid);

    FreeLibrary(module);
}
}

struct FormulaTestObject
{
    ILatexSnipperFormula* formula = nullptr;
    IOleObject* ole = nullptr;

    ~FormulaTestObject()
    {
        if (ole != nullptr) ole->Release();
        if (formula != nullptr) formula->Release();
    }
};

bool CreateFormulaTestObject(DllGetClassObjectFn getClassObject, FormulaTestObject* result)
{
    if (getClassObject == nullptr || result == nullptr) return false;

    IClassFactory* factory = nullptr;
    HRESULT hr = getClassObject(CLSID_LaTeXSnipperFormula, IID_IClassFactory, reinterpret_cast<void**>(&factory));
    if (FAILED(hr) || factory == nullptr) return false;

    hr = factory->CreateInstance(nullptr, IID_ILatexSnipperFormula, reinterpret_cast<void**>(&result->formula));
    factory->Release();
    if (FAILED(hr) || result->formula == nullptr) return false;

    hr = result->formula->QueryInterface(IID_IOleObject, reinterpret_cast<void**>(&result->ole));
    return SUCCEEDED(hr) && result->ole != nullptr;
}

void TestProvisionalExtentIsIgnored(DllGetClassObjectFn getClassObject)
{
    FormulaTestObject object;
    Expect(CreateFormulaTestObject(getClassObject, &object), L"could not create formula COM object");
    if (object.formula == nullptr || object.ole == nullptr) return;

    ATL::CComBSTR payload(
        L"{"
        L"\"schemaVersion\":3,"
        L"\"formulaId\":\"extent-test-provisional\","
        L"\"latex\":\"x^2\","
        L"\"storageMode\":\"ole\","
        L"\"render\":{"
          L"\"widthPt\":72,"
          L"\"heightPt\":36,"
          L"\"svg\":\"<svg viewBox='0 0 10 5'><path d='M1 4L5 1L9 4Z'/></svg>\""
        L"}"
        L"}");

    Expect(SUCCEEDED(object.formula->InitializeFromJson(payload)),
        L"valid extent fixture initialization failed");

    SIZEL provisional{ 20000, 10000 };
    Expect(SUCCEEDED(object.ole->SetExtent(DVASPECT_CONTENT, &provisional)),
        L"provisional SetExtent failed");

    SIZEL actual{};
    Expect(SUCCEEDED(object.ole->GetExtent(DVASPECT_CONTENT, &actual)),
        L"GetExtent failed");

    Expect(actual.cx != provisional.cx || actual.cy != provisional.cy,
        L"provisional extent polluted natural extent");
}

void TestCompletedExtentIsRetained(DllGetClassObjectFn getClassObject)
{
    FormulaTestObject object;
    Expect(CreateFormulaTestObject(getClassObject, &object), L"could not create formula COM object");
    if (object.formula == nullptr || object.ole == nullptr) return;

    ATL::CComBSTR payload(
        L"{"
        L"\"schemaVersion\":3,"
        L"\"formulaId\":\"extent-test-completed\","
        L"\"latex\":\"x^2\","
        L"\"storageMode\":\"ole\","
        L"\"render\":{"
          L"\"widthPt\":72,"
          L"\"heightPt\":36,"
          L"\"svg\":\"<svg viewBox='0 0 10 5'><path d='M1 4L5 1L9 4Z'/></svg>\""
        L"}"
        L"}");

    Expect(SUCCEEDED(object.formula->InitializeFromJson(payload)),
        L"valid extent fixture initialization failed");

    Expect(SUCCEEDED(object.formula->CompleteInsertion()),
        L"CompleteInsertion failed");

    SIZEL resized{ 5000, 2000 };
    Expect(SUCCEEDED(object.ole->SetExtent(DVASPECT_CONTENT, &resized)),
        L"committed SetExtent failed");

    SIZEL actual{};
    object.ole->GetExtent(DVASPECT_CONTENT, &actual);
    Expect(actual.cx == resized.cx && actual.cy == resized.cy,
        L"completed object did not retain extent");
}

int wmain(int argc, wchar_t** argv)
{
    TestPathParser();
    TestVectorFixture(L"simple formula", L"<path fill='currentColor' d='M5 20 L20 5 L35 20 Z'/>");
    TestVectorFixture(L"fraction and radical", L"<g transform='translate(5 5) scale(1.2)'><path d='M0 10 H60 M5 5 Q20 -5 35 5 T55 5' fill='none' stroke='black'/></g>");
    TestVectorFixture(L"sum and integral", L"<path d='M5 5 C20 0 20 40 5 35 S30 10 40 20' fill='none' stroke='currentColor' stroke-width='2'/>");
    TestVectorFixture(L"matrix", L"<rect x='10' y='5' width='90' height='30' fill='none' stroke='black'/><line x1='55' y1='5' x2='55' y2='35' stroke='black'/>");
    TestVectorFixture(L"cases", L"<polyline points='20,5 10,5 10,35 20,35' fill='none' stroke='black'/><polygon points='40,5 70,20 40,35' fill='#336699'/>");
    TestVectorFixture(L"ellipse and arc", L"<circle cx='20' cy='20' r='10'/><ellipse cx='60' cy='20' rx='15' ry='8'/><path d='M80 30 A15 10 20 1 1 110 10' fill='none' stroke='black'/>");
    TestVectorFixture(L"defs and use", L"<defs><path id='glyph' d='M0 0 L8 0 L4 8 Z'/></defs><g transform='translate(10 10) scale(2,-2)'><use href='#glyph'/><use href='#glyph' x='12' color='#ff0000' fill='currentColor'/></g>");
    TestVectorFixture(L"transform order", L"<g transform='translate(20 10) rotate(15 10 10) skewX(5) matrix(1 0 0 1 2 3)'><path d='M0 0 h20 v20 h-20 z'/></g>");
    {
        SvgToEmfResult none = ConvertMathJaxSvgToVectorEmf(
            L"<svg viewBox='0 0 120 40' preserveAspectRatio='none'><path d='M0 0L120 0L120 40L0 40Z'/></svg>",
            240.0, 40.0, L"black");
        Expect(none.success, L"preserveAspectRatio none conversion failed: " + none.error);
        SvgToEmfResult slice = ConvertMathJaxSvgToVectorEmf(
            L"<svg viewBox='0 0 120 40' preserveAspectRatio='xMidYMid slice'><path d='M0 0L120 0L120 40L0 40Z'/></svg>",
            40.0, 120.0, L"black");
        Expect(slice.success, L"slice conversion with clip failed: " + slice.error);
    }

    TestInvalid(L"empty SVG", L"", L"SVG_VECTOR_INVALID_XML");
    TestInvalid(L"external image", L"<svg viewBox='0 0 1 1'><image href='https://example.invalid/a.png'/></svg>", L"SVG_VECTOR_UNSUPPORTED_FEATURE");
    TestInvalid(L"script", L"<svg viewBox='0 0 1 1'><script/></svg>", L"SVG_VECTOR_UNSUPPORTED_FEATURE");
    TestInvalid(L"DTD", L"<!DOCTYPE svg [<!ENTITY x 'x'>]><svg viewBox='0 0 1 1'><path d='M0 0L1 1'/></svg>", L"SVG_VECTOR_UNSUPPORTED_FEATURE");
    TestInvalid(L"incomplete path", L"<svg viewBox='0 0 1 1'><path d='M0 0 L'/></svg>", L"SVG_PATH_INCOMPLETE");
    TestInvalid(L"use cycle", L"<svg viewBox='0 0 1 1'><defs><g id='a'><use href='#a'/></g></defs><use href='#a'/></svg>", L"SVG_VECTOR_USE_CYCLE");
    TestInvalid(L"clip path", L"<svg viewBox='0 0 1 1'><path clip-path='url(#c)' d='M0 0L1 1'/></svg>", L"SVG_VECTOR_UNSUPPORTED_FEATURE");
    TestInvalid(L"mask", L"<svg viewBox='0 0 1 1'><path mask='url(#m)' d='M0 0L1 1'/></svg>", L"SVG_VECTOR_UNSUPPORTED_FEATURE");
    TestInvalid(L"display", L"<svg viewBox='0 0 1 1'><path display='none' d='M0 0L1 1'/></svg>", L"SVG_VECTOR_UNSUPPORTED_FEATURE");
    TestInvalid(L"stroke linecap", L"<svg viewBox='0 0 1 1'><path stroke-linecap='round' d='M0 0L1 1'/></svg>", L"SVG_VECTOR_UNSUPPORTED_FEATURE");
    TestInvalid(L"dash array", L"<svg viewBox='0 0 1 1'><path style='stroke-dasharray:1 1' d='M0 0L1 1'/></svg>", L"SVG_VECTOR_UNSUPPORTED_FEATURE");
    TestInvalid(L"opacity fallback", L"<svg viewBox='0 0 1 1'><path opacity='0.5' d='M0 0L1 1'/></svg>", L"SVG_VECTOR_UNSUPPORTED_FEATURE");
    TestPngFallback();
    TestValidSvgSurvivesInvalidPngFallback();
    TestEmfCorruptionValidation();
    TestStorageValidation();

    DllGetClassObjectFn getClassObject = nullptr;
    if (argc >= 2)
    {
        HMODULE module = LoadLibraryW(argv[1]);
        if (module != nullptr)
        {
            getClassObject = reinterpret_cast<DllGetClassObjectFn>(GetProcAddress(module, "DllGetClassObject"));
        }
    }
    Expect(getClassObject != nullptr, L"OLE DLL path argument is required and must export DllGetClassObject");

    if (getClassObject != nullptr)
    {
        TestProvisionalExtentIsIgnored(getClassObject);
        TestCompletedExtentIsRetained(getClassObject);
        TestPendingPayloadConstructor(argv[1]);
    }
    if (argc >= 3)
        TestMathJaxGoldenFixtures(argv[2]);
    else
        Expect(false, L"MathJax golden fixture directory argument is required");

    if (g_gdiplusToken != 0) Gdiplus::GdiplusShutdown(g_gdiplusToken);
    if (failures == 0)
    {
        std::wcout << L"All NativeVectorTests passed." << std::endl;
        return 0;
    }
    std::wcerr << failures << L" NativeVectorTests failure(s)." << std::endl;
    return 1;
}

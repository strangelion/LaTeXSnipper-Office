#include "Presentation.h"
#include "LaTeXSnipperFormula.h"
#include "OleFormulaIds.h"
#include "SvgPathParser.h"
#include "SvgToEmf.h"
#include "StorageUtil.h"

#include <windows.h>
#include <objidl.h>
#include <gdiplus.h>

#include <cmath>
#include <chrono>
#include <iostream>
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
        const LONG expectedWidth = static_cast<LONG>(std::lround(widthPt * 2540.0 / 72.0));
        const LONG expectedHeight = static_cast<LONG>(std::lround(heightPt * 2540.0 / 72.0));
        Expect(std::abs((header.rclFrame.right - header.rclFrame.left) - expectedWidth) <= 2, name + L": frame width mismatch");
        Expect(std::abs((header.rclFrame.bottom - header.rclFrame.top) - expectedHeight) <= 2, name + L": frame height mismatch");
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

void WritePendingPayload(DWORD pid, const std::wstring& payload)
{
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
    const DWORD bytes = static_cast<DWORD>((payload.size() + 1) * sizeof(wchar_t));
    const LSTATUS written = RegSetValueExW(
        key,
        name.c_str(),
        0,
        REG_SZ,
        reinterpret_cast<const BYTE*>(payload.c_str()),
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
    WritePendingPayload(pid, BuildPendingPayload(L"cross-sta-constructor", CurrentDotNetTicks()));
    WritePendingPayload(unrelatedPid, L"unrelated-process-fixture");

    ActivationResult activation{};
    std::thread worker([&]() { activation = ActivateThroughClassFactory(getClassObject); });
    worker.join();
    Expect(activation.threadId != GetCurrentThreadId(), L"constructor test did not use a different thread");
    Expect(SUCCEEDED(activation.result), L"cross-thread class factory activation failed: " + std::to_wstring(activation.result));
    Expect(activation.initialized == VARIANT_TRUE, L"constructor did not initialize from the same-PID payload");
    Expect(activation.formulaId == L"cross-sta-constructor", L"constructor consumed the wrong payload");
    Expect(!PendingValueExists(pid), L"constructor did not delete the consumed payload");
    Expect(PendingValueExists(unrelatedPid), L"constructor removed another PID's payload");
    DeletePendingValue(unrelatedPid);

    WritePendingPayload(pid, BuildPendingPayload(L"stale", 1));
    ActivationResult stale = ActivateThroughClassFactory(getClassObject);
    Expect(SUCCEEDED(stale.result), L"stale payload activation failed unexpectedly");
    Expect(stale.initialized == VARIANT_FALSE, L"stale payload initialized the OLE object");
    Expect(!PendingValueExists(pid), L"stale payload was not cleaned up");

    FreeLibrary(module);
}
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

    TestInvalid(L"empty SVG", L"", L"SVG_VECTOR_INVALID_XML");
    TestInvalid(L"external image", L"<svg viewBox='0 0 1 1'><image href='https://example.invalid/a.png'/></svg>", L"SVG_VECTOR_UNSUPPORTED_FEATURE");
    TestInvalid(L"script", L"<svg viewBox='0 0 1 1'><script/></svg>", L"SVG_VECTOR_UNSUPPORTED_FEATURE");
    TestInvalid(L"DTD", L"<!DOCTYPE svg [<!ENTITY x 'x'>]><svg viewBox='0 0 1 1'><path d='M0 0L1 1'/></svg>", L"SVG_VECTOR_UNSUPPORTED_FEATURE");
    TestInvalid(L"incomplete path", L"<svg viewBox='0 0 1 1'><path d='M0 0 L'/></svg>", L"SVG_PATH_INCOMPLETE");
    TestInvalid(L"use cycle", L"<svg viewBox='0 0 1 1'><defs><g id='a'><use href='#a'/></g></defs><use href='#a'/></svg>", L"SVG_VECTOR_USE_CYCLE");
    TestPngFallback();
    TestStorageValidation();
    if (argc == 2)
        TestPendingPayloadConstructor(argv[1]);
    else
        Expect(false, L"OLE DLL path argument is required for pending payload constructor tests");

    if (g_gdiplusToken != 0) Gdiplus::GdiplusShutdown(g_gdiplusToken);
    if (failures == 0)
    {
        std::wcout << L"All NativeVectorTests passed." << std::endl;
        return 0;
    }
    std::wcerr << failures << L" NativeVectorTests failure(s)." << std::endl;
    return 1;
}

#include "FormulaOleObject.h"

#include "NativeLog.h"
#include "OleEditSession.h"
#include "OleFormulaIds.h"
#include "StorageUtil.h"
#include "Win32Check.h"

#include <atlconv.h>
#include <comdef.h>
#include <new>
#include <thread>
#include <vector>
#include <string>
#include <sstream>

// Pending payload from registry — consumed during construction so the correct
// formula renders immediately without waiting for InitializeFromJson.
namespace
{
std::wstring ConsumePendingPayload()
{
    constexpr wchar_t kPayloadKey[] = L"Software\\LaTeXSnipper\\OfficePlugin\\OleFormulaObject";
    constexpr wchar_t kPendingPayloadValue[] = L"PendingPayload";

    HKEY key = nullptr;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, kPayloadKey, 0, KEY_READ | KEY_WRITE, &key) != ERROR_SUCCESS)
        return L"";

    DWORD type = 0;
    DWORD byteCount = 0;
    std::wstring payload;
    if (RegQueryValueExW(key, kPendingPayloadValue, nullptr, &type, nullptr, &byteCount) == ERROR_SUCCESS &&
        type == REG_SZ && byteCount >= sizeof(wchar_t))
    {
        payload.resize(byteCount / sizeof(wchar_t));
        RegQueryValueExW(key, kPendingPayloadValue, nullptr, &type,
            reinterpret_cast<BYTE*>(&payload[0]), &byteCount);
        while (!payload.empty() && payload.back() == L'\0')
            payload.pop_back();
    }

    RegDeleteValueW(key, kPendingPayloadValue);
    RegCloseKey(key);
    return payload;
}
}

namespace
{
volatile LONG g_objectCount = 0;
volatile LONG g_lockCount = 0;

// IID_ILatexSnipperFormula is defined in LaTeXSnipperFormula.h

void LogInterfaceQuery(REFIID iid, HRESULT result)
{
    LPOLESTR iidText = nullptr;
    if (FAILED(StringFromIID(iid, &iidText)))
    {
        return;
    }

    wchar_t message[160]{};
    swprintf_s(message, L"FormulaOleObject QueryInterface %s -> 0x%08X", iidText, static_cast<unsigned int>(result));
    WriteNativeOleLog(message);
    CoTaskMemFree(iidText);
}

HRESULT ValidateContentAspect(DWORD aspect)
{
    return aspect == DVASPECT_CONTENT ? S_OK : DV_E_DVASPECT;
}

HGLOBAL CreateMetaFilePictFromEnhancedMetafile(const FormulaPresentation& presentation)
{
    HENHMETAFILE enhancedMetafile = CopyEnhMetaFileFromBytes(presentation.enhancedMetafile);
    if (enhancedMetafile == nullptr)
    {
        return nullptr;
    }

    HDC screen = GetDC(nullptr);
    if (screen == nullptr)
    {
        DeleteEnhMetaFile(enhancedMetafile);
        return nullptr;
    }

    UINT byteCount = GetWinMetaFileBits(enhancedMetafile, 0, nullptr, MM_ANISOTROPIC, screen);
    std::vector<BYTE> bytes(byteCount);
    if (byteCount == 0 || GetWinMetaFileBits(enhancedMetafile, byteCount, bytes.data(), MM_ANISOTROPIC, screen) == 0)
    {
        ReleaseDC(nullptr, screen);
        DeleteEnhMetaFile(enhancedMetafile);
        return nullptr;
    }

    ReleaseDC(nullptr, screen);
    DeleteEnhMetaFile(enhancedMetafile);

    HMETAFILE metafile = SetMetaFileBitsEx(byteCount, bytes.data());
    if (metafile == nullptr)
    {
        return nullptr;
    }

    HGLOBAL handle = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, sizeof(METAFILEPICT));
    if (handle == nullptr)
    {
        DeleteMetaFile(metafile);
        return nullptr;
    }

    auto* picture = static_cast<METAFILEPICT*>(GlobalLock(handle));
    if (picture == nullptr)
    {
        GlobalFree(handle);
        DeleteMetaFile(metafile);
        return nullptr;
    }

    picture->mm = MM_ANISOTROPIC;
    picture->xExt = presentation.himetricSize.cx;
    picture->yExt = presentation.himetricSize.cy;
    picture->hMF = metafile;
    GlobalUnlock(handle);
    return handle;
}
}

LONG GetNativeOleObjectCount()
{
    return g_objectCount;
}

LONG GetNativeOleLockCount()
{
    return g_lockCount;
}

FormulaOleObject::FormulaOleObject()
    : presentation_([]() -> FormulaPresentation {
        // Check registry for a pending payload from the VSTO add-in
        std::wstring pendingJson = ConsumePendingPayload();
        if (!pendingJson.empty())
        {
            FormulaPresentation loaded = CreatePresentationFromPayload(pendingJson);
            if (!loaded.latex.empty())
                return loaded;
        }
        return CreatePlaceholderPresentation(kFormulaDefaultLatex);
    }())
{
    formulaId_.resize(32, L'0');
    WriteNativeOleLog(L"FormulaOleObject constructed.");
    InterlockedIncrement(&g_objectCount);
}

FormulaOleObject::~FormulaOleObject()
{
    WriteNativeOleLog(L"FormulaOleObject destructed.");
    InterlockedDecrement(&g_objectCount);
}

void FormulaOleObject::NotifyPresentationChanged()
{
    if (viewAdviseSink_ != nullptr)
    {
        viewAdviseSink_->OnViewChange(DVASPECT_CONTENT, -1);
    }

    if (objectAdviseSink_ != nullptr)
    {
        objectAdviseSink_->OnViewChange(DVASPECT_CONTENT, -1);
    }

    if (dataAdviseSink_ != nullptr)
    {
        STGMEDIUM medium{};
        if (SUCCEEDED(GetData(&dataAdviseFormat_, &medium)))
        {
            dataAdviseSink_->OnDataChange(&dataAdviseFormat_, &medium);
            ReleaseStgMedium(&medium);
        }
    }

    if (clientSite_ != nullptr)
    {
        clientSite_->SaveObject();
    }
}

// -------------------------------------------------------------------
// IEnumFORMATETC implementation for EnumFormatEtc — returns EMF + MFPICT
// -------------------------------------------------------------------
class FormulaFormatEnum final : public IEnumFORMATETC
{
public:
    FormulaFormatEnum(const FORMATETC* formats, UINT count)
        : formats_(formats), count_(count), index_(0)
    {
    }

    // IUnknown
    STDMETHOD(QueryInterface)(REFIID iid, void** object) override
    {
        if (object == nullptr) return E_POINTER;
        *object = nullptr;
        if (iid == IID_IUnknown || iid == IID_IEnumFORMATETC)
        {
            *object = this;
            AddRef();
            return S_OK;
        }
        return E_NOINTERFACE;
    }

    STDMETHOD_(ULONG, AddRef)() override { return InterlockedIncrement(&refCount_); }
    STDMETHOD_(ULONG, Release)() override
    {
        ULONG count = InterlockedDecrement(&refCount_);
        if (count == 0) delete this;
        return count;
    }

    // IEnumFORMATETC
    STDMETHOD(Next)(ULONG requested, FORMATETC* output, ULONG* fetched) override
    {
        if (output == nullptr) return E_POINTER;
        ULONG copied = 0;
        while (index_ < count_ && copied < requested)
        {
            output[copied] = formats_[index_];
            if (formats_[index_].ptd != nullptr)
            {
                output[copied].ptd = static_cast<DVTARGETDEVICE*>(CoTaskMemAlloc(sizeof(DVTARGETDEVICE)));
                if (output[copied].ptd)
                    *output[copied].ptd = *formats_[index_].ptd;
            }
            ++index_;
            ++copied;
        }
        if (fetched) *fetched = copied;
        return copied == requested ? S_OK : S_FALSE;
    }

    STDMETHOD(Skip)(ULONG skip) override
    {
        if (index_ + skip > count_) return S_FALSE;
        index_ += skip;
        return S_OK;
    }

    STDMETHOD(Reset)() override { index_ = 0; return S_OK; }

    STDMETHOD(Clone)(IEnumFORMATETC** out) override
    {
        if (out == nullptr) return E_POINTER;
        FormulaFormatEnum* clone = new (std::nothrow) FormulaFormatEnum(formats_, count_);
        if (clone == nullptr) return E_OUTOFMEMORY;
        clone->index_ = index_;
        *out = clone;
        return S_OK;
    }

private:
    const FORMATETC* formats_;
    UINT count_;
    UINT index_;
    volatile LONG refCount_ = 1;
};

STDMETHODIMP FormulaOleObject::QueryInterface(REFIID iid, void** object)
{
    if (object == nullptr)
    {
        return E_POINTER;
    }

    if (iid == IID_IUnknown || iid == IID_IOleObject)
    {
        *object = static_cast<IOleObject*>(this);
    }
    else if (iid == IID_IDataObject)
    {
        *object = static_cast<IDataObject*>(this);
    }
    else if (iid == IID_IViewObject)
    {
        *object = static_cast<IViewObject*>(this);
    }
    else if (iid == IID_IViewObject2)
    {
        *object = static_cast<IViewObject2*>(this);
    }
    else if (iid == IID_IRunnableObject)
    {
        *object = static_cast<IRunnableObject*>(this);
    }
    else if (iid == IID_IOleCache)
    {
        *object = static_cast<IOleCache*>(this);
    }
    else if (iid == IID_IExternalConnection)
    {
        *object = static_cast<IExternalConnection*>(this);
    }
    else if (iid == IID_IPersist || iid == IID_IPersistStorage)
    {
        *object = static_cast<IPersistStorage*>(this);
    }
    else if (iid == IID_ILatexSnipperFormula || iid == IID_IDispatch)
    {
        *object = static_cast<ILatexSnipperFormula*>(this);
    }
    else
    {
        *object = nullptr;
        LogInterfaceQuery(iid, E_NOINTERFACE);
        return E_NOINTERFACE;
    }

    AddRef();
    LogInterfaceQuery(iid, S_OK);
    return S_OK;
}

STDMETHODIMP_(ULONG) FormulaOleObject::AddRef()
{
    return static_cast<ULONG>(InterlockedIncrement(&refCount_));
}

STDMETHODIMP_(ULONG) FormulaOleObject::Release()
{
    const ULONG remaining = static_cast<ULONG>(InterlockedDecrement(&refCount_));
    if (remaining == 0)
    {
        delete this;
    }

    return remaining;
}

STDMETHODIMP FormulaOleObject::SetClientSite(IOleClientSite* clientSite)
{
    WriteNativeOleLog(L"FormulaOleObject SetClientSite.");
    clientSite_ = clientSite;
    return S_OK;
}

STDMETHODIMP FormulaOleObject::GetClientSite(IOleClientSite** clientSite)
{
    if (clientSite == nullptr)
    {
        return E_POINTER;
    }

    return clientSite_.CopyTo(clientSite);
}

STDMETHODIMP FormulaOleObject::SetHostNames(LPCOLESTR, LPCOLESTR)
{
    return S_OK;
}

STDMETHODIMP FormulaOleObject::Close(DWORD)
{
    clientSite_.Release();
    return S_OK;
}

STDMETHODIMP FormulaOleObject::SetMoniker(DWORD, IMoniker*)
{
    return S_OK;
}

STDMETHODIMP FormulaOleObject::GetMoniker(DWORD, DWORD, IMoniker** moniker)
{
    if (moniker == nullptr)
    {
        return E_POINTER;
    }

    *moniker = nullptr;
    return E_NOTIMPL;
}

STDMETHODIMP FormulaOleObject::InitFromData(IDataObject*, BOOL, DWORD)
{
    return S_OK;
}

STDMETHODIMP FormulaOleObject::GetClipboardData(DWORD, IDataObject** dataObject)
{
    if (dataObject == nullptr)
    {
        return E_POINTER;
    }

    return QueryInterface(IID_IDataObject, reinterpret_cast<void**>(dataObject));
}

STDMETHODIMP FormulaOleObject::DoVerb(LONG verb, LPMSG, IOleClientSite*, LONG, HWND, LPCRECT)
{
    WriteNativeOleLog(L"FormulaOleObject DoVerb.");

    // User double-click / primary action: open editor
    if (verb == OLEIVERB_PRIMARY || verb == 0 || verb == 1)
    {
        return StartEditSession();
    }

    // OLEIVERB_SHOW: Office requests display (e.g. open doc, activate, refresh).
    // Do NOT open editor — only refresh the preview.
    if (verb == OLEIVERB_SHOW || verb == OLEIVERB_OPEN)
    {
        NotifyPresentationChanged();
        return S_OK;
    }

    if (verb == 2)
    {
        // Verb 2: Copy LaTeX to clipboard
        return CopyLatexToClipboard();
    }

    if (verb == 3)
    {
        // Verb 3: Refresh Preview — re-render and update the preview.
        // Do NOT open the editor (the previous implementation started EditSession).
        NotifyPresentationChanged();
        return S_OK;
    }

    return OLEOBJ_S_CANNOT_DOVERB_NOW;
}

STDMETHODIMP FormulaOleObject::EnumVerbs(IEnumOLEVERB** enumOleVerb)
{
    if (enumOleVerb == nullptr)
        return E_POINTER;

    // Register verbs in the registry so Office can enumerate them
    // via OleRegEnumVerbs. Use standard OLE API instead of custom enum.
    return OleRegEnumVerbs(CLSID_LaTeXSnipperFormula, enumOleVerb);
}

STDMETHODIMP FormulaOleObject::Update()
{
    return S_OK;
}

STDMETHODIMP FormulaOleObject::IsUpToDate()
{
    return S_OK;
}

STDMETHODIMP FormulaOleObject::GetUserClassID(CLSID* classId)
{
    if (classId == nullptr)
    {
        return E_POINTER;
    }

    *classId = CLSID_LaTeXSnipperFormula;
    return S_OK;
}

STDMETHODIMP FormulaOleObject::GetUserType(DWORD, LPOLESTR* userType)
{
    if (userType == nullptr)
    {
        return E_POINTER;
    }

    const size_t length = wcslen(kFormulaFriendlyName) + 1;
    *userType = static_cast<LPOLESTR>(CoTaskMemAlloc(length * sizeof(wchar_t)));
    if (*userType == nullptr)
    {
        return E_OUTOFMEMORY;
    }

    wcscpy_s(*userType, length, kFormulaFriendlyName);
    return S_OK;
}

STDMETHODIMP FormulaOleObject::SetExtent(DWORD drawAspect, SIZEL* size)
{
    if (size == nullptr)
    {
        return E_POINTER;
    }

    HRESULT aspectResult = ValidateContentAspect(drawAspect);
    if (FAILED(aspectResult))
    {
        return aspectResult;
    }

    presentation_.himetricSize = {size->cx, size->cy};
    return S_OK;
}

STDMETHODIMP FormulaOleObject::GetExtent(DWORD drawAspect, SIZEL* size)
{
    if (size == nullptr)
    {
        return E_POINTER;
    }

    HRESULT aspectResult = ValidateContentAspect(drawAspect);
    if (FAILED(aspectResult))
    {
        return aspectResult;
    }

    size->cx = presentation_.himetricSize.cx;
    size->cy = presentation_.himetricSize.cy;
    return S_OK;
}

STDMETHODIMP FormulaOleObject::Advise(IAdviseSink* adviseSink, DWORD* connection)
{
    if (connection == nullptr)
    {
        return E_POINTER;
    }

    if (adviseSink == nullptr)
    {
        return E_POINTER;
    }

    objectAdviseSink_ = adviseSink;
    *connection = 1;
    return S_OK;
}

STDMETHODIMP FormulaOleObject::Unadvise(DWORD connection)
{
    if (connection != 1 || objectAdviseSink_ == nullptr)
    {
        return OLE_E_NOCONNECTION;
    }

    objectAdviseSink_.Release();
    return S_OK;
}

STDMETHODIMP FormulaOleObject::EnumAdvise(IEnumSTATDATA** enumAdvise)
{
    if (enumAdvise == nullptr)
    {
        return E_POINTER;
    }

    *enumAdvise = nullptr;
    return S_FALSE;
}

STDMETHODIMP FormulaOleObject::GetMiscStatus(DWORD aspect, DWORD* status)
{
    WriteNativeOleLog(L"FormulaOleObject GetMiscStatus.");
    if (status == nullptr)
    {
        return E_POINTER;
    }

    HRESULT aspectResult = ValidateContentAspect(aspect);
    if (FAILED(aspectResult))
    {
        return aspectResult;
    }

    *status = OLEMISC_CANTLINKINSIDE
        | OLEMISC_RENDERINGISDEVICEINDEPENDENT
        | OLEMISC_SETCLIENTSITEFIRST
        | OLEMISC_IGNOREACTIVATEWHENVISIBLE;
    return S_OK;
}

STDMETHODIMP FormulaOleObject::SetColorScheme(LOGPALETTE*)
{
    return S_OK;
}

STDMETHODIMP FormulaOleObject::GetData(FORMATETC* format, STGMEDIUM* medium)
{
    WriteNativeOleLog(L"FormulaOleObject GetData.");
    // Apply any pending async edit result before serving data
    ApplyPendingEditResult();
    if (format == nullptr || medium == nullptr)
    {
        return E_POINTER;
    }

    HRESULT queryResult = QueryGetData(format);
    if (FAILED(queryResult))
    {
        return queryResult;
    }

    if (format->cfFormat == CF_ENHMETAFILE)
    {
        HENHMETAFILE metafile = CopyEnhMetaFileFromBytes(presentation_.enhancedMetafile);
        if (metafile == nullptr)
        {
            return E_FAIL;
        }

        medium->tymed = TYMED_ENHMF;
        medium->hEnhMetaFile = metafile;
        medium->pUnkForRelease = nullptr;
        return S_OK;
    }

    HGLOBAL metafilePict = CreateMetaFilePictFromEnhancedMetafile(presentation_);
    if (metafilePict == nullptr)
    {
        return E_FAIL;
    }

    medium->tymed = TYMED_MFPICT;
    medium->hMetaFilePict = metafilePict;
    medium->pUnkForRelease = nullptr;
    return S_OK;
}

STDMETHODIMP FormulaOleObject::GetDataHere(FORMATETC*, STGMEDIUM*)
{
    return DATA_E_FORMATETC;
}

STDMETHODIMP FormulaOleObject::QueryGetData(FORMATETC* format)
{
    if (format == nullptr)
    {
        return E_POINTER;
    }

    wchar_t message[160]{};
    swprintf_s(
        message,
        L"FormulaOleObject QueryGetData cf=%u tymed=0x%08X aspect=%u lindex=%ld",
        static_cast<unsigned int>(format->cfFormat),
        static_cast<unsigned int>(format->tymed),
        static_cast<unsigned int>(format->dwAspect),
        format->lindex);
    WriteNativeOleLog(message);

    if (format->cfFormat == CF_ENHMETAFILE)
    {
        return (format->tymed & TYMED_ENHMF) == 0 ? DV_E_TYMED : ValidateContentAspect(format->dwAspect);
    }

    if (format->cfFormat == CF_METAFILEPICT)
    {
        return (format->tymed & TYMED_MFPICT) == 0 ? DV_E_TYMED : ValidateContentAspect(format->dwAspect);
    }

    return DV_E_FORMATETC;
}

STDMETHODIMP FormulaOleObject::GetCanonicalFormatEtc(FORMATETC*, FORMATETC* output)
{
    if (output == nullptr)
    {
        return E_POINTER;
    }

    ZeroMemory(output, sizeof(*output));
    output->ptd = nullptr;
    return DATA_S_SAMEFORMATETC;
}

STDMETHODIMP FormulaOleObject::SetData(FORMATETC* format, STGMEDIUM* medium, BOOL release)
{
    if (format == nullptr || medium == nullptr)
    {
        return E_POINTER;
    }

    if (release)
    {
        ReleaseStgMedium(medium);
    }

    return S_OK;
}

STDMETHODIMP FormulaOleObject::EnumFormatEtc(DWORD direction, IEnumFORMATETC** enumFormatEtc)
{
    if (enumFormatEtc == nullptr)
    {
        return E_POINTER;
    }

    *enumFormatEtc = nullptr;

    // Only support GET direction (what data we provide)
    if (direction != DATADIR_GET)
    {
        return E_NOTIMPL;
    }

    // Return the formats our IDataObject::GetData() supports:
    //   CF_ENHMETAFILE  — EMF picture rendering
    //   CF_METAFILEPICT — legacy metafile fallback
    static const FORMATETC formats[] = {
        {CF_ENHMETAFILE,  nullptr, DVASPECT_CONTENT, -1, TYMED_ENHMF},
        {CF_METAFILEPICT, nullptr, DVASPECT_CONTENT, -1, TYMED_MFPICT},
    };

    *enumFormatEtc = new (std::nothrow) FormulaFormatEnum(formats, ARRAYSIZE(formats));
    return *enumFormatEtc != nullptr ? S_OK : E_OUTOFMEMORY;
}

STDMETHODIMP FormulaOleObject::DAdvise(FORMATETC* format, DWORD adviseFlags, IAdviseSink* adviseSink, DWORD* connection)
{
    if (connection == nullptr)
    {
        return E_POINTER;
    }

    if (format == nullptr || adviseSink == nullptr)
    {
        return E_POINTER;
    }

    HRESULT queryResult = QueryGetData(format);
    if (FAILED(queryResult))
    {
        return queryResult;
    }

    dataAdviseSink_ = adviseSink;
    dataAdviseFormat_ = *format;
    dataAdviseFlags_ = adviseFlags;
    *connection = 1;
    return S_OK;
}

STDMETHODIMP FormulaOleObject::DUnadvise(DWORD connection)
{
    if (connection != 1 || dataAdviseSink_ == nullptr)
    {
        return OLE_E_NOCONNECTION;
    }

    dataAdviseSink_.Release();
    dataAdviseFormat_ = {};
    dataAdviseFlags_ = 0;
    return S_OK;
}

STDMETHODIMP FormulaOleObject::EnumDAdvise(IEnumSTATDATA** enumAdvise)
{
    if (enumAdvise == nullptr)
    {
        return E_POINTER;
    }

    *enumAdvise = nullptr;
    return S_FALSE;
}

STDMETHODIMP FormulaOleObject::Draw(DWORD drawAspect, LONG, void*, DVTARGETDEVICE*, HDC, HDC drawContext, LPCRECTL bounds, LPCRECTL, BOOL(__stdcall*)(ULONG_PTR), ULONG_PTR)
{
    WriteNativeOleLog(L"FormulaOleObject Draw.");
    // Apply any pending async edit result before rendering
    ApplyPendingEditResult();
    HRESULT aspectResult = ValidateContentAspect(drawAspect);
    if (FAILED(aspectResult))
    {
        return aspectResult;
    }

    if (drawContext == nullptr || bounds == nullptr)
    {
        return E_POINTER;
    }

    HENHMETAFILE metafile = CopyEnhMetaFileFromBytes(presentation_.enhancedMetafile);
    if (metafile == nullptr)
    {
        return E_FAIL;
    }

    RECT rect{bounds->left, bounds->top, bounds->right, bounds->bottom};
    BOOL played = PlayEnhMetaFile(drawContext, metafile, &rect);
    DeleteEnhMetaFile(metafile);
    return played ? S_OK : HResultFromWin32LastError();
}

STDMETHODIMP FormulaOleObject::GetColorSet(DWORD, LONG, void*, DVTARGETDEVICE*, HDC, LOGPALETTE** colorSet)
{
    if (colorSet == nullptr)
    {
        return E_POINTER;
    }

    *colorSet = nullptr;
    return S_FALSE;
}

STDMETHODIMP FormulaOleObject::Freeze(DWORD, LONG, void*, DWORD* freeze)
{
    if (freeze == nullptr)
    {
        return E_POINTER;
    }

    *freeze = 0;
    return E_NOTIMPL;
}

STDMETHODIMP FormulaOleObject::Unfreeze(DWORD)
{
    return E_NOTIMPL;
}

STDMETHODIMP FormulaOleObject::SetAdvise(DWORD aspects, DWORD advf, IAdviseSink* adviseSink)
{
    WriteNativeOleLog(L"FormulaOleObject SetAdvise.");
    viewAdviseAspects_ = aspects;
    viewAdviseFlags_ = advf;
    viewAdviseSink_ = adviseSink;
    return S_OK;
}

STDMETHODIMP FormulaOleObject::GetAdvise(DWORD* aspects, DWORD* advf, IAdviseSink** adviseSink)
{
    if (aspects != nullptr)
    {
        *aspects = viewAdviseAspects_;
    }

    if (advf != nullptr)
    {
        *advf = viewAdviseFlags_;
    }

    if (adviseSink != nullptr)
    {
        return viewAdviseSink_.CopyTo(adviseSink);
    }

    return S_OK;
}

STDMETHODIMP FormulaOleObject::GetExtent(DWORD drawAspect, LONG, DVTARGETDEVICE*, SIZEL* size)
{
    if (size == nullptr)
    {
        return E_POINTER;
    }

    HRESULT aspectResult = ValidateContentAspect(drawAspect);
    if (FAILED(aspectResult))
    {
        return aspectResult;
    }

    size->cx = presentation_.himetricSize.cx;
    size->cy = presentation_.himetricSize.cy;
    return S_OK;
}

STDMETHODIMP FormulaOleObject::GetRunningClass(LPCLSID classId)
{
    if (classId == nullptr)
    {
        return E_POINTER;
    }

    *classId = CLSID_LaTeXSnipperFormula;
    return S_OK;
}

STDMETHODIMP FormulaOleObject::Run(LPBINDCTX)
{
    WriteNativeOleLog(L"FormulaOleObject Run.");
    return S_OK;
}

STDMETHODIMP_(BOOL) FormulaOleObject::IsRunning()
{
    WriteNativeOleLog(L"FormulaOleObject IsRunning.");
    return TRUE;
}

STDMETHODIMP FormulaOleObject::LockRunning(BOOL lock, BOOL)
{
    WriteNativeOleLog(L"FormulaOleObject LockRunning.");
    if (lock)
    {
        InterlockedIncrement(&g_lockCount);
    }
    else
    {
        InterlockedDecrement(&g_lockCount);
    }

    return S_OK;
}

STDMETHODIMP FormulaOleObject::SetContainedObject(BOOL)
{
    WriteNativeOleLog(L"FormulaOleObject SetContainedObject.");
    return S_OK;
}

STDMETHODIMP FormulaOleObject::Cache(FORMATETC* format, DWORD, DWORD* connection)
{
    WriteNativeOleLog(L"FormulaOleObject Cache.");
    if (connection == nullptr)
    {
        return E_POINTER;
    }

    if (format != nullptr && format->cfFormat != 0)
    {
        HRESULT queryResult = QueryGetData(format);
        if (FAILED(queryResult))
        {
            return queryResult;
        }
    }

    *connection = cacheConnection_++;
    return S_OK;
}

STDMETHODIMP FormulaOleObject::Uncache(DWORD)
{
    WriteNativeOleLog(L"FormulaOleObject Uncache.");
    return S_OK;
}

STDMETHODIMP FormulaOleObject::EnumCache(IEnumSTATDATA** enumStatData)
{
    WriteNativeOleLog(L"FormulaOleObject EnumCache.");
    if (enumStatData == nullptr)
    {
        return E_POINTER;
    }

    *enumStatData = nullptr;
    return E_NOTIMPL;
}

STDMETHODIMP FormulaOleObject::InitCache(IDataObject*)
{
    WriteNativeOleLog(L"FormulaOleObject InitCache.");
    return S_OK;
}

STDMETHODIMP_(DWORD) FormulaOleObject::AddConnection(DWORD, DWORD)
{
    WriteNativeOleLog(L"FormulaOleObject AddConnection.");
    return static_cast<DWORD>(InterlockedIncrement(&g_lockCount));
}

STDMETHODIMP_(DWORD) FormulaOleObject::ReleaseConnection(DWORD, DWORD, BOOL)
{
    WriteNativeOleLog(L"FormulaOleObject ReleaseConnection.");
    LONG value = InterlockedDecrement(&g_lockCount);
    return value < 0 ? 0 : static_cast<DWORD>(value);
}

STDMETHODIMP FormulaOleObject::GetClassID(CLSID* classId)
{
    if (classId == nullptr)
    {
        return E_POINTER;
    }

    *classId = CLSID_LaTeXSnipperFormula;
    return S_OK;
}

STDMETHODIMP FormulaOleObject::IsDirty()
{
    return dirty_ ? S_OK : S_FALSE;
}

STDMETHODIMP FormulaOleObject::InitNew(IStorage* storage)
{
    WriteNativeOleLog(L"FormulaOleObject InitNew.");
    if (storage == nullptr)
    {
        return E_POINTER;
    }

    HRESULT result = WriteClassStg(storage, CLSID_LaTeXSnipperFormula);
    if (FAILED(result))
    {
        return result;
    }

    CLIPFORMAT nativeFormat = static_cast<CLIPFORMAT>(RegisterClipboardFormatW(kFormulaFriendlyName));
    result = WriteFmtUserTypeStg(storage, nativeFormat, const_cast<LPOLESTR>(kFormulaFriendlyName));
    if (FAILED(result))
    {
        return result;
    }

    storage_ = storage;
    dirty_ = true;
    return S_OK;
}

STDMETHODIMP FormulaOleObject::Load(IStorage* storage)
{
    // Try v3 envelope first
    std::wstring envelopeJson;
    if (SUCCEEDED(LoadEnvelopeFromStorage(storage, &envelopeJson)))
    {
        std::wstring id = ExtractJsonString(envelopeJson, L"formulaId");
        if (!id.empty())
            formulaId_ = id;
        canonicalPayloadJson_ = envelopeJson; // store canonical JSON
    }

    // Load presentation (v3 envelope or legacy streams)
    FormulaPresentation loaded;
    HRESULT result = LoadPresentationFromStorage(storage, &loaded);
    if (SUCCEEDED(result))
    {
        storage_ = storage;
        presentation_ = std::move(loaded);
        dirty_ = false;
    }

    return SUCCEEDED(result) ? S_OK : result;
}

STDMETHODIMP FormulaOleObject::Save(IStorage* storage, BOOL)
{
    // Apply any pending async edit result before persisting
    ApplyPendingEditResult();

    // Transactional save: backup existing data first, then restore if envelope fails.
    // This prevents payload/preview inconsistency when envelope write fails.
    std::vector<BYTE> backupPayload, backupEmf;
    {
        HRESULT hr = StorageUtilBackup(storage, &backupPayload, &backupEmf);
        if (FAILED(hr))
        {
            WriteNativeOleLog(L"Save: Backup failed; continuing without rollback capability.");
        }
    }

    HRESULT result = SavePresentationToStorage(storage, presentation_);
    if (SUCCEEDED(result))
    {
        // Use canonical payload JSON for the envelope stream
        std::wstring envelopeJson;
        if (!canonicalPayloadJson_.empty())
        {
            envelopeJson = canonicalPayloadJson_;
        }
        else
        {
            // Minimal fallback — should not happen after InitializeFromJson
            envelopeJson = L"{\"formulaId\":\"";
            envelopeJson += formulaId_;
            envelopeJson += L"\",\"latex\":\"";
            envelopeJson += presentation_.latex;
            envelopeJson += L"\",\"schemaVersion\":3,\"revision\":0,\"storageMode\":\"ole\"}";
        }

        // Validate envelope JSON is well-formed before writing
        if (envelopeJson.find(L"\"formulaId\"") == std::wstring::npos ||
            envelopeJson.find(L"\"latex\"") == std::wstring::npos)
        {
            WriteNativeOleLog(L"Save: Envelope JSON validation failed — missing required fields.");
            StorageUtilRestore(storage, backupPayload, backupEmf);
            return STG_E_INVALIDPARAMETER;
        }

        result = SaveEnvelopeToStorage(storage, envelopeJson);
        if (SUCCEEDED(result))
        {
            dirty_ = false;
        }
        else
        {
            // Envelope save failed — restore backed-up payload and EMF
            WriteNativeOleLog(L"Save: Envelope save failed — restoring payload from backup.");
            StorageUtilRestore(storage, backupPayload, backupEmf);
        }
    }

    return result;
}

STDMETHODIMP FormulaOleObject::SaveCompleted(IStorage*)
{
    if (storage_ != nullptr)
    {
        storage_->Commit(STGC_DEFAULT);
    }

    return S_OK;
}

STDMETHODIMP FormulaOleObject::HandsOffStorage()
{
    storage_.Release();
    return S_OK;
}

// ===================================================================
// ILatexSnipperFormula implementation
// ===================================================================

STDMETHODIMP FormulaOleObject::InitializeFromJson(BSTR payloadJson)
{
    if (payloadJson == nullptr)
        return E_POINTER;

    _bstr_t json(payloadJson);
    std::wstring wsJson((const wchar_t*)json, json.length());

    // Validate required fields
    std::wstring formulaId = ExtractJsonString(wsJson, L"formulaId");
    if (formulaId.empty())
    {
        WriteNativeOleLog(L"FormulaOleObject: InitializeFromJson rejected — missing formulaId");
        return E_INVALIDARG;
    }

    double schemaVersion = ExtractJsonNumber(wsJson, L"schemaVersion");
    if (schemaVersion < 1.0 || schemaVersion > 5.0)
    {
        WriteNativeOleLog(L"FormulaOleObject: InitializeFromJson rejected — incompatible schemaVersion");
        return E_INVALIDARG;
    }

    std::wstring latex = ExtractJsonString(wsJson, L"latex");
    if (latex.empty())
    {
        WriteNativeOleLog(L"FormulaOleObject: InitializeFromJson rejected — empty latex");
        return E_INVALIDARG;
    }

    std::wstring storageMode = ExtractJsonString(wsJson, L"storageMode");
    if (storageMode.empty())
    {
        // Default to "ole" for OLE objects
        storageMode = L"ole";
    }

    FormulaPresentation loaded = CreatePresentationFromPayload(wsJson);
    if (loaded.latex.empty())
        return E_FAIL;

    presentation_ = std::move(loaded);
    canonicalPayloadJson_ = wsJson;
    formulaId_ = formulaId;
    dirty_ = true;

    NotifyPresentationChanged();
    WriteNativeOleLog(L"FormulaOleObject initialized from JSON payload.");
    return S_OK;
}

STDMETHODIMP FormulaOleObject::GetPayloadJson(BSTR* payloadJson)
{
    if (payloadJson == nullptr)
        return E_POINTER;

    // Return the canonical JSON stored during InitializeFromJson/ReplacePayloadJson/Load
    // Fallback: construct a minimal payload if no canonical JSON is available
    std::wstring json;
    if (!canonicalPayloadJson_.empty())
    {
        json = canonicalPayloadJson_;
    }
    else
    {
        json = L"{\"formulaId\":\"";
        json += formulaId_;
        json += L"\",\"latex\":\"";
        json += presentation_.latex;
        json += L"\",\"schemaVersion\":3,\"revision\":0}";
    }

    *payloadJson = SysAllocString(json.c_str());
    return *payloadJson != nullptr ? S_OK : E_OUTOFMEMORY;
}

STDMETHODIMP FormulaOleObject::ReplacePayloadJson(BSTR payloadJson)
{
    if (payloadJson == nullptr)
        return E_POINTER;

    _bstr_t json(payloadJson);
    std::wstring wsJson((const wchar_t*)json, json.length());

    canonicalPayloadJson_ = wsJson; // store canonical JSON first

    return InitializeFromJson(payloadJson);
}

STDMETHODIMP FormulaOleObject::GetFormulaId(BSTR* formulaId)
{
    if (formulaId == nullptr)
        return E_POINTER;

    *formulaId = SysAllocString(formulaId_.c_str());
    return *formulaId != nullptr ? S_OK : E_OUTOFMEMORY;
}

STDMETHODIMP FormulaOleObject::OpenEditor()
{
    return StartEditSession();
}

// ===================================================================
// IDispatch implementation (no type library — manual dispatch table)
// ===================================================================

STDMETHODIMP FormulaOleObject::GetTypeInfoCount(UINT* pctinfo)
{
    if (pctinfo == nullptr) return E_POINTER;
    *pctinfo = 0; // no type library
    return S_OK;
}

STDMETHODIMP FormulaOleObject::GetTypeInfo(UINT, LCID, ITypeInfo** ppTInfo)
{
    if (ppTInfo == nullptr) return E_POINTER;
    *ppTInfo = nullptr;
    return E_NOTIMPL;
}

STDMETHODIMP FormulaOleObject::GetIDsOfNames(REFIID, LPOLESTR* rgszNames, UINT cNames, LCID, DISPID* rgDispId)
{
    if (rgszNames == nullptr || rgDispId == nullptr) return E_POINTER;
    if (cNames == 0) return S_OK;

    *rgDispId = DISPID_UNKNOWN;

    struct NameToDispId { const wchar_t* name; DISPID id; };
    static constexpr NameToDispId kDispatchTable[] = {
        { L"InitializeFromJson", 1 },
        { L"GetPayloadJson",     2 },
        { L"ReplacePayloadJson", 3 },
        { L"GetFormulaId",       4 },
        { L"OpenEditor",         5 },
    };

    for (const auto& entry : kDispatchTable)
    {
        if (_wcsicmp(rgszNames[0], entry.name) == 0)
        {
            *rgDispId = entry.id;
            return S_OK;
        }
    }

    return DISP_E_UNKNOWNNAME;
}

STDMETHODIMP FormulaOleObject::Invoke(DISPID dispIdMember, REFIID, LCID, WORD wFlags, DISPPARAMS* pDispParams, VARIANT* pVarResult, EXCEPINFO* pExcepInfo, UINT* puArgErr)
{
    if (pDispParams == nullptr) return E_POINTER;

    switch (dispIdMember)
    {
    case 1: // InitializeFromJson
        if (pDispParams->cArgs >= 1 && pDispParams->rgvarg[0].vt == VT_BSTR)
        {
            return InitializeFromJson(pDispParams->rgvarg[0].bstrVal);
        }
        return DISP_E_TYPEMISMATCH;

    case 2: // GetPayloadJson
        if (pVarResult != nullptr && (wFlags & DISPATCH_METHOD))
        {
            BSTR result = nullptr;
            HRESULT hr = GetPayloadJson(&result);
            if (SUCCEEDED(hr))
            {
                VariantClear(pVarResult);
                pVarResult->vt = VT_BSTR;
                pVarResult->bstrVal = result;
            }
            return hr;
        }
        return DISP_E_MEMBERNOTFOUND;

    case 3: // ReplacePayloadJson
        if (pDispParams->cArgs >= 1 && pDispParams->rgvarg[0].vt == VT_BSTR)
        {
            return ReplacePayloadJson(pDispParams->rgvarg[0].bstrVal);
        }
        return DISP_E_TYPEMISMATCH;

    case 4: // GetFormulaId
        if (pVarResult != nullptr && (wFlags & DISPATCH_METHOD))
        {
            BSTR result = nullptr;
            HRESULT hr = GetFormulaId(&result);
            if (SUCCEEDED(hr))
            {
                VariantClear(pVarResult);
                pVarResult->vt = VT_BSTR;
                pVarResult->bstrVal = result;
            }
            return hr;
        }
        return DISP_E_MEMBERNOTFOUND;

    case 5: // OpenEditor
        return OpenEditor();

    default:
        return DISP_E_MEMBERNOTFOUND;
    }
}

/// Verb 2: Copy LaTeX source to clipboard as Unicode text.
HRESULT FormulaOleObject::CopyLatexToClipboard()
{
    WriteNativeOleLog(L"FormulaOleObject: CopyLaTeX to clipboard.");

    if (presentation_.latex.empty())
        return S_FALSE;

    if (!OpenClipboard(nullptr))
        return HResultFromWin32LastError();

    EmptyClipboard();

    // Allocate global memory for the Unicode string
    size_t byteCount = (presentation_.latex.size() + 1) * sizeof(wchar_t);
    HGLOBAL handle = GlobalAlloc(GMEM_MOVEABLE, byteCount);
    if (handle == nullptr)
    {
        CloseClipboard();
        return E_OUTOFMEMORY;
    }

    auto* buffer = static_cast<wchar_t*>(GlobalLock(handle));
    if (buffer == nullptr)
    {
        GlobalFree(handle);
        CloseClipboard();
        return E_OUTOFMEMORY;
    }

    wcscpy_s(buffer, presentation_.latex.size() + 1, presentation_.latex.c_str());
    GlobalUnlock(handle);

    SetClipboardData(CF_UNICODETEXT, handle);
    CloseClipboard();

    WriteNativeOleLog(L"FormulaOleObject: LaTeX copied to clipboard.");
    return S_OK;
}

HRESULT FormulaOleObject::StartEditSession()
{
    WriteNativeOleLog(L"FormulaOleObject: Starting edit session (async, background thread).");

    if (editThreadRunning_)
    {
        WriteNativeOleLog(L"FormulaOleObject: Edit session already in progress.");
        return S_OK;
    }

    HWND parentHwnd = nullptr;
    if (clientSite_ != nullptr)
    {
        IOleWindow* oleWindow = nullptr;
        if (SUCCEEDED(clientSite_->QueryInterface(IID_IOleWindow, reinterpret_cast<void**>(&oleWindow))))
        {
            oleWindow->GetWindow(&parentHwnd);
            oleWindow->Release();
        }
    }

    // Capture state before spawning the thread
    std::wstring capturedFormulaId = formulaId_;
    FormulaPresentation capturedPresentation = presentation_;
    editThreadRunning_ = true;
    editCompleted_ = false;

    // Explicit AddRef for the background thread; Release when done
    AddRef();

    std::thread([this, capturedFormulaId, capturedPresentation, parentHwnd]() {
        FormulaPresentation result = capturedPresentation;
        HRESULT hr = StartEditSessionPipe(capturedFormulaId, &result, parentHwnd);

        if (hr == S_OK)
        {
            // Store result for lazy pickup by ApplyPendingEditResult().
            // Do NOT call clientSite_->SaveObject() or NotifyPresentationChanged()
            // from this background thread — those are COM apartment-sensitive calls
            // that belong to Office's STA thread. Cross-apartment invocation risks
            // hangs or crashes in certain Office versions.
            pendingEditResult_ = result;
            editCompleted_ = true;

            WriteNativeOleLog(L"FormulaOleObject: Edit session completed successfully (async).");
        }
        else
        {
            WriteNativeOleLog(L"FormulaOleObject: Edit session cancelled or failed (async).");
        }

        editThreadRunning_ = false;

        Release();  // Balance the AddRef above
    }).detach();

    // Return immediately — Office UI is not blocked
    return S_OK;
}

void FormulaOleObject::ApplyPendingEditResult()
{
    if (!editCompleted_)
        return;

    WriteNativeOleLog(L"FormulaOleObject: Applying pending async edit result.");
    presentation_ = pendingEditResult_;
    dirty_ = true;

    if (!presentation_.payloadJson.empty())
    {
        canonicalPayloadJson_ = presentation_.payloadJson;
        std::wstring id;
#if HAS_NLOHMANN_JSON
        id = JsonReadString(canonicalPayloadJson_, L"formulaId");
#else
        id = ExtractJsonString(canonicalPayloadJson_, L"formulaId");
#endif
        if (!id.empty())
            formulaId_ = id;
    }

    editCompleted_ = false;
}

// ===================================================================
// FormulaClassFactory
// ===================================================================

STDMETHODIMP FormulaClassFactory::QueryInterface(REFIID iid, void** object)
{
    if (object == nullptr)
    {
        return E_POINTER;
    }

    if (iid == IID_IUnknown || iid == IID_IClassFactory)
    {
        *object = static_cast<IClassFactory*>(this);
        AddRef();
        return S_OK;
    }

    *object = nullptr;
    return E_NOINTERFACE;
}

STDMETHODIMP_(ULONG) FormulaClassFactory::AddRef()
{
    return static_cast<ULONG>(InterlockedIncrement(&refCount_));
}

STDMETHODIMP_(ULONG) FormulaClassFactory::Release()
{
    const ULONG remaining = static_cast<ULONG>(InterlockedDecrement(&refCount_));
    if (remaining == 0)
    {
        delete this;
    }

    return remaining;
}

STDMETHODIMP FormulaClassFactory::CreateInstance(IUnknown* outer, REFIID iid, void** object)
{
    WriteNativeOleLog(L"ClassFactory CreateInstance entered.");
    if (object == nullptr)
    {
        return E_POINTER;
    }

    *object = nullptr;
    if (outer != nullptr)
    {
        WriteNativeOleLog(L"ClassFactory rejected aggregation.");
        return CLASS_E_NOAGGREGATION;
    }

    FormulaOleObject* formulaObject = new (std::nothrow) FormulaOleObject();
    if (formulaObject == nullptr)
    {
        WriteNativeOleLog(L"FormulaOleObject allocation failed.");
        return E_OUTOFMEMORY;
    }

    HRESULT queryResult = formulaObject->QueryInterface(iid, object);
    WriteNativeOleLog(SUCCEEDED(queryResult) ? L"ClassFactory QueryInterface succeeded." : L"ClassFactory QueryInterface failed.");
    formulaObject->Release();
    return queryResult;
}

STDMETHODIMP FormulaClassFactory::LockServer(BOOL lock)
{
    if (lock)
    {
        InterlockedIncrement(&g_lockCount);
    }
    else
    {
        InterlockedDecrement(&g_lockCount);
    }

    return S_OK;
}

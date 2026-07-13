#include "FormulaOleObject.h"

#include "JsonHelper.h"
#include "NativeLog.h"
#include "OleEditSession.h"
#include "OleFormulaIds.h"
#include "PendingPayloadTransport.h"
#include "StorageUtil.h"
#include "Win32Check.h"

#include <atlconv.h>
#include <comdef.h>
#include <algorithm>
#include <cmath>
#include <new>
#include <thread>
#include <vector>
#include <string>
#include <sstream>

// Pending payload from registry — consumed during construction so the correct
// formula renders immediately without waiting for InitializeFromJson.
//
// A named mutex serializes one insertion lease per Office process. The
// registry value is keyed only by PID so a different COM/STA thread can
// construct and consume the object safely.
namespace
{
volatile LONG g_objectCount = 0;
volatile LONG g_serverLockCount = 0;
volatile LONG g_externalConnectionCount = 0;

bool TryDecrementIfPositive(volatile LONG* value, LONG* remaining = nullptr)
{
    LONG current = InterlockedCompareExchange(value, 0, 0);
    while (current > 0)
    {
        const LONG next = current - 1;
        const LONG observed = InterlockedCompareExchange(value, next, current);
        if (observed == current)
        {
            if (remaining != nullptr) *remaining = next;
            return true;
        }
        current = observed;
    }
    if (remaining != nullptr) *remaining = 0;
    return false;
}

LONG DecrementIfPositive(volatile LONG* value)
{
    LONG remaining = 0;
    TryDecrementIfPositive(value, &remaining);
    return remaining;
}

// P1-C: Helper to convert 0.01mm to pixels at given DPI
inline int Himetric01MmToPixels(LONG value01mm, int dpi)
{
    return (std::max)(1, static_cast<int>(std::round(value01mm * dpi / 2540.0)));
}

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

HGLOBAL CreateMetaFilePictFromEnhancedMetafile(const FormulaPresentation& presentation, SIZEL displayExtent)
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
    picture->xExt = displayExtent.cx;
    picture->yExt = displayExtent.cy;
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
    return InterlockedCompareExchange(&g_serverLockCount, 0, 0) +
        InterlockedCompareExchange(&g_externalConnectionCount, 0, 0);
}

FormulaOleObject::FormulaOleObject()
{
    const std::wstring pendingJson = ConsumePendingPayloadReference();

    if (!pendingJson.empty())
    {
        FormulaPresentation loaded = CreatePresentationFromPayload(pendingJson);

        const std::wstring pendingFormulaId = JsonReadString(pendingJson, L"formulaId");
        if (!pendingFormulaId.empty() && !loaded.latex.empty() && !loaded.enhancedMetafile.empty() &&
            loaded.himetricSize.cx > 0 && loaded.himetricSize.cy > 0 && HasValidEmf(loaded.enhancedMetafile))
        {
            presentation_ = std::move(loaded);
            canonicalPayloadJson_ = pendingJson;
            formulaId_ = pendingFormulaId;
            initializedFromRealPayload_ = true;
            dirty_ = true;
            WriteNativeOleLog(L"FormulaOleObject constructed with REAL payload.");
        }
        else
        {
            WriteNativeOleLog(L"FormulaOleObject: PendingPayload had no valid EMF — entering invalid state.");
        }
    }

    if (!initializedFromRealPayload_)
    {
        // P0: Do NOT create a placeholder formula. The object enters an invalid
        // state and waits for InitializeFromJson() to补救. If that never happens,
        // GetData/Draw will refuse to serve data, and VSTO will detect the failure.
        presentation_ = {};
        canonicalPayloadJson_.clear();
        formulaId_.clear();
        dirty_ = false;
        WriteNativeOleLog(L"FormulaOleObject constructed in INVALID state (no real payload).");
    }

    InterlockedIncrement(&g_objectCount);
}

FormulaOleObject::~FormulaOleObject()
{
    WriteNativeOleLog(L"FormulaOleObject destructed.");
    if (runningLocked_.exchange(false, std::memory_order_acq_rel))
        DecrementIfPositive(&g_serverLockCount);
    while (TryDecrementIfPositive(&externalConnectionCount_))
        DecrementIfPositive(&g_externalConnectionCount);
    InterlockedDecrement(&g_objectCount);
}

void FormulaOleObject::NotifyViewChanged()
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
}

void FormulaOleObject::NotifyPresentationChangedAndPersist()
{
    NotifyViewChanged();

    if (clientSite_ != nullptr)
    {
        clientSite_->SaveObject();
    }
}

// Backward compatibility alias.
void FormulaOleObject::NotifyPresentationChanged()
{
    NotifyPresentationChangedAndPersist();
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
    return E_NOTIMPL;
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
    return E_NOTIMPL;
}

STDMETHODIMP FormulaOleObject::GetClipboardData(DWORD, IDataObject** dataObject)
{
    if (dataObject == nullptr)
    {
        return E_POINTER;
    }

    return QueryInterface(IID_IDataObject, reinterpret_cast<void**>(dataObject));
}

namespace
{
bool IsExplicitUserActivationMessage(const MSG* msg)
{
    if (msg == nullptr)
        return false;

    if (msg->message == WM_LBUTTONDBLCLK)
        return true;

    if (msg->message == WM_KEYDOWN && (msg->wParam == VK_RETURN || msg->wParam == VK_SPACE))
        return true;

    return false;
}
}

STDMETHODIMP FormulaOleObject::DoVerb(LONG verb, LPMSG message, IOleClientSite*, LONG, HWND, LPCRECT)
{
    wchar_t logMessage[128]{};
    swprintf_s(logMessage, L"FormulaOleObject DoVerb verb=%ld insertionComplete=%d",
        verb, IsInsertionComplete() ? 1 : 0);
    WriteNativeOleLog(logMessage);

    // During insertion phase, all activation requests just display — never start editor.
    if (!IsInsertionComplete())
    {
        NotifyPresentationChanged();
        return S_OK;
    }

    // Office requests display/refresh (e.g. open doc, activate, re-render).
    if (verb == OLEIVERB_SHOW)
    {
        NotifyPresentationChanged();
        return S_OK;
    }

    if (verb == OLEIVERB_HIDE ||
        verb == OLEIVERB_DISCARDUNDOSTATE)
    {
        return S_OK;
    }

    if (verb == 2)
    {
        return CopyLatexToClipboard();
    }

    if (verb == 3)
    {
        NotifyPresentationChanged();
        return S_OK;
    }

    // For UIACTIVATE/INPLACEACTIVATE, only start editor if explicit user action.
    if (verb == OLEIVERB_UIACTIVATE || verb == OLEIVERB_INPLACEACTIVATE)
    {
        if (message != nullptr && IsExplicitUserActivationMessage(message))
            return StartEditSession();
        NotifyPresentationChanged();
        return S_OK;
    }

    if (verb == OLEIVERB_PRIMARY || verb == OLEIVERB_OPEN || verb == 0 || verb == 1)
    {
        return StartEditSession();
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
        return E_POINTER;

    HRESULT aspectResult = ValidateContentAspect(drawAspect);
    if (FAILED(aspectResult))
        return aspectResult;

    if (size->cx <= 0 || size->cy <= 0)
        return E_INVALIDARG;

    if (!IsInsertionComplete())
    {
        WriteNativeOleLog(L"FormulaOleObject SetExtent: provisional extent ignored.");
        return S_OK;
    }

    const bool changed = !hasContainerExtent_ ||
        containerExtent_.cx != size->cx ||
        containerExtent_.cy != size->cy;

    containerExtent_ = *size;
    hasContainerExtent_ = true;

    if (changed)
    {
        WriteNativeOleLog(L"FormulaOleObject SetExtent: committed extent and refreshed view.");
        NotifyViewChanged();
    }

    return S_OK;
}

STDMETHODIMP FormulaOleObject::GetExtent(DWORD drawAspect, SIZEL* size)
{
    if (size == nullptr)
        return E_POINTER;
    HRESULT aspectResult = ValidateContentAspect(drawAspect);
    if (FAILED(aspectResult))
        return aspectResult;
    const SIZEL extent = GetEffectiveExtent();
    if (extent.cx <= 0 || extent.cy <= 0)
        return OLE_E_BLANK;
    *size = extent;
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
        | OLEMISC_IGNOREACTIVATEWHENVISIBLE
        | OLEMISC_RECOMPOSEONRESIZE;
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

    // P0: Refuse to serve data if the object was never initialized with real payload.
    // This prevents displaying a placeholder formula as if it were user content.
    if (!initializedFromRealPayload_ || presentation_.enhancedMetafile.empty())
    {
        WriteNativeOleLog(L"FormulaOleObject GetData: rejecting — not initialized with real payload.");
        return DV_E_FORMATETC;
    }

    if (format == nullptr || medium == nullptr)
    {
        return E_POINTER;
    }

    // Zero output medium before any processing — prevents stale data in failure paths
    if (medium) ZeroMemory(medium, sizeof(*medium));

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
            WriteNativeOleLog(L"FormulaOleObject GetData: CF_ENHMETAFILE — no EMF data");
            return E_FAIL;
        }

        medium->tymed = TYMED_ENHMF;
        medium->hEnhMetaFile = metafile;
        medium->pUnkForRelease = nullptr;
        return S_OK;
    }

    HGLOBAL metafilePict = CreateMetaFilePictFromEnhancedMetafile(presentation_, GetEffectiveExtent());
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
    // P0: Refuse to report data availability if not initialized with real payload.
    if (!initializedFromRealPayload_ || presentation_.enhancedMetafile.empty())
    {
        return DV_E_FORMATETC;
    }

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
        if ((format->tymed & TYMED_ENHMF) == 0) return DV_E_TYMED;
        if (presentation_.enhancedMetafile.empty()) return DV_E_FORMATETC;
        return ValidateContentAspect(format->dwAspect);
    }

    if (format->cfFormat == CF_METAFILEPICT)
    {
        if ((format->tymed & TYMED_MFPICT) == 0) return DV_E_TYMED;
        if (presentation_.enhancedMetafile.empty()) return DV_E_FORMATETC;
        return ValidateContentAspect(format->dwAspect);
    }

    // CF_DIB and CF_BITMAP are not advertised in EnumFormatEtc per P1-4.
    // Return format-not-supported so Office does not attempt to call GetData.
    if (format->dwAspect == DVASPECT_ICON)
    {
        return DV_E_FORMATETC;
    }

    WriteNativeOleLog(L"FormulaOleObject QueryGetData: unsupported format");
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

    UNREFERENCED_PARAMETER(release);
    return E_NOTIMPL;
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
    //
    // CF_DIB and CF_BITMAP are intentionally NOT included here.
    // They were attempted but caused crashes in mso20win32client.dll
    // when Word/PPT requested them and our GDI conversion ran in
    // the Office process context. EMF is the supported format.
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

    // P0: Refuse to draw if the object was never initialized with real payload.
    if (!initializedFromRealPayload_ || presentation_.enhancedMetafile.empty())
    {
        WriteNativeOleLog(L"FormulaOleObject Draw: rejecting — not initialized with real payload.");
        return DV_E_FORMATETC;
    }

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
        WriteNativeOleLog(L"FormulaOleObject Draw: no EMF data — returning S_FALSE");
        return S_FALSE; // Not an error; Office will not render anything
    }

    RECT rect{bounds->left, bounds->top, bounds->right, bounds->bottom};

    // Safety clip: prevent EMF content from overflowing into adjacent objects
    const int savedDc = SaveDC(drawContext);
    if (savedDc == 0)
    {
        DeleteEnhMetaFile(metafile);
        return E_FAIL;
    }

    const int clipResult = IntersectClipRect(drawContext, rect.left, rect.top, rect.right, rect.bottom);
    BOOL played = FALSE;
    if (clipResult != ERROR)
    {
        played = PlayEnhMetaFile(drawContext, metafile, &rect);
    }
    RestoreDC(drawContext, savedDc);
    DeleteEnhMetaFile(metafile);
    return played ? S_OK : S_FALSE;
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
        return E_POINTER;
    HRESULT aspectResult = ValidateContentAspect(drawAspect);
    if (FAILED(aspectResult))
        return aspectResult;
    const SIZEL extent = GetEffectiveExtent();
    if (extent.cx <= 0 || extent.cy <= 0)
        return OLE_E_BLANK;
    *size = extent;
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
    const bool previous = runningLocked_.exchange(lock != FALSE, std::memory_order_acq_rel);
    if (lock && !previous)
    {
        InterlockedIncrement(&g_serverLockCount);
    }
    else if (!lock && previous)
    {
        DecrementIfPositive(&g_serverLockCount);
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
    return OLE_E_NOCONNECTION;
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
    return E_NOTIMPL;
}

STDMETHODIMP_(DWORD) FormulaOleObject::AddConnection(DWORD, DWORD)
{
    WriteNativeOleLog(L"FormulaOleObject AddConnection.");
    const LONG local = InterlockedIncrement(&externalConnectionCount_);
    InterlockedIncrement(&g_externalConnectionCount);
    return static_cast<DWORD>(local);
}

STDMETHODIMP_(DWORD) FormulaOleObject::ReleaseConnection(DWORD, DWORD, BOOL)
{
    WriteNativeOleLog(L"FormulaOleObject ReleaseConnection.");
    LONG remaining = 0;
    if (TryDecrementIfPositive(&externalConnectionCount_, &remaining))
        DecrementIfPositive(&g_externalConnectionCount);
    return static_cast<DWORD>(remaining);
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
    // P0-3: Check for pending async edit result so Office sees updated state
    ApplyPendingEditResult();
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

    // The constructor may already have consumed the pending payload.
    // Persist it immediately because PowerPoint may release this COM
    // instance and reactivate the object through OLEFormat.Object.
    if (initializedFromRealPayload_)
    {
        result = SavePresentationToStorage(storage, presentation_);
        if (FAILED(result))
        {
            WriteNativeOleLog(L"InitNew: initial presentation save failed.");
            storage_.Release();
            return result;
        }

        const std::wstring envelope = !canonicalPayloadJson_.empty()
            ? canonicalPayloadJson_ : presentation_.payloadJson;
        if (envelope.empty())
        {
            WriteNativeOleLog(L"InitNew: canonical payload is empty.");
            storage_.Release();
            return STG_E_INVALIDHEADER;
        }

        result = SaveEnvelopeToStorage(storage, envelope);
        if (FAILED(result))
        {
            WriteNativeOleLog(L"InitNew: initial envelope save failed.");
            storage_.Release();
            return result;
        }

        result = storage->Commit(STGC_DEFAULT);
        if (FAILED(result))
        {
            WriteNativeOleLog(L"InitNew: initial storage commit failed.");
            storage_.Release();
            return result;
        }

        WriteNativeOleLog(L"InitNew: real payload persisted immediately.");
    }

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
        formulaId_ = JsonReadString(presentation_.payloadJson, L"formulaId");
        initializedFromRealPayload_ = true;
        dirty_ = false;
        containerExtent_ = {};
        hasContainerExtent_ = false;
        insertionComplete_.store(true, std::memory_order_release);
        return S_OK;
    }

    // If storage streams are missing but we have a real payload from the
    // constructor, persist it now. This handles hosts that release and
    // reactivate the COM instance before InitNew finishes.
    if (result == STG_E_FILENOTFOUND && initializedFromRealPayload_)
    {
        WriteNativeOleLog(L"Load: storage streams missing; persisting constructor payload.");
        storage_ = storage;

        HRESULT saveResult = SavePresentationToStorage(storage, presentation_);
        if (SUCCEEDED(saveResult))
        {
            const std::wstring envelope = !canonicalPayloadJson_.empty()
                ? canonicalPayloadJson_ : presentation_.payloadJson;
            if (envelope.empty())
            {
                saveResult = STG_E_INVALIDHEADER;
            }
            else
            {
                saveResult = SaveEnvelopeToStorage(storage, envelope);
            }
        }

        if (SUCCEEDED(saveResult))
        {
            saveResult = storage->Commit(STGC_DEFAULT);
        }

        if (SUCCEEDED(saveResult))
        {
            dirty_ = true;
            return S_OK;
        }
    }

    return result;
}

STDMETHODIMP FormulaOleObject::Save(IStorage* storage, BOOL)
{
    // Apply any pending async edit result before persisting
    ApplyPendingEditResult();

    // Transactional save: backup existing data first, then restore if envelope fails.
    // This prevents payload/preview inconsistency when envelope write fails.
    std::vector<BYTE> backupPayload, backupEmf, backupEnvelope;
    {
        HRESULT hr = StorageUtilBackup(storage, &backupPayload, &backupEmf, &backupEnvelope);
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
            StorageUtilRestore(storage, backupPayload, backupEmf, backupEnvelope);
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
            StorageUtilRestore(storage, backupPayload, backupEmf, backupEnvelope);
        }
    }

    return result;
}

STDMETHODIMP FormulaOleObject::SaveCompleted(IStorage* storage)
{
    if (storage != nullptr)
    {
        storage_ = storage;
    }

    if (storage_ == nullptr)
    {
        return S_OK;
    }

    const HRESULT result = storage_->Commit(STGC_DEFAULT);
    if (FAILED(result))
    {
        WriteNativeOleLog(L"SaveCompleted: storage commit failed.");
    }

    return result;
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

    // Validate required fields — use nlohmann-based JsonReadString (handles LaTeX {} and \ escapes)
    std::wstring formulaId = JsonReadString(wsJson, L"formulaId");
    if (formulaId.empty())
    {
        WriteNativeOleLog(L"FormulaOleObject: InitializeFromJson rejected — missing formulaId");
        return E_INVALIDARG;
    }

    double schemaVersion = JsonReadNumber(wsJson, L"schemaVersion");
    if (schemaVersion < 1.0 || schemaVersion > 5.0)
    {
        WriteNativeOleLog(L"FormulaOleObject: InitializeFromJson rejected — incompatible schemaVersion");
        return E_INVALIDARG;
    }

    std::wstring latex = JsonReadString(wsJson, L"latex");
    if (latex.empty())
    {
        WriteNativeOleLog(L"FormulaOleObject: InitializeFromJson rejected — empty latex");
        return E_INVALIDARG;
    }

    std::wstring storageMode = JsonReadString(wsJson, L"storageMode");
    if (storageMode.empty())
    {
        // Default to "ole" for OLE objects
        storageMode = L"ole";
    }

    FormulaPresentation loaded = CreatePresentationFromPayload(wsJson);
    if (loaded.latex.empty())
        return E_FAIL;

    // P0-D: Hard reject when no EMF preview data — an OLE object without valid
    // preview will cause Office to request rendering and crash when it fails.
    // The VSTO side receives E_INVALIDARG and rolls back the OLE object.
    if (loaded.enhancedMetafile.empty())
    {
        const std::wstring detail = L"FormulaOleObject: InitializeFromJson rejected: " + loaded.diagnostic;
        WriteNativeOleLog(detail.c_str());
        return E_INVALIDARG;
    }

    const bool preserveScale = IsInsertionComplete();
    AdoptPresentation(std::move(loaded), preserveScale);

    canonicalPayloadJson_ = wsJson;
    formulaId_ = formulaId;
    initializedFromRealPayload_ = true;
    dirty_ = true;

    RequestLayoutAndNotify();
    WriteNativeOleLog(L"FormulaOleObject initialized from JSON payload.");
    return S_OK;
}

STDMETHODIMP FormulaOleObject::GetPayloadJson(BSTR* payloadJson)
{
    if (payloadJson == nullptr)
        return E_POINTER;

    // P0-3: Apply pending async edit result so caller gets the latest data
    ApplyPendingEditResult();

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

    // P0-4: Delegate entirely to InitializeFromJson which performs all validation
    // before committing to canonicalPayloadJson_ / presentation_ / formulaId_.
    // Do NOT write canonicalPayloadJson_ here — if InitializeFromJson fails
    // (e.g. invalid schema, empty LaTeX, missing EMF), the old state must remain intact.
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

STDMETHODIMP FormulaOleObject::IsInitialized(VARIANT_BOOL* result)
{
    if (result == nullptr)
        return E_POINTER;

    *result = initializedFromRealPayload_ ? VARIANT_TRUE : VARIANT_FALSE;
    return S_OK;
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
        { L"IsInitialized",      6 },
        { L"GetExtentJson",      7 },
        { L"CompleteInsertion",  8 },
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
    (void)pExcepInfo;
    (void)puArgErr;
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

    case 6: // IsInitialized
        if (pVarResult != nullptr && (wFlags & DISPATCH_METHOD))
        {
            VARIANT_BOOL result = VARIANT_FALSE;
            HRESULT hr = IsInitialized(&result);
            if (SUCCEEDED(hr))
            {
                VariantClear(pVarResult);
                pVarResult->vt = VT_BOOL;
                pVarResult->boolVal = result;
            }
            return hr;
        }
        return DISP_E_MEMBERNOTFOUND;

    case 7: // GetExtentJson
        if (pVarResult != nullptr && (wFlags & DISPATCH_METHOD))
        {
            BSTR result = nullptr;
            HRESULT hr = GetExtentJson(&result);
            if (SUCCEEDED(hr))
            {
                VariantClear(pVarResult);
                pVarResult->vt = VT_BSTR;
                pVarResult->bstrVal = result;
            }
            return hr;
        }
        return DISP_E_MEMBERNOTFOUND;

    case 8: // CompleteInsertion
        if (wFlags & DISPATCH_METHOD)
            return CompleteInsertion();
        return DISP_E_MEMBERNOTFOUND;

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

    // atomic check-and-set: only one edit session at a time
    bool expected = false;
    if (!editThreadRunning_.compare_exchange_strong(expected, true))
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
    editCompleted_.store(false);

    // Explicit AddRef for the background thread; Release when done
    AddRef();

    std::thread([this, capturedFormulaId, capturedPresentation, parentHwnd]() {
        FormulaPresentation result = capturedPresentation;
        HRESULT hr = StartEditSessionPipe(capturedFormulaId, &result, parentHwnd);

        if (hr == S_OK)
        {
            // Store result for lazy pickup by ApplyPendingEditResult().
            // Use a mutex to safely transfer the FormulaPresentation (contains strings/vectors).
            {
                std::lock_guard<std::mutex> lock(editResultMutex_);
                pendingEditResult_ = std::move(result);
            }
            editCompleted_.store(true);

            WriteNativeOleLog(L"FormulaOleObject: Edit session completed successfully (async).");
        }
        else
        {
            WriteNativeOleLog(L"FormulaOleObject: Edit session cancelled or failed (async).");
        }

        editThreadRunning_.store(false);

        Release();  // Balance the AddRef above
    }).detach();

    // Return immediately — Office UI is not blocked
    return S_OK;
}

void FormulaOleObject::ApplyPendingEditResult()
{
    if (!editCompleted_.load())
        return;

    // Atomically consume the flag and take the result under lock
    editCompleted_.store(false);

    FormulaPresentation candidate;
    {
        std::lock_guard<std::mutex> lock(editResultMutex_);
        candidate = std::move(pendingEditResult_);
    }

    // P1: Validate the result before committing.
    // If the desktop editor returned an incomplete/invalid result, reject it
    // and keep the current presentation intact.
    if (candidate.latex.empty() ||
        candidate.enhancedMetafile.empty() ||
        !HasValidEmf(candidate.enhancedMetafile) ||
        candidate.himetricSize.cx <= 0 || candidate.himetricSize.cy <= 0)
    {
        WriteNativeOleLog(L"FormulaOleObject: ApplyPendingEditResult rejected -- result has no valid EMF.");
        return;
    }

    WriteNativeOleLog(L"FormulaOleObject: Applying pending async edit result.");
    AdoptPresentation(std::move(candidate), true);
    initializedFromRealPayload_ = true;
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

    RequestLayoutAndNotify();
}

SIZEL FormulaOleObject::GetEffectiveExtent() const noexcept
{
    if (!IsInsertionComplete())
        return presentation_.himetricSize;

    if (hasContainerExtent_ && containerExtent_.cx > 0 && containerExtent_.cy > 0)
        return containerExtent_;

    return presentation_.himetricSize;
}

void FormulaOleObject::AdoptPresentation(FormulaPresentation&& next, bool preserveDisplayScale)
{
    const SIZEL oldNatural = presentation_.himetricSize;
    const SIZEL oldDisplay = GetEffectiveExtent();

    bool canPreserveScale = preserveDisplayScale && IsInsertionComplete() &&
        oldNatural.cx > 0 && oldNatural.cy > 0 && oldDisplay.cx > 0 && oldDisplay.cy > 0 &&
        next.himetricSize.cx > 0 && next.himetricSize.cy > 0;

    presentation_ = std::move(next);

    if (!canPreserveScale)
    {
        containerExtent_ = {};
        hasContainerExtent_ = false;
        return;
    }

    const double scaleX = static_cast<double>(oldDisplay.cx) / static_cast<double>(oldNatural.cx);
    const double scaleY = static_cast<double>(oldDisplay.cy) / static_cast<double>(oldNatural.cy);
    const double scale = std::clamp((std::min)(scaleX, scaleY), 0.05, 20.0);

    containerExtent_.cx = (std::max)(static_cast<LONG>(1), static_cast<LONG>(std::lround(presentation_.himetricSize.cx * scale)));
    containerExtent_.cy = (std::max)(static_cast<LONG>(1), static_cast<LONG>(std::lround(presentation_.himetricSize.cy * scale)));
    hasContainerExtent_ = true;
}

void FormulaOleObject::RequestLayoutAndNotify()
{
    NotifyPresentationChanged();
    if (clientSite_ != nullptr)
    {
        const HRESULT hr = clientSite_->RequestNewObjectLayout();
        if (FAILED(hr))
        {
            wchar_t message[128]{};
            swprintf_s(message, L"RequestNewObjectLayout failed: 0x%08X", static_cast<unsigned int>(hr));
            WriteNativeOleLog(message);
        }
    }
}

STDMETHODIMP FormulaOleObject::GetExtentJson(BSTR* extentJson)
{
    if (extentJson == nullptr)
        return E_POINTER;
    *extentJson = nullptr;
    if (!initializedFromRealPayload_ || presentation_.himetricSize.cx <= 0 || presentation_.himetricSize.cy <= 0)
        return OLE_E_BLANK;
    const SIZEL display = GetEffectiveExtent();
    wchar_t json[256]{};
    const int written = swprintf_s(json,
        L"{\"naturalCxHimetric\":%ld,\"naturalCyHimetric\":%ld,\"displayCxHimetric\":%ld,\"displayCyHimetric\":%ld}",
        presentation_.himetricSize.cx, presentation_.himetricSize.cy, display.cx, display.cy);
    if (written <= 0)
        return E_FAIL;
    *extentJson = SysAllocString(json);
    return *extentJson != nullptr ? S_OK : E_OUTOFMEMORY;
}

STDMETHODIMP FormulaOleObject::CompleteInsertion()
{
    if (!initializedFromRealPayload_ || presentation_.himetricSize.cx <= 0 || presentation_.himetricSize.cy <= 0)
        return OLE_E_BLANK;

    const bool wasAlreadyComplete = insertionComplete_.exchange(true, std::memory_order_acq_rel);
    if (wasAlreadyComplete)
    {
        WriteNativeOleLog(L"FormulaOleObject: CompleteInsertion ignored because insertion was already completed.");
        return S_OK;
    }

    containerExtent_ = presentation_.himetricSize;
    hasContainerExtent_ = true;
    WriteNativeOleLog(L"FormulaOleObject: insertion completed.");
    // View refresh happens in SetExtent when the host sets the final display size.
    return S_OK;
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
        InterlockedIncrement(&g_serverLockCount);
    }
    else
    {
        DecrementIfPositive(&g_serverLockCount);
    }

    return S_OK;
}

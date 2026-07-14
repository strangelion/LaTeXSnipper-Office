#pragma once

#include "Presentation.h"
#include "LaTeXSnipperFormula.h"  // MIDL-generated from LaTeXSnipperFormula.idl

#include <atlbase.h>
#include <atomic>
#include <mutex>
#include <oleidl.h>
#include <string>

class FormulaOleObject final
    : public IOleObject
    , public IDataObject
    , public IViewObject2
    , public IRunnableObject
    , public IOleCache
    , public IExternalConnection
    , public IPersistStorage
    , public ILatexSnipperFormula
{
public:
    FormulaOleObject();
    ~FormulaOleObject();

    // IUnknown
    STDMETHOD(QueryInterface)(REFIID iid, void** object) override;
    STDMETHOD_(ULONG, AddRef)() override;
    STDMETHOD_(ULONG, Release)() override;

    // IOleObject
    STDMETHOD(SetClientSite)(IOleClientSite* clientSite) override;
    STDMETHOD(GetClientSite)(IOleClientSite** clientSite) override;
    STDMETHOD(SetHostNames)(LPCOLESTR containerApp, LPCOLESTR containerObject) override;
    STDMETHOD(Close)(DWORD saveOption) override;
    STDMETHOD(SetMoniker)(DWORD whichMoniker, IMoniker* moniker) override;
    STDMETHOD(GetMoniker)(DWORD assign, DWORD whichMoniker, IMoniker** moniker) override;
    STDMETHOD(InitFromData)(IDataObject* dataObject, BOOL creation, DWORD reserved) override;
    STDMETHOD(GetClipboardData)(DWORD reserved, IDataObject** dataObject) override;
    STDMETHOD(DoVerb)(LONG verb, LPMSG message, IOleClientSite* activeSite, LONG index, HWND parentWindow, LPCRECT positionRect) override;
    STDMETHOD(EnumVerbs)(IEnumOLEVERB** enumOleVerb) override;
    STDMETHOD(Update)() override;
    STDMETHOD(IsUpToDate)() override;
    STDMETHOD(GetUserClassID)(CLSID* classId) override;
    STDMETHOD(GetUserType)(DWORD formOfType, LPOLESTR* userType) override;
    STDMETHOD(SetExtent)(DWORD drawAspect, SIZEL* size) override;
    STDMETHOD(GetExtent)(DWORD drawAspect, SIZEL* size) override;
    STDMETHOD(Advise)(IAdviseSink* adviseSink, DWORD* connection) override;
    STDMETHOD(Unadvise)(DWORD connection) override;
    STDMETHOD(EnumAdvise)(IEnumSTATDATA** enumAdvise) override;
    STDMETHOD(GetMiscStatus)(DWORD aspect, DWORD* status) override;
    STDMETHOD(SetColorScheme)(LOGPALETTE* logPalette) override;

    // IDataObject
    STDMETHOD(GetData)(FORMATETC* format, STGMEDIUM* medium) override;
    STDMETHOD(GetDataHere)(FORMATETC* format, STGMEDIUM* medium) override;
    STDMETHOD(QueryGetData)(FORMATETC* format) override;
    STDMETHOD(GetCanonicalFormatEtc)(FORMATETC* input, FORMATETC* output) override;
    STDMETHOD(SetData)(FORMATETC* format, STGMEDIUM* medium, BOOL release) override;
    STDMETHOD(EnumFormatEtc)(DWORD direction, IEnumFORMATETC** enumFormatEtc) override;
    STDMETHOD(DAdvise)(FORMATETC* format, DWORD advf, IAdviseSink* adviseSink, DWORD* connection) override;
    STDMETHOD(DUnadvise)(DWORD connection) override;
    STDMETHOD(EnumDAdvise)(IEnumSTATDATA** enumAdvise) override;

    // IViewObject2
    STDMETHOD(Draw)(DWORD drawAspect, LONG index, void* aspect, DVTARGETDEVICE* targetDevice, HDC targetDeviceContext, HDC drawContext, LPCRECTL bounds, LPCRECTL windowBounds, BOOL(__stdcall* continueCallback)(ULONG_PTR), ULONG_PTR continueContext) override;
    STDMETHOD(GetColorSet)(DWORD drawAspect, LONG index, void* aspect, DVTARGETDEVICE* targetDevice, HDC targetDeviceContext, LOGPALETTE** colorSet) override;
    STDMETHOD(Freeze)(DWORD drawAspect, LONG index, void* aspect, DWORD* freeze) override;
    STDMETHOD(Unfreeze)(DWORD freeze) override;
    STDMETHOD(SetAdvise)(DWORD aspects, DWORD advf, IAdviseSink* adviseSink) override;
    STDMETHOD(GetAdvise)(DWORD* aspects, DWORD* advf, IAdviseSink** adviseSink) override;
    STDMETHOD(GetExtent)(DWORD drawAspect, LONG index, DVTARGETDEVICE* targetDevice, SIZEL* size) override;

    // IRunnableObject
    STDMETHOD(GetRunningClass)(LPCLSID classId) override;
    STDMETHOD(Run)(LPBINDCTX bindContext) override;
    STDMETHOD_(BOOL, IsRunning)() override;
    STDMETHOD(LockRunning)(BOOL lock, BOOL lastUnlockCloses) override;
    STDMETHOD(SetContainedObject)(BOOL contained) override;

    // IOleCache
    STDMETHOD(Cache)(FORMATETC* format, DWORD adviseFlags, DWORD* connection) override;
    STDMETHOD(Uncache)(DWORD connection) override;
    STDMETHOD(EnumCache)(IEnumSTATDATA** enumStatData) override;
    STDMETHOD(InitCache)(IDataObject* dataObject) override;

    // IExternalConnection
    STDMETHOD_(DWORD, AddConnection)(DWORD extension, DWORD reserved) override;
    STDMETHOD_(DWORD, ReleaseConnection)(DWORD extension, DWORD reserved, BOOL lastReleaseCloses) override;

    // IPersistStorage
    STDMETHOD(GetClassID)(CLSID* classId) override;
    STDMETHOD(IsDirty)() override;
    STDMETHOD(InitNew)(IStorage* storage) override;
    STDMETHOD(Load)(IStorage* storage) override;
    STDMETHOD(Save)(IStorage* storage, BOOL sameAsLoad) override;
    STDMETHOD(SaveCompleted)(IStorage* storage) override;
    STDMETHOD(HandsOffStorage)() override;

    // ILatexSnipperFormula
    STDMETHOD(InitializeFromJson)(BSTR payloadJson) override;
    STDMETHOD(GetPayloadJson)(BSTR* payloadJson) override;
    STDMETHOD(ReplacePayloadJson)(BSTR payloadJson) override;
    STDMETHOD(GetFormulaId)(BSTR* formulaId) override;
    STDMETHOD(OpenEditor)() override;
    STDMETHOD(IsInitialized)(VARIANT_BOOL* result) override;
    STDMETHOD(GetExtentJson)(BSTR* extentJson) override;
    STDMETHOD(CompleteInsertion)() override;
    STDMETHOD(SetDisplayExtentHimetric)(LONG cx, LONG cy) override;

    // IDispatch
    STDMETHOD(GetTypeInfoCount)(UINT* pctinfo) override;
    STDMETHOD(GetTypeInfo)(UINT iTInfo, LCID lcid, ITypeInfo** ppTInfo) override;
    STDMETHOD(GetIDsOfNames)(REFIID riid, LPOLESTR* rgszNames, UINT cNames, LCID lcid, DISPID* rgDispId) override;
    STDMETHOD(Invoke)(DISPID dispIdMember, REFIID riid, LCID lcid, WORD wFlags, DISPPARAMS* pDispParams, VARIANT* pVarResult, EXCEPINFO* pExcepInfo, UINT* puArgErr) override;

private:
    void NotifyViewChanged();
    void NotifyPresentationChangedAndPersist();
    void NotifyPresentationChanged();
    HRESULT StartEditSession();
    HRESULT CopyLatexToClipboard();
    void ApplyPendingEditResult();

    SIZEL GetEffectiveExtent() const noexcept;
    void AdoptPresentation(FormulaPresentation&& presentation, bool preserveDisplayScale);
    void RequestLayoutAndNotify();
    bool IsInsertionComplete() const noexcept
    {
        return insertionComplete_.load(std::memory_order_acquire);
    }

    volatile LONG refCount_ = 1;
    ATL::CComPtr<IOleClientSite> clientSite_;
    ATL::CComPtr<IStorage> storage_;
    ATL::CComPtr<IAdviseSink> objectAdviseSink_;
    ATL::CComPtr<IAdviseSink> viewAdviseSink_;
    ATL::CComPtr<IAdviseSink> dataAdviseSink_;
    DWORD viewAdviseAspects_ = 0;
    DWORD viewAdviseFlags_ = 0;
    FORMATETC dataAdviseFormat_{};
    DWORD dataAdviseFlags_ = 0;
    DWORD cacheConnection_ = 1;
    FormulaPresentation presentation_;
    // The EMF's intrinsic extent remains in presentation_.himetricSize.
    // Office container resizing is stored separately so it cannot corrupt
    // CF_METAFILEPICT dimensions or the cached presentation.
    SIZEL containerExtent_{};
    bool hasContainerExtent_ = false;
    // Office 在创建阶段可能写入临时默认尺寸。
    // 在宿主明确调用 CompleteInsertion 前，不能信任这些 SetExtent。
    std::atomic<bool> insertionComplete_{false};
    std::wstring canonicalPayloadJson_;
    bool dirty_ = false;
    bool initializedFromRealPayload_ = false;
    std::wstring formulaId_;

    // Async edit session: DoVerb spawns a thread so Office UI is not blocked.
    // Uses atomics for thread-safe flag access and a mutex to protect
    // pendingEditResult_ which contains non-trivially-copyable types.
    std::atomic<bool> editThreadRunning_{false};
    std::atomic<bool> runningLocked_{false};
    volatile LONG externalConnectionCount_ = 0;
    std::atomic<bool> editCompleted_{false};
    std::mutex editResultMutex_;
    FormulaPresentation pendingEditResult_;
};

class FormulaClassFactory final : public IClassFactory
{
public:
    STDMETHOD(QueryInterface)(REFIID iid, void** object) override;
    STDMETHOD_(ULONG, AddRef)() override;
    STDMETHOD_(ULONG, Release)() override;
    STDMETHOD(CreateInstance)(IUnknown* outer, REFIID iid, void** object) override;
    STDMETHOD(LockServer)(BOOL lock) override;

private:
    volatile LONG refCount_ = 1;
};

// MIDL-generated surrogate for LaTeXSnipperFormula.idl
// Provides ILatexSnipperFormula interface declaration without requiring
// the MIDL compiler step. Replace with the actual generated .h when
// midl.exe is part of the build pipeline.

#pragma once

#include <oaidl.h>

// {3A8E5C4B-D1F2-4E6F-8A7B-9C0D1E2F3A4B}
// Define IID inline; when MIDL generates the real header, the extern
// definition will come from the MIDL-generated .c file instead.
const IID IID_ILatexSnipperFormula = {
    0x3a8e5c4b,
    0xd1f2,
    0x4e6f,
    {0x8a, 0x7b, 0x9c, 0x0d, 0x1e, 0x2f, 0x3a, 0x4b}};

#ifdef __cplusplus

class ILatexSnipperFormula : public IDispatch
{
public:
    virtual HRESULT STDMETHODCALLTYPE InitializeFromJson(BSTR payloadJson) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetPayloadJson(BSTR* payloadJson) = 0;
    virtual HRESULT STDMETHODCALLTYPE ReplacePayloadJson(BSTR payloadJson) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetFormulaId(BSTR* formulaId) = 0;
    virtual HRESULT STDMETHODCALLTYPE OpenEditor() = 0;
    virtual HRESULT STDMETHODCALLTYPE IsInitialized(VARIANT_BOOL* result) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetExtentJson(BSTR* extentJson) = 0;
    virtual HRESULT STDMETHODCALLTYPE CompleteInsertion() = 0;
};

#endif

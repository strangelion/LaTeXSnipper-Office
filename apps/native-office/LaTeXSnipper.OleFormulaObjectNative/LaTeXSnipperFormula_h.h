

/* this ALWAYS GENERATED file contains the definitions for the interfaces */


 /* File created by MIDL compiler version 8.01.0628 */
/* at Tue Jan 19 11:14:07 2038
 */
/* Compiler settings for src\LaTeXSnipperFormula.idl:
    Oicf, W1, Zp8, env=Win32 (32b run), target_arch=X86 8.01.0628 
    protocol : dce , ms_ext, c_ext, robust
    error checks: allocation ref bounds_check enum stub_data 
    VC __declspec() decoration level: 
         __declspec(uuid()), __declspec(selectany), __declspec(novtable)
         DECLSPEC_UUID(), MIDL_INTERFACE()
*/
/* @@MIDL_FILE_HEADING(  ) */



/* verify that the <rpcndr.h> version is high enough to compile this file*/
#ifndef __REQUIRED_RPCNDR_H_VERSION__
#define __REQUIRED_RPCNDR_H_VERSION__ 500
#endif

#include "rpc.h"
#include "rpcndr.h"

#ifndef __RPCNDR_H_VERSION__
#error this stub requires an updated version of <rpcndr.h>
#endif /* __RPCNDR_H_VERSION__ */

#ifndef COM_NO_WINDOWS_H
#include "windows.h"
#include "ole2.h"
#endif /*COM_NO_WINDOWS_H*/

#ifndef __LaTeXSnipperFormula_h_h__
#define __LaTeXSnipperFormula_h_h__

#if defined(_MSC_VER) && (_MSC_VER >= 1020)
#pragma once
#endif

#ifndef DECLSPEC_XFGVIRT
#if defined(_CONTROL_FLOW_GUARD_XFG)
#define DECLSPEC_XFGVIRT(base, func) __declspec(xfg_virtual(base, func))
#else
#define DECLSPEC_XFGVIRT(base, func)
#endif
#endif

/* Forward Declarations */ 

#ifndef __ILatexSnipperFormula_FWD_DEFINED__
#define __ILatexSnipperFormula_FWD_DEFINED__
typedef interface ILatexSnipperFormula ILatexSnipperFormula;

#endif 	/* __ILatexSnipperFormula_FWD_DEFINED__ */


#ifndef __LaTeXSnipperFormula_FWD_DEFINED__
#define __LaTeXSnipperFormula_FWD_DEFINED__

#ifdef __cplusplus
typedef class LaTeXSnipperFormula LaTeXSnipperFormula;
#else
typedef struct LaTeXSnipperFormula LaTeXSnipperFormula;
#endif /* __cplusplus */

#endif 	/* __LaTeXSnipperFormula_FWD_DEFINED__ */


/* header files for imported files */
#include "oaidl.h"
#include "ocidl.h"

#ifdef __cplusplus
extern "C"{
#endif 


#ifndef __ILatexSnipperFormula_INTERFACE_DEFINED__
#define __ILatexSnipperFormula_INTERFACE_DEFINED__

/* interface ILatexSnipperFormula */
/* [unique][uuid][nonextensible][dual][object] */ 


EXTERN_C const IID IID_ILatexSnipperFormula;

#if defined(__cplusplus) && !defined(CINTERFACE)
    
    MIDL_INTERFACE("3A8E5C4B-D1F2-4E6F-8A7B-9C0D1E2F3A4B")
    ILatexSnipperFormula : public IDispatch
    {
    public:
        virtual /* [id] */ HRESULT STDMETHODCALLTYPE InitializeFromJson( 
            /* [in] */ BSTR payloadJson) = 0;
        
        virtual /* [id] */ HRESULT STDMETHODCALLTYPE GetPayloadJson( 
            /* [retval][out] */ BSTR *payloadJson) = 0;
        
        virtual /* [id] */ HRESULT STDMETHODCALLTYPE ReplacePayloadJson( 
            /* [in] */ BSTR payloadJson) = 0;
        
        virtual /* [id] */ HRESULT STDMETHODCALLTYPE GetFormulaId( 
            /* [retval][out] */ BSTR *formulaId) = 0;
        
        virtual /* [id] */ HRESULT STDMETHODCALLTYPE OpenEditor( void) = 0;
        
    };
    
    
#else 	/* C style interface */

    typedef struct ILatexSnipperFormulaVtbl
    {
        BEGIN_INTERFACE
        
        DECLSPEC_XFGVIRT(IUnknown, QueryInterface)
        HRESULT ( STDMETHODCALLTYPE *QueryInterface )( 
            ILatexSnipperFormula * This,
            /* [in] */ REFIID riid,
            /* [annotation][iid_is][out] */ 
            _COM_Outptr_  void **ppvObject);
        
        DECLSPEC_XFGVIRT(IUnknown, AddRef)
        ULONG ( STDMETHODCALLTYPE *AddRef )( 
            ILatexSnipperFormula * This);
        
        DECLSPEC_XFGVIRT(IUnknown, Release)
        ULONG ( STDMETHODCALLTYPE *Release )( 
            ILatexSnipperFormula * This);
        
        DECLSPEC_XFGVIRT(IDispatch, GetTypeInfoCount)
        HRESULT ( STDMETHODCALLTYPE *GetTypeInfoCount )( 
            ILatexSnipperFormula * This,
            /* [out] */ UINT *pctinfo);
        
        DECLSPEC_XFGVIRT(IDispatch, GetTypeInfo)
        HRESULT ( STDMETHODCALLTYPE *GetTypeInfo )( 
            ILatexSnipperFormula * This,
            /* [in] */ UINT iTInfo,
            /* [in] */ LCID lcid,
            /* [out] */ ITypeInfo **ppTInfo);
        
        DECLSPEC_XFGVIRT(IDispatch, GetIDsOfNames)
        HRESULT ( STDMETHODCALLTYPE *GetIDsOfNames )( 
            ILatexSnipperFormula * This,
            /* [in] */ REFIID riid,
            /* [size_is][in] */ LPOLESTR *rgszNames,
            /* [range][in] */ UINT cNames,
            /* [in] */ LCID lcid,
            /* [size_is][out] */ DISPID *rgDispId);
        
        DECLSPEC_XFGVIRT(IDispatch, Invoke)
        /* [local] */ HRESULT ( STDMETHODCALLTYPE *Invoke )( 
            ILatexSnipperFormula * This,
            /* [annotation][in] */ 
            _In_  DISPID dispIdMember,
            /* [annotation][in] */ 
            _In_  REFIID riid,
            /* [annotation][in] */ 
            _In_  LCID lcid,
            /* [annotation][in] */ 
            _In_  WORD wFlags,
            /* [annotation][out][in] */ 
            _In_  DISPPARAMS *pDispParams,
            /* [annotation][out] */ 
            _Out_opt_  VARIANT *pVarResult,
            /* [annotation][out] */ 
            _Out_opt_  EXCEPINFO *pExcepInfo,
            /* [annotation][out] */ 
            _Out_opt_  UINT *puArgErr);
        
        DECLSPEC_XFGVIRT(ILatexSnipperFormula, InitializeFromJson)
        /* [id] */ HRESULT ( STDMETHODCALLTYPE *InitializeFromJson )( 
            ILatexSnipperFormula * This,
            /* [in] */ BSTR payloadJson);
        
        DECLSPEC_XFGVIRT(ILatexSnipperFormula, GetPayloadJson)
        /* [id] */ HRESULT ( STDMETHODCALLTYPE *GetPayloadJson )( 
            ILatexSnipperFormula * This,
            /* [retval][out] */ BSTR *payloadJson);
        
        DECLSPEC_XFGVIRT(ILatexSnipperFormula, ReplacePayloadJson)
        /* [id] */ HRESULT ( STDMETHODCALLTYPE *ReplacePayloadJson )( 
            ILatexSnipperFormula * This,
            /* [in] */ BSTR payloadJson);
        
        DECLSPEC_XFGVIRT(ILatexSnipperFormula, GetFormulaId)
        /* [id] */ HRESULT ( STDMETHODCALLTYPE *GetFormulaId )( 
            ILatexSnipperFormula * This,
            /* [retval][out] */ BSTR *formulaId);
        
        DECLSPEC_XFGVIRT(ILatexSnipperFormula, OpenEditor)
        /* [id] */ HRESULT ( STDMETHODCALLTYPE *OpenEditor )( 
            ILatexSnipperFormula * This);
        
        END_INTERFACE
    } ILatexSnipperFormulaVtbl;

    interface ILatexSnipperFormula
    {
        CONST_VTBL struct ILatexSnipperFormulaVtbl *lpVtbl;
    };

    

#ifdef COBJMACROS


#define ILatexSnipperFormula_QueryInterface(This,riid,ppvObject)	\
    ( (This)->lpVtbl -> QueryInterface(This,riid,ppvObject) ) 

#define ILatexSnipperFormula_AddRef(This)	\
    ( (This)->lpVtbl -> AddRef(This) ) 

#define ILatexSnipperFormula_Release(This)	\
    ( (This)->lpVtbl -> Release(This) ) 


#define ILatexSnipperFormula_GetTypeInfoCount(This,pctinfo)	\
    ( (This)->lpVtbl -> GetTypeInfoCount(This,pctinfo) ) 

#define ILatexSnipperFormula_GetTypeInfo(This,iTInfo,lcid,ppTInfo)	\
    ( (This)->lpVtbl -> GetTypeInfo(This,iTInfo,lcid,ppTInfo) ) 

#define ILatexSnipperFormula_GetIDsOfNames(This,riid,rgszNames,cNames,lcid,rgDispId)	\
    ( (This)->lpVtbl -> GetIDsOfNames(This,riid,rgszNames,cNames,lcid,rgDispId) ) 

#define ILatexSnipperFormula_Invoke(This,dispIdMember,riid,lcid,wFlags,pDispParams,pVarResult,pExcepInfo,puArgErr)	\
    ( (This)->lpVtbl -> Invoke(This,dispIdMember,riid,lcid,wFlags,pDispParams,pVarResult,pExcepInfo,puArgErr) ) 


#define ILatexSnipperFormula_InitializeFromJson(This,payloadJson)	\
    ( (This)->lpVtbl -> InitializeFromJson(This,payloadJson) ) 

#define ILatexSnipperFormula_GetPayloadJson(This,payloadJson)	\
    ( (This)->lpVtbl -> GetPayloadJson(This,payloadJson) ) 

#define ILatexSnipperFormula_ReplacePayloadJson(This,payloadJson)	\
    ( (This)->lpVtbl -> ReplacePayloadJson(This,payloadJson) ) 

#define ILatexSnipperFormula_GetFormulaId(This,formulaId)	\
    ( (This)->lpVtbl -> GetFormulaId(This,formulaId) ) 

#define ILatexSnipperFormula_OpenEditor(This)	\
    ( (This)->lpVtbl -> OpenEditor(This) ) 

#endif /* COBJMACROS */


#endif 	/* C style interface */




#endif 	/* __ILatexSnipperFormula_INTERFACE_DEFINED__ */



#ifndef __LaTeXSnipperFormulaLib_LIBRARY_DEFINED__
#define __LaTeXSnipperFormulaLib_LIBRARY_DEFINED__

/* library LaTeXSnipperFormulaLib */
/* [helpstring][version][uuid] */ 


EXTERN_C const IID LIBID_LaTeXSnipperFormulaLib;

EXTERN_C const CLSID CLSID_LaTeXSnipperFormula;

#ifdef __cplusplus

class DECLSPEC_UUID("C8F6C5BC-6A05-4E98-B3A0-AB52E52C4CA0")
LaTeXSnipperFormula;
#endif
#endif /* __LaTeXSnipperFormulaLib_LIBRARY_DEFINED__ */

/* Additional Prototypes for ALL interfaces */

unsigned long             __RPC_USER  BSTR_UserSize(     unsigned long *, unsigned long            , BSTR * ); 
unsigned char * __RPC_USER  BSTR_UserMarshal(  unsigned long *, unsigned char *, BSTR * ); 
unsigned char * __RPC_USER  BSTR_UserUnmarshal(unsigned long *, unsigned char *, BSTR * ); 
void                      __RPC_USER  BSTR_UserFree(     unsigned long *, BSTR * ); 

unsigned long             __RPC_USER  BSTR_UserSize64(     unsigned long *, unsigned long            , BSTR * ); 
unsigned char * __RPC_USER  BSTR_UserMarshal64(  unsigned long *, unsigned char *, BSTR * ); 
unsigned char * __RPC_USER  BSTR_UserUnmarshal64(unsigned long *, unsigned char *, BSTR * ); 
void                      __RPC_USER  BSTR_UserFree64(     unsigned long *, BSTR * ); 

/* end of Additional Prototypes */

#ifdef __cplusplus
}
#endif

#endif



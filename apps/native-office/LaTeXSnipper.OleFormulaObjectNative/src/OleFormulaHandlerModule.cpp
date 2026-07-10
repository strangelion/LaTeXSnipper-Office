#include "FormulaOleObject.h"
#include "OleFormulaIds.h"

#include <atlbase.h>
#include <new>

extern LONG GetNativeOleObjectCount();
extern LONG GetNativeOleLockCount();

// Saved DLL module handle so OleEditSession can derive the Desktop exe path
// from the DLL's own location, avoiding hardcoded registry keys.
HMODULE g_dllModule = nullptr;

// GDI+ token for PNG→EMF conversion in Presentation.cpp.
// Initialized lazily via std::call_once; never explicitly shut down
// (DLL_PROCESS_DETACH runs under loader lock where GdiplusShutdown
// can deadlock — the OS reclaims process resources on exit).
ULONG_PTR g_gdiplusToken = 0;

STDAPI DllCanUnloadNow()
{
    return GetNativeOleObjectCount() == 0 && GetNativeOleLockCount() == 0 ? S_OK : S_FALSE;
}

STDAPI DllGetClassObject(REFCLSID classId, REFIID iid, void** object)
{
    if (object == nullptr)
    {
        return E_POINTER;
    }

    *object = nullptr;
    if (classId != CLSID_LaTeXSnipperFormula)
    {
        return CLASS_E_CLASSNOTAVAILABLE;
    }

    FormulaClassFactory* factory = new (std::nothrow) FormulaClassFactory();
    if (factory == nullptr)
    {
        return E_OUTOFMEMORY;
    }

    HRESULT result = factory->QueryInterface(iid, object);
    factory->Release();
    return result;
}

BOOL WINAPI DllMain(HINSTANCE hinstDLL, DWORD reason, void*)
{
    switch (reason)
    {
    case DLL_PROCESS_ATTACH:
        if (hinstDLL != nullptr)
        {
            g_dllModule = hinstDLL;
        }
        break;
    }
    return TRUE;
}

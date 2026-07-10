#include "FormulaOleObject.h"
#include "OleFormulaIds.h"

#include <atlbase.h>
#include <gdiplus.h>
#include <new>

extern LONG GetNativeOleObjectCount();
extern LONG GetNativeOleLockCount();

// Saved DLL module handle so OleEditSession can derive the Desktop exe path
// from the DLL's own location, avoiding hardcoded registry keys.
HMODULE g_dllModule = nullptr;

// One-time GDI+ token for PNG→EMF conversion in Presentation.cpp
// Must be visible from Presentation.cpp
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
        // P1-8: GDI+ initialization moved to lazy std::call_once in Presentation.cpp
        // to avoid loader lock deadlocks when Office hosts the DLL.
        break;
    case DLL_PROCESS_DETACH:
        if (g_gdiplusToken != 0)
        {
            Gdiplus::GdiplusShutdown(g_gdiplusToken);
            g_gdiplusToken = 0;
        }
        break;
    }
    return TRUE;
}

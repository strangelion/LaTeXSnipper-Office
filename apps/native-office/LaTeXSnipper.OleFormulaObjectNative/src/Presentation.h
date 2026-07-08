#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <objidl.h>
#include <oaidl.h>
#include <ocidl.h>
#include <propidl.h>
#include <gdiplus.h>
#pragma comment(lib, "gdiplus.lib")

#include <string>
#include <vector>

// Presentation data: holds the LaTeX formula, JSON payload, EMF bytes, and logical size.
struct FormulaPresentation
{
    std::wstring latex;
    std::wstring payloadJson;
    SIZE himetricSize = {};
    std::vector<BYTE> enhancedMetafile;
};

// --- JSON helpers (defined in Presentation.cpp) ---
std::wstring ExtractJsonString(const std::wstring& json, const std::wstring& propertyName);
double ExtractJsonNumber(const std::wstring& json, const std::wstring& propertyName);

// --- EMF helpers (defined in Presentation.cpp) ---
HENHMETAFILE CopyEnhMetaFileFromBytes(const std::vector<BYTE>& bytes);
bool HasValidEmf(const std::vector<BYTE>& bytes);

// --- Factory functions (defined in Presentation.cpp) ---
FormulaPresentation CreatePlaceholderPresentation(const std::wstring& latex);
FormulaPresentation CreatePresentationFromPayload(const std::wstring& payloadJson);
FormulaPresentation CreatePresentationFromPayloadWithoutRendering(const std::wstring& payloadJson);
FormulaPresentation CreatePresentationFromPayloadPng(const std::wstring& payloadJson);

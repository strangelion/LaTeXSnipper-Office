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

enum class PreviewKind
{
    None,
    EmbeddedVectorEmf,
    GeneratedVectorEmf,
    RasterEmfFallback
};

struct FormulaPresentation
{
    std::wstring latex;
    std::wstring payloadJson;
    SIZE himetricSize = {};
    std::vector<BYTE> enhancedMetafile;
    PreviewKind previewKind = PreviewKind::None;
    std::wstring diagnostic;
    bool isVector = false;
};

// --- JSON helpers (defined in Presentation.cpp) ---
std::wstring ExtractJsonString(const std::wstring& json, const std::wstring& propertyName);
double ExtractJsonNumber(const std::wstring& json, const std::wstring& propertyName);

// --- EMF helpers (defined in Presentation.cpp) ---
HENHMETAFILE CopyEnhMetaFileFromBytes(const std::vector<BYTE>& bytes);
bool HasValidEmf(const std::vector<BYTE>& bytes);
bool HasCatastrophicFrameOverflow(const std::vector<BYTE>& emfBytes, std::wstring* reason);
bool TryReadEmfFrameHimetric(const std::vector<BYTE>& bytes, SIZEL* extent);

// --- Factory functions (defined in Presentation.cpp) ---
FormulaPresentation CreatePresentationFromPayload(const std::wstring& payloadJson);
FormulaPresentation CreatePresentationFromPayloadWithoutRendering(const std::wstring& payloadJson);
FormulaPresentation CreatePresentationFromPayloadPng(const std::wstring& payloadJson);

#pragma once

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <gdiplus.h>
#pragma comment(lib, "gdiplus.lib")

#include <string>
#include <vector>

struct FormulaPresentation
{
    std::wstring latex;
    std::wstring payloadJson;
    SIZE himetricSize;
    std::vector<BYTE> enhancedMetafile;
};

FormulaPresentation CreatePlaceholderPresentation(const std::wstring& latex);
FormulaPresentation CreatePresentationFromPayloadWithoutRendering(const std::wstring& payloadJson);
FormulaPresentation CreatePresentationFromPayload(const std::wstring& payloadJson);
HENHMETAFILE CopyEnhMetaFileFromBytes(const std::vector<BYTE>& bytes);

/// Validate EMF data by loading it and reading its header.
/// Returns true if the EMF bytes form a valid enhanced metafile.
bool HasValidEmf(const std::vector<BYTE>& bytes);

/// Create an EMF presentation by rendering the base64-encoded PNG from payloadJson.
/// Used when no emfBase64 is present but render.png is available.
FormulaPresentation CreatePresentationFromPayloadPng(const std::wstring& payloadJson);

// JSON field extraction (used by FormulaOleObject automation)
std::wstring ExtractJsonString(const std::wstring& json, const std::wstring& propertyName);
double ExtractJsonNumber(const std::wstring& json, const std::wstring& propertyName);

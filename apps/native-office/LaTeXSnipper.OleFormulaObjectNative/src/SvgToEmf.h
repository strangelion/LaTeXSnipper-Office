#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <string>
#include <vector>

struct EmfInkIntegrity
{
    bool valid = false;
    DWORD recordCount = 0;
    DWORD drawingRecordCount = 0;
    RECT frameHimetric{};
    RECT headerInkBoundsDevice{};
    RECT rasterOracleInkBounds{};
    double coverageRatio = 0.0;
    double aspectRatioError = 0.0;
    std::wstring reason;
};

struct SvgGeometryBounds
{
    bool valid = false;
    double left = 0.0;
    double top = 0.0;
    double right = 0.0;
    double bottom = 0.0;
};

struct SvgRasterOracle
{
    bool valid = false;
    RECT inkBounds{};
    double coverageRatio = 0.0;
};

struct SvgToEmfResult
{
    bool success = false;
    std::vector<BYTE> emfBytes;
    SIZE himetricSize{};
    std::wstring error;
    bool containsRasterRecords = false;
    DWORD svgPathCount = 0;
    DWORD svgUseCount = 0;
    DWORD svgTextCount = 0;
    std::wstring svgViewBox;
    SvgGeometryBounds svgGeometricBounds;
    SvgRasterOracle svgRasterOracle;
    EmfInkIntegrity inkIntegrity;
};

SvgToEmfResult ConvertMathJaxSvgToVectorEmf(
    const std::wstring& svg,
    double widthPt,
    double heightPt,
    const std::wstring& currentColor);

bool ContainsRasterEmfRecords(const std::vector<BYTE>& emfBytes, std::wstring* reason);
bool HasVectorDrawingEmfRecords(const std::vector<BYTE>& emfBytes, std::wstring* reason);
bool ValidateEmfRecords(const std::vector<BYTE>& emfBytes, std::wstring* reason);
bool AnalyzeEmfInkIntegrity(
    const std::vector<BYTE>& emfBytes,
    EmfInkIntegrity* integrity,
    const SvgRasterOracle* expectedRaster = nullptr);

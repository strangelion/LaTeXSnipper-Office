#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <string>
#include <vector>

struct SvgToEmfResult
{
    bool success = false;
    std::vector<BYTE> emfBytes;
    SIZE himetricSize{};
    std::wstring error;
    bool containsRasterRecords = false;
};

SvgToEmfResult ConvertMathJaxSvgToVectorEmf(
    const std::wstring& svg,
    double widthPt,
    double heightPt,
    const std::wstring& currentColor);

bool ContainsRasterEmfRecords(const std::vector<BYTE>& emfBytes, std::wstring* reason);
bool HasVectorDrawingEmfRecords(const std::vector<BYTE>& emfBytes, std::wstring* reason);

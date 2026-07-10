#pragma once

#include <array>
#include <string>
#include <vector>

struct SvgPoint
{
    double x = 0.0;
    double y = 0.0;
};

enum class SvgPathOperationType
{
    MoveTo,
    LineTo,
    CubicTo,
    Close
};

struct SvgPathOperation
{
    SvgPathOperationType type = SvgPathOperationType::MoveTo;
    std::array<SvgPoint, 3> points{};
};

struct SvgPathParseResult
{
    bool success = false;
    std::vector<SvgPathOperation> operations;
    std::wstring error;
    size_t commandCount = 0;
};

SvgPathParseResult ParseSvgPathData(const std::wstring& pathData);

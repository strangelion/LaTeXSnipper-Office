#include "SvgToEmf.h"

#include "SvgPathParser.h"

#include <unknwn.h>
#include <objidl.h>
#include <xmllite.h>
#include <shlwapi.h>

#include <algorithm>
#include <array>
#include <cerrno>
#include <climits>
#include <cmath>
#include <cstddef>
#include <cstring>
#include <cwchar>
#include <cwctype>
#include <map>
#include <memory>
#include <set>
#include <sstream>
#include <string>
#include <vector>

namespace
{
constexpr size_t kMaxSvgBytes = 8 * 1024 * 1024;
constexpr size_t kMaxNodes = 100000;
constexpr UINT kMaxXmlDepth = 64;
constexpr size_t kMaxUseDepth = 32;
constexpr size_t kMaxUseExpansions = 100000;
constexpr size_t kMaxPathOperations = 1000000;
constexpr size_t kMaxDrawCalls = 100000;
constexpr size_t kMaxEmfBytes = 128 * 1024 * 1024;
constexpr size_t kMaxEmfRecords = 1000000;
constexpr DWORD kMaxEmfRecordBytes = 64 * 1024 * 1024;
constexpr double kMaxCoordinateMagnitude = 1.0e9;
constexpr double kHimetricPerInch = 2540.0;
constexpr double kPointsPerInch = 72.0;
constexpr double kRenderDpi = 144.0;
constexpr double kLogicalUnitsPerInch = 25400.0;
constexpr double kPi = 3.1415926535897932384626433832795;

struct ComReleaser
{
    void operator()(IUnknown* value) const
    {
        if (value != nullptr) value->Release();
    }
};

template <typename T>
using ComPtr = std::unique_ptr<T, ComReleaser>;

struct SvgNode
{
    std::wstring name;
    std::map<std::wstring, std::wstring> attributes;
    std::vector<std::unique_ptr<SvgNode>> children;
};

struct Matrix
{
    double a = 1.0;
    double b = 0.0;
    double c = 0.0;
    double d = 1.0;
    double e = 0.0;
    double f = 0.0;
};

struct Color
{
    BYTE red = 0;
    BYTE green = 0;
    BYTE blue = 0;
    BYTE alpha = 255;
};

enum class PaintKind
{
    Color,
    CurrentColor,
    None
};

struct Paint
{
    PaintKind kind = PaintKind::Color;
    Color color{};
};

struct Style
{
    Paint fill{};
    Paint stroke{PaintKind::None, {}};
    Color currentColor{};
    double strokeWidth = 1.0;
    double opacity = 1.0;
    double fillOpacity = 1.0;
    double strokeOpacity = 1.0;
    bool evenOdd = false;
};

struct RenderContext
{
    HDC dc = nullptr;
    std::map<std::wstring, SvgNode*> ids;
    size_t vectorDrawCount = 0;
    size_t pathOperationCount = 0;
    size_t useExpansionCount = 0;
    std::wstring error;
};

std::wstring Trim(std::wstring value)
{
    auto isSpace = [](wchar_t value) { return std::iswspace(value) != 0; };
    value.erase(value.begin(), std::find_if(value.begin(), value.end(), [&](wchar_t ch) { return !isSpace(ch); }));
    value.erase(std::find_if(value.rbegin(), value.rend(), [&](wchar_t ch) { return !isSpace(ch); }).base(), value.end());
    return value;
}

std::wstring Lower(std::wstring value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });
    return value;
}

bool IsFinite(double value)
{
    return std::isfinite(value) && std::abs(value) <= kMaxCoordinateMagnitude;
}

bool ParseNumber(const std::wstring& text, double* value)
{
    const std::wstring trimmed = Trim(text);
    if (trimmed.empty()) return false;
    wchar_t* end = nullptr;
    errno = 0;
    const double parsed = std::wcstod(trimmed.c_str(), &end);
    if (end == trimmed.c_str() || errno == ERANGE || !IsFinite(parsed)) return false;
    while (*end != L'\0' && std::iswspace(*end)) ++end;
    if (*end != L'\0' && std::wcscmp(end, L"px") != 0 && std::wcscmp(end, L"pt") != 0) return false;
    *value = parsed;
    return true;
}

std::vector<double> ParseNumberList(const std::wstring& text, bool* success)
{
    std::vector<double> values;
    size_t position = 0;
    *success = true;
    while (position < text.size())
    {
        while (position < text.size() && (std::iswspace(text[position]) || text[position] == L',')) ++position;
        if (position >= text.size()) break;
        wchar_t* end = nullptr;
        errno = 0;
        const double value = std::wcstod(text.c_str() + position, &end);
        if (end == text.c_str() + position || errno == ERANGE || !IsFinite(value))
        {
            *success = false;
            return {};
        }
        values.push_back(value);
        position += static_cast<size_t>(end - (text.c_str() + position));
    }
    return values;
}

Matrix Multiply(const Matrix& left, const Matrix& right)
{
    return {
        left.a * right.a + left.c * right.b,
        left.b * right.a + left.d * right.b,
        left.a * right.c + left.c * right.d,
        left.b * right.c + left.d * right.d,
        left.a * right.e + left.c * right.f + left.e,
        left.b * right.e + left.d * right.f + left.f
    };
}

SvgPoint TransformPoint(const Matrix& matrix, SvgPoint point)
{
    return {
        matrix.a * point.x + matrix.c * point.y + matrix.e,
        matrix.b * point.x + matrix.d * point.y + matrix.f
    };
}

double MatrixScale(const Matrix& matrix)
{
    const double sx = std::hypot(matrix.a, matrix.b);
    const double sy = std::hypot(matrix.c, matrix.d);
    return (std::max)(sx, sy);
}

bool ParseTransform(const std::wstring& text, Matrix* result, std::wstring* error)
{
    Matrix total{};
    size_t position = 0;
    while (position < text.size())
    {
        while (position < text.size() && (std::iswspace(text[position]) || text[position] == L',')) ++position;
        if (position >= text.size()) break;
        const size_t nameStart = position;
        while (position < text.size() && std::iswalpha(text[position])) ++position;
        if (nameStart == position)
        {
            *error = L"SVG_VECTOR_INVALID_TRANSFORM: expected transform name";
            return false;
        }
        const std::wstring name = Lower(text.substr(nameStart, position - nameStart));
        while (position < text.size() && std::iswspace(text[position])) ++position;
        if (position >= text.size() || text[position] != L'(')
        {
            *error = L"SVG_VECTOR_INVALID_TRANSFORM: expected opening parenthesis";
            return false;
        }
        const size_t open = position++;
        const size_t close = text.find(L')', position);
        if (close == std::wstring::npos)
        {
            *error = L"SVG_VECTOR_INVALID_TRANSFORM: missing closing parenthesis";
            return false;
        }
        bool numbersValid = false;
        const std::vector<double> values = ParseNumberList(text.substr(open + 1, close - open - 1), &numbersValid);
        if (!numbersValid)
        {
            *error = L"SVG_VECTOR_INVALID_TRANSFORM: invalid transform number";
            return false;
        }
        Matrix next{};
        if (name == L"matrix" && values.size() == 6)
        {
            next = {values[0], values[1], values[2], values[3], values[4], values[5]};
        }
        else if (name == L"translate" && (values.size() == 1 || values.size() == 2))
        {
            next.e = values[0];
            next.f = values.size() == 2 ? values[1] : 0.0;
        }
        else if (name == L"scale" && (values.size() == 1 || values.size() == 2))
        {
            next.a = values[0];
            next.d = values.size() == 2 ? values[1] : values[0];
        }
        else if (name == L"rotate" && (values.size() == 1 || values.size() == 3))
        {
            const double angle = values[0] * kPi / 180.0;
            Matrix rotation{std::cos(angle), std::sin(angle), -std::sin(angle), std::cos(angle), 0.0, 0.0};
            if (values.size() == 3)
            {
                Matrix toCenter{};
                toCenter.e = values[1];
                toCenter.f = values[2];
                Matrix fromCenter{};
                fromCenter.e = -values[1];
                fromCenter.f = -values[2];
                next = Multiply(Multiply(toCenter, rotation), fromCenter);
            }
            else next = rotation;
        }
        else if ((name == L"skewx" || name == L"skewy") && values.size() == 1)
        {
            const double tangent = std::tan(values[0] * kPi / 180.0);
            if (!IsFinite(tangent))
            {
                *error = L"SVG_VECTOR_INVALID_TRANSFORM: skew is out of range";
                return false;
            }
            if (name == L"skewx") next.c = tangent;
            else next.b = tangent;
        }
        else
        {
            *error = L"SVG_VECTOR_INVALID_TRANSFORM: unsupported transform arguments";
            return false;
        }
        total = Multiply(total, next);
        position = close + 1;
    }
    *result = total;
    return true;
}

bool HexDigit(wchar_t ch, BYTE* value)
{
    if (ch >= L'0' && ch <= L'9') *value = static_cast<BYTE>(ch - L'0');
    else if (ch >= L'a' && ch <= L'f') *value = static_cast<BYTE>(ch - L'a' + 10);
    else if (ch >= L'A' && ch <= L'F') *value = static_cast<BYTE>(ch - L'A' + 10);
    else return false;
    return true;
}

bool ParseColor(const std::wstring& input, Paint* paint)
{
    const std::wstring value = Lower(Trim(input));
    if (value == L"none") { paint->kind = PaintKind::None; return true; }
    if (value == L"currentcolor") { paint->kind = PaintKind::CurrentColor; return true; }
    if (value == L"transparent") { paint->kind = PaintKind::Color; paint->color = {0, 0, 0, 0}; return true; }
    if (value == L"black" || value == L"white")
    {
        const BYTE channel = value == L"white" ? 255 : 0;
        paint->kind = PaintKind::Color;
        paint->color = {channel, channel, channel, 255};
        return true;
    }
    if (!value.empty() && value[0] == L'#')
    {
        std::vector<BYTE> digits;
        for (size_t index = 1; index < value.size(); ++index)
        {
            BYTE digit = 0;
            if (!HexDigit(value[index], &digit)) return false;
            digits.push_back(digit);
        }
        Color color{};
        if (digits.size() == 3)
        {
            color = {static_cast<BYTE>(digits[0] * 17), static_cast<BYTE>(digits[1] * 17), static_cast<BYTE>(digits[2] * 17), 255};
        }
        else if (digits.size() == 6 || digits.size() == 8)
        {
            color.red = static_cast<BYTE>(digits[0] * 16 + digits[1]);
            color.green = static_cast<BYTE>(digits[2] * 16 + digits[3]);
            color.blue = static_cast<BYTE>(digits[4] * 16 + digits[5]);
            color.alpha = digits.size() == 8 ? static_cast<BYTE>(digits[6] * 16 + digits[7]) : 255;
        }
        else return false;
        paint->kind = PaintKind::Color;
        paint->color = color;
        return true;
    }
    const bool rgba = value.rfind(L"rgba(", 0) == 0;
    const bool rgb = value.rfind(L"rgb(", 0) == 0;
    if (rgba || rgb)
    {
        const size_t open = value.find(L'(');
        const size_t close = value.rfind(L')');
        if (close == std::wstring::npos || close <= open) return false;
        bool success = false;
        const std::vector<double> components = ParseNumberList(value.substr(open + 1, close - open - 1), &success);
        if (!success || components.size() != (rgba ? 4u : 3u)) return false;
        for (size_t index = 0; index < 3; ++index)
        {
            if (components[index] < 0.0 || components[index] > 255.0) return false;
        }
        const double alpha = rgba ? components[3] : 1.0;
        if (alpha < 0.0 || alpha > 1.0) return false;
        paint->kind = PaintKind::Color;
        paint->color = {
            static_cast<BYTE>(std::lround(components[0])),
            static_cast<BYTE>(std::lround(components[1])),
            static_cast<BYTE>(std::lround(components[2])),
            static_cast<BYTE>(std::lround(alpha * 255.0))
        };
        return true;
    }
    return false;
}

const std::wstring* Attribute(const SvgNode& node, const std::wstring& name)
{
    auto found = node.attributes.find(name);
    return found == node.attributes.end() ? nullptr : &found->second;
}

bool ReadAttributeNumber(const SvgNode& node, const std::wstring& name, double defaultValue, double* value, std::wstring* error)
{
    const std::wstring* text = Attribute(node, name);
    if (text == nullptr)
    {
        *value = defaultValue;
        return true;
    }
    if (!ParseNumber(*text, value))
    {
        *error = L"SVG_VECTOR_INVALID_NUMBER: invalid " + name;
        return false;
    }
    return true;
}

bool ApplyStyleProperty(const std::wstring& rawName, const std::wstring& rawValue, Style* style, std::wstring* error)
{
    const std::wstring name = Lower(Trim(rawName));
    const std::wstring value = Trim(rawValue);
    static const std::set<std::wstring> unsupportedVisualProperties = {
        L"clip-path", L"mask", L"display", L"visibility", L"stroke-linecap",
        L"stroke-linejoin", L"stroke-dasharray", L"stroke-dashoffset", L"vector-effect"
    };
    if (unsupportedVisualProperties.find(name) != unsupportedVisualProperties.end())
    {
        *error = L"SVG_VECTOR_UNSUPPORTED_FEATURE: " + name;
        return false;
    }
    if (name == L"fill" || name == L"stroke")
    {
        Paint parsed{};
        if (!ParseColor(value, &parsed))
        {
            *error = L"SVG_VECTOR_INVALID_COLOR: invalid " + name;
            return false;
        }
        if (name == L"fill") style->fill = parsed;
        else style->stroke = parsed;
    }
    else if (name == L"color")
    {
        Paint parsed{};
        if (!ParseColor(value, &parsed) || parsed.kind != PaintKind::Color)
        {
            *error = L"SVG_VECTOR_INVALID_COLOR: invalid color";
            return false;
        }
        style->currentColor = parsed.color;
    }
    else if (name == L"stroke-width" || name == L"opacity" || name == L"fill-opacity" || name == L"stroke-opacity")
    {
        double parsed = 0.0;
        if (!ParseNumber(value, &parsed) || parsed < 0.0)
        {
            *error = L"SVG_VECTOR_INVALID_STYLE: invalid " + name;
            return false;
        }
        if (name == L"stroke-width") style->strokeWidth = parsed;
        else
        {
            parsed = (std::min)(1.0, parsed);
            if (name == L"opacity") style->opacity *= parsed;
            else if (name == L"fill-opacity") style->fillOpacity = parsed;
            else style->strokeOpacity = parsed;
        }
    }
    else if (name == L"fill-rule") style->evenOdd = Lower(value) == L"evenodd";
    return true;
}

bool ResolveStyle(const SvgNode& node, const Style& inherited, Style* result, std::wstring* error)
{
    static const std::set<std::wstring> unsupportedVisualAttributes = {
        L"clip-path", L"mask", L"display", L"visibility", L"stroke-linecap",
        L"stroke-linejoin", L"stroke-dasharray", L"stroke-dashoffset", L"vector-effect"
    };
    for (const auto& attribute : node.attributes)
    {
        if (unsupportedVisualAttributes.find(attribute.first) != unsupportedVisualAttributes.end())
        {
            *error = L"SVG_VECTOR_UNSUPPORTED_FEATURE: " + attribute.first;
            return false;
        }
    }
    Style style = inherited;
    const std::array<std::wstring, 8> properties = {
        L"fill", L"stroke", L"stroke-width", L"fill-rule", L"opacity", L"fill-opacity", L"stroke-opacity", L"color"
    };
    for (const auto& property : properties)
    {
        const std::wstring* value = Attribute(node, property);
        if (value != nullptr && !ApplyStyleProperty(property, *value, &style, error)) return false;
    }
    const std::wstring* inlineStyle = Attribute(node, L"style");
    if (inlineStyle != nullptr)
    {
        size_t start = 0;
        while (start < inlineStyle->size())
        {
            const size_t end = inlineStyle->find(L';', start);
            const std::wstring declaration = inlineStyle->substr(start, end == std::wstring::npos ? std::wstring::npos : end - start);
            const size_t colon = declaration.find(L':');
            if (colon != std::wstring::npos && !ApplyStyleProperty(declaration.substr(0, colon), declaration.substr(colon + 1), &style, error)) return false;
            if (end == std::wstring::npos) break;
            start = end + 1;
        }
    }
    if (style.opacity != 1.0 || style.fillOpacity != 1.0 || style.strokeOpacity != 1.0 ||
        style.fill.color.alpha != 255 || style.stroke.color.alpha != 255 || style.currentColor.alpha != 255)
    {
        *error = L"SVG_VECTOR_UNSUPPORTED_FEATURE: alpha opacity requires raster fallback";
        return false;
    }
    *result = style;
    return true;
}

Color ResolvePaint(const Paint& paint, const Style& style, double opacity)
{
    Color color = paint.kind == PaintKind::CurrentColor ? style.currentColor : paint.color;
    color.alpha = static_cast<BYTE>(std::lround(color.alpha * (std::max)(0.0, (std::min)(1.0, opacity))));
    return color;
}

COLORREF ToColorRef(Color color)
{
    return RGB(color.red, color.green, color.blue);
}

POINT ToPoint(SvgPoint point, bool* success)
{
    if (!IsFinite(point.x) || !IsFinite(point.y) || point.x < LONG_MIN || point.x > LONG_MAX || point.y < LONG_MIN || point.y > LONG_MAX)
    {
        *success = false;
        return {};
    }
    return {static_cast<LONG>(std::lround(point.x)), static_cast<LONG>(std::lround(point.y))};
}

bool DrawOperations(RenderContext* context, const std::vector<SvgPathOperation>& operations, const Matrix& matrix, const Style& style)
{
    if (operations.empty()) return true;
    if (operations.size() > kMaxPathOperations - context->pathOperationCount)
    {
        context->error = L"SVG_VECTOR_LIMIT_EXCEEDED: too many path operations";
        return false;
    }
    context->pathOperationCount += operations.size();
    if (context->vectorDrawCount >= kMaxDrawCalls)
    {
        context->error = L"SVG_VECTOR_LIMIT_EXCEEDED: too many GDI draw calls";
        return false;
    }
    if (!BeginPath(context->dc))
    {
        context->error = L"SVG_VECTOR_GDI_ERROR: BeginPath failed";
        return false;
    }
    bool pointsValid = true;
    for (const auto& operation : operations)
    {
        if (operation.type == SvgPathOperationType::MoveTo)
        {
            POINT point = ToPoint(TransformPoint(matrix, operation.points[0]), &pointsValid);
            if (!pointsValid || !MoveToEx(context->dc, point.x, point.y, nullptr)) break;
        }
        else if (operation.type == SvgPathOperationType::LineTo)
        {
            POINT point = ToPoint(TransformPoint(matrix, operation.points[0]), &pointsValid);
            if (!pointsValid || !LineTo(context->dc, point.x, point.y)) break;
        }
        else if (operation.type == SvgPathOperationType::CubicTo)
        {
            POINT points[3] = {
                ToPoint(TransformPoint(matrix, operation.points[0]), &pointsValid),
                ToPoint(TransformPoint(matrix, operation.points[1]), &pointsValid),
                ToPoint(TransformPoint(matrix, operation.points[2]), &pointsValid)
            };
            if (!pointsValid || !PolyBezierTo(context->dc, points, 3)) break;
        }
        else if (!CloseFigure(context->dc)) break;
    }
    if (!pointsValid || !EndPath(context->dc))
    {
        AbortPath(context->dc);
        context->error = L"SVG_VECTOR_GDI_ERROR: invalid path coordinates";
        return false;
    }

    const bool fillVisible = style.fill.kind != PaintKind::None && ResolvePaint(style.fill, style, style.opacity * style.fillOpacity).alpha != 0;
    const bool strokeVisible = style.stroke.kind != PaintKind::None && style.strokeWidth > 0.0 && ResolvePaint(style.stroke, style, style.opacity * style.strokeOpacity).alpha != 0;
    if (!fillVisible && !strokeVisible)
    {
        AbortPath(context->dc);
        return true;
    }

    HBRUSH brush = static_cast<HBRUSH>(GetStockObject(NULL_BRUSH));
    HPEN pen = static_cast<HPEN>(GetStockObject(NULL_PEN));
    HBRUSH createdBrush = nullptr;
    HPEN createdPen = nullptr;
    if (fillVisible)
    {
        createdBrush = CreateSolidBrush(ToColorRef(ResolvePaint(style.fill, style, style.opacity * style.fillOpacity)));
        if (createdBrush != nullptr) brush = createdBrush;
    }
    if (strokeVisible)
    {
        const int width = (std::max)(1, static_cast<int>(std::lround(style.strokeWidth * MatrixScale(matrix))));
        createdPen = CreatePen(PS_SOLID, width, ToColorRef(ResolvePaint(style.stroke, style, style.opacity * style.strokeOpacity)));
        if (createdPen != nullptr) pen = createdPen;
    }
    HGDIOBJ oldBrush = SelectObject(context->dc, brush);
    HGDIOBJ oldPen = SelectObject(context->dc, pen);
    SetPolyFillMode(context->dc, style.evenOdd ? ALTERNATE : WINDING);
    BOOL drawn = FALSE;
    if (fillVisible && strokeVisible) drawn = StrokeAndFillPath(context->dc);
    else if (fillVisible) drawn = FillPath(context->dc);
    else drawn = StrokePath(context->dc);
    SelectObject(context->dc, oldPen);
    SelectObject(context->dc, oldBrush);
    if (createdPen != nullptr) DeleteObject(createdPen);
    if (createdBrush != nullptr) DeleteObject(createdBrush);
    if (!drawn)
    {
        context->error = L"SVG_VECTOR_GDI_ERROR: path rendering failed";
        return false;
    }
    ++context->vectorDrawCount;
    return true;
}

std::vector<SvgPathOperation> PolygonOperations(const std::vector<SvgPoint>& points, bool close)
{
    std::vector<SvgPathOperation> operations;
    if (points.empty()) return operations;
    SvgPathOperation first{};
    first.type = SvgPathOperationType::MoveTo;
    first.points[0] = points[0];
    operations.push_back(first);
    for (size_t index = 1; index < points.size(); ++index)
    {
        SvgPathOperation line{};
        line.type = SvgPathOperationType::LineTo;
        line.points[0] = points[index];
        operations.push_back(line);
    }
    if (close)
    {
        SvgPathOperation operation{};
        operation.type = SvgPathOperationType::Close;
        operations.push_back(operation);
    }
    return operations;
}

std::vector<SvgPathOperation> EllipseOperations(double cx, double cy, double rx, double ry)
{
    constexpr double kappa = 0.5522847498307936;
    std::vector<SvgPathOperation> operations;
    SvgPathOperation move{};
    move.type = SvgPathOperationType::MoveTo;
    move.points[0] = {cx + rx, cy};
    operations.push_back(move);
    const std::array<std::array<SvgPoint, 3>, 4> segments = {{
        {{{cx + rx, cy + kappa * ry}, {cx + kappa * rx, cy + ry}, {cx, cy + ry}}},
        {{{cx - kappa * rx, cy + ry}, {cx - rx, cy + kappa * ry}, {cx - rx, cy}}},
        {{{cx - rx, cy - kappa * ry}, {cx - kappa * rx, cy - ry}, {cx, cy - ry}}},
        {{{cx + kappa * rx, cy - ry}, {cx + rx, cy - kappa * ry}, {cx + rx, cy}}}
    }};
    for (const auto& segment : segments)
    {
        SvgPathOperation cubic{};
        cubic.type = SvgPathOperationType::CubicTo;
        cubic.points = segment;
        operations.push_back(cubic);
    }
    SvgPathOperation close{};
    close.type = SvgPathOperationType::Close;
    operations.push_back(close);
    return operations;
}

bool ParsePoints(const std::wstring& text, std::vector<SvgPoint>* points)
{
    bool success = false;
    const std::vector<double> numbers = ParseNumberList(text, &success);
    if (!success || numbers.size() < 2 || numbers.size() % 2 != 0) return false;
    for (size_t index = 0; index < numbers.size(); index += 2) points->push_back({numbers[index], numbers[index + 1]});
    return true;
}

bool RenderNode(RenderContext* context, const SvgNode& node, const Matrix& parentMatrix, const Style& inheritedStyle,
                std::set<std::wstring>* useStack, size_t useDepth, bool referenced);

bool RenderGeometry(RenderContext* context, const SvgNode& node, const Matrix& matrix, const Style& style)
{
    std::vector<SvgPathOperation> operations;
    if (node.name == L"path")
    {
        const std::wstring* path = Attribute(node, L"d");
        if (path == nullptr)
        {
            context->error = L"SVG_PATH_EMPTY: path has no d attribute";
            return false;
        }
        SvgPathParseResult parsed = ParseSvgPathData(*path);
        if (!parsed.success)
        {
            context->error = parsed.error;
            return false;
        }
        operations = std::move(parsed.operations);
    }
    else if (node.name == L"rect")
    {
        double x = 0, y = 0, width = 0, height = 0;
        if (!ReadAttributeNumber(node, L"x", 0, &x, &context->error) || !ReadAttributeNumber(node, L"y", 0, &y, &context->error) ||
            !ReadAttributeNumber(node, L"width", 0, &width, &context->error) || !ReadAttributeNumber(node, L"height", 0, &height, &context->error)) return false;
        if (width < 0 || height < 0) { context->error = L"SVG_VECTOR_INVALID_NUMBER: negative rectangle size"; return false; }
        if (width == 0 || height == 0) return true;
        operations = PolygonOperations({{x, y}, {x + width, y}, {x + width, y + height}, {x, y + height}}, true);
    }
    else if (node.name == L"line")
    {
        double x1 = 0, y1 = 0, x2 = 0, y2 = 0;
        if (!ReadAttributeNumber(node, L"x1", 0, &x1, &context->error) || !ReadAttributeNumber(node, L"y1", 0, &y1, &context->error) ||
            !ReadAttributeNumber(node, L"x2", 0, &x2, &context->error) || !ReadAttributeNumber(node, L"y2", 0, &y2, &context->error)) return false;
        operations = PolygonOperations({{x1, y1}, {x2, y2}}, false);
    }
    else if (node.name == L"polyline" || node.name == L"polygon")
    {
        const std::wstring* value = Attribute(node, L"points");
        std::vector<SvgPoint> points;
        if (value == nullptr || !ParsePoints(*value, &points)) { context->error = L"SVG_VECTOR_INVALID_POINTS: invalid point list"; return false; }
        operations = PolygonOperations(points, node.name == L"polygon");
    }
    else if (node.name == L"circle" || node.name == L"ellipse")
    {
        double cx = 0, cy = 0, rx = 0, ry = 0;
        if (!ReadAttributeNumber(node, L"cx", 0, &cx, &context->error) || !ReadAttributeNumber(node, L"cy", 0, &cy, &context->error)) return false;
        if (node.name == L"circle")
        {
            if (!ReadAttributeNumber(node, L"r", 0, &rx, &context->error)) return false;
            ry = rx;
        }
        else if (!ReadAttributeNumber(node, L"rx", 0, &rx, &context->error) || !ReadAttributeNumber(node, L"ry", 0, &ry, &context->error)) return false;
        if (rx < 0 || ry < 0) { context->error = L"SVG_VECTOR_INVALID_NUMBER: negative ellipse radius"; return false; }
        if (rx == 0 || ry == 0) return true;
        operations = EllipseOperations(cx, cy, rx, ry);
    }
    return DrawOperations(context, operations, matrix, style);
}

bool RenderNode(RenderContext* context, const SvgNode& node, const Matrix& parentMatrix, const Style& inheritedStyle,
                std::set<std::wstring>* useStack, size_t useDepth, bool referenced)
{
    Style style{};
    if (!ResolveStyle(node, inheritedStyle, &style, &context->error)) return false;
    Matrix local{};
    const std::wstring* transform = Attribute(node, L"transform");
    if (transform != nullptr && !ParseTransform(*transform, &local, &context->error)) return false;
    Matrix matrix = Multiply(parentMatrix, local);

    if (node.name == L"defs" && !referenced) return true;
    if (node.name == L"use")
    {
        if (++context->useExpansionCount > kMaxUseExpansions) { context->error = L"SVG_VECTOR_USE_LIMIT_EXCEEDED: too many use expansions"; return false; }
        if (useDepth >= kMaxUseDepth) { context->error = L"SVG_VECTOR_USE_LIMIT_EXCEEDED: use nesting is too deep"; return false; }
        const std::wstring* href = Attribute(node, L"href");
        if (href == nullptr) href = Attribute(node, L"xlink:href");
        if (href == nullptr || href->empty() || (*href)[0] != L'#')
        {
            context->error = L"SVG_VECTOR_UNSUPPORTED_FEATURE: external or missing use href";
            return false;
        }
        const std::wstring id = href->substr(1);
        auto found = context->ids.find(id);
        if (found == context->ids.end()) { context->error = L"SVG_VECTOR_INVALID_USE: referenced id was not found"; return false; }
        if (!useStack->insert(id).second) { context->error = L"SVG_VECTOR_USE_CYCLE: circular use reference"; return false; }
        double x = 0, y = 0;
        if (!ReadAttributeNumber(node, L"x", 0, &x, &context->error) || !ReadAttributeNumber(node, L"y", 0, &y, &context->error)) return false;
        Matrix translation{};
        translation.e = x;
        translation.f = y;
        const bool success = RenderNode(context, *found->second, Multiply(matrix, translation), style, useStack, useDepth + 1, true);
        useStack->erase(id);
        return success;
    }
    if (node.name == L"path" || node.name == L"rect" || node.name == L"line" || node.name == L"polyline" ||
        node.name == L"polygon" || node.name == L"circle" || node.name == L"ellipse")
    {
        if (!RenderGeometry(context, node, matrix, style)) return false;
    }
    for (const auto& child : node.children)
    {
        if (!RenderNode(context, *child, matrix, style, useStack, useDepth, referenced)) return false;
    }
    return true;
}

bool IsAllowedElement(const std::wstring& name)
{
    static const std::set<std::wstring> allowed = {
        L"svg", L"g", L"path", L"rect", L"line", L"polyline", L"polygon", L"circle", L"ellipse", L"defs", L"use",
        L"title", L"desc", L"metadata"
    };
    return allowed.find(name) != allowed.end();
}

bool IsExplicitlyUnsupported(const std::wstring& name)
{
    static const std::set<std::wstring> unsupported = {
        L"image", L"foreignobject", L"script", L"animate", L"animatemotion", L"animatetransform", L"filter", L"style"
    };
    return unsupported.find(name) != unsupported.end();
}

std::string WideToUtf8(const std::wstring& value)
{
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    if (size <= 0) return {};
    std::string result(static_cast<size_t>(size), '\0');
    if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr) != size) return {};
    return result;
}

bool ParseXml(const std::wstring& svg, std::unique_ptr<SvgNode>* root, std::wstring* error)
{
    if (Lower(svg).find(L"<!doctype") != std::wstring::npos)
    {
        *error = L"SVG_VECTOR_UNSUPPORTED_FEATURE: DTD is prohibited";
        return false;
    }
    const std::string utf8 = WideToUtf8(svg);
    if (utf8.empty()) { *error = L"SVG_VECTOR_INVALID_XML: SVG is empty or invalid UTF-16"; return false; }
    if (utf8.size() > kMaxSvgBytes) { *error = L"SVG_VECTOR_LIMIT_EXCEEDED: SVG exceeds 8 MiB"; return false; }
    ComPtr<IStream> stream(SHCreateMemStream(reinterpret_cast<const BYTE*>(utf8.data()), static_cast<UINT>(utf8.size())));
    if (!stream) { *error = L"SVG_VECTOR_COM_ERROR: cannot create XML input stream"; return false; }
    IXmlReader* rawReader = nullptr;
    HRESULT hr = CreateXmlReader(__uuidof(IXmlReader), reinterpret_cast<void**>(&rawReader), nullptr);
    if (FAILED(hr)) { *error = L"SVG_VECTOR_COM_ERROR: cannot create XmlLite reader"; return false; }
    ComPtr<IXmlReader> reader(rawReader);
    reader->SetProperty(XmlReaderProperty_DtdProcessing, DtdProcessing_Prohibit);
    reader->SetProperty(XmlReaderProperty_XmlResolver, 0);
    reader->SetProperty(XmlReaderProperty_MaxElementDepth, kMaxXmlDepth);
    reader->SetProperty(XmlReaderProperty_MaxEntityExpansion, 0);
    hr = reader->SetInput(stream.get());
    if (FAILED(hr)) { *error = L"SVG_VECTOR_COM_ERROR: XmlLite rejected the input stream"; return false; }

    std::vector<SvgNode*> stack;
    size_t nodeCount = 0;
    XmlNodeType type = XmlNodeType_None;
    while ((hr = reader->Read(&type)) == S_OK)
    {
        if (type == XmlNodeType_DocumentType)
        {
            *error = L"SVG_VECTOR_UNSUPPORTED_FEATURE: DTD is prohibited";
            return false;
        }
        if (type == XmlNodeType_Element)
        {
            const wchar_t* localName = nullptr;
            UINT localLength = 0;
            if (FAILED(reader->GetLocalName(&localName, &localLength))) { *error = L"SVG_VECTOR_INVALID_XML: element has no name"; return false; }
            auto node = std::make_unique<SvgNode>();
            node->name = Lower(std::wstring(localName, localLength));
            if (!IsAllowedElement(node->name))
            {
                *error = (IsExplicitlyUnsupported(node->name) ? L"SVG_VECTOR_UNSUPPORTED_FEATURE: " : L"SVG_VECTOR_UNSUPPORTED_FEATURE: unknown element ") + node->name;
                return false;
            }
            if (++nodeCount > kMaxNodes) { *error = L"SVG_VECTOR_LIMIT_EXCEEDED: too many XML nodes"; return false; }
            if (reader->MoveToFirstAttribute() == S_OK)
            {
                do
                {
                    const wchar_t* attributeName = nullptr;
                    const wchar_t* prefix = nullptr;
                    const wchar_t* attributeValue = nullptr;
                    UINT nameLength = 0, prefixLength = 0, valueLength = 0;
                    reader->GetLocalName(&attributeName, &nameLength);
                    reader->GetPrefix(&prefix, &prefixLength);
                    reader->GetValue(&attributeValue, &valueLength);
                    std::wstring key;
                    if (prefixLength != 0) key.assign(prefix, prefixLength), key.append(L":");
                    key.append(attributeName, nameLength);
                    node->attributes[Lower(key)] = std::wstring(attributeValue, valueLength);
                } while (reader->MoveToNextAttribute() == S_OK);
                reader->MoveToElement();
            }
            const BOOL empty = reader->IsEmptyElement();
            SvgNode* nodePointer = node.get();
            if (stack.empty())
            {
                if (*root != nullptr) { *error = L"SVG_VECTOR_INVALID_XML: multiple root elements"; return false; }
                *root = std::move(node);
            }
            else stack.back()->children.push_back(std::move(node));
            if (!empty) stack.push_back(nodePointer);
        }
        else if (type == XmlNodeType_EndElement)
        {
            if (stack.empty()) { *error = L"SVG_VECTOR_INVALID_XML: unmatched end element"; return false; }
            stack.pop_back();
        }
    }
    if (FAILED(hr)) { *error = L"SVG_VECTOR_INVALID_XML: XmlLite parse failure"; return false; }
    if (*root == nullptr || (*root)->name != L"svg") { *error = L"SVG_VECTOR_INVALID_XML: root element must be svg"; return false; }
    if (!stack.empty()) { *error = L"SVG_VECTOR_INVALID_XML: unclosed element"; return false; }
    return true;
}

bool IndexIds(SvgNode* node, std::map<std::wstring, SvgNode*>* ids, std::wstring* error)
{
    const std::wstring* id = Attribute(*node, L"id");
    if (id != nullptr && !id->empty())
    {
        if (!ids->emplace(*id, node).second) { *error = L"SVG_VECTOR_DUPLICATE_ID: duplicate id"; return false; }
    }
    for (auto& child : node->children) if (!IndexIds(child.get(), ids, error)) return false;
    return true;
}

bool BuildRootMatrix(const SvgNode& root, double outputWidth, double outputHeight,
                     Matrix* matrix, bool* requiresClip, std::wstring* error)
{
    const std::wstring* viewBoxText = Attribute(root, L"viewbox");
    if (viewBoxText == nullptr) { *error = L"SVG_VECTOR_INVALID_VIEWBOX: MathJax SVG requires viewBox"; return false; }
    bool success = false;
    const std::vector<double> values = ParseNumberList(*viewBoxText, &success);
    if (!success || values.size() != 4 || values[2] <= 0.0 || values[3] <= 0.0)
    {
        *error = L"SVG_VECTOR_INVALID_VIEWBOX: viewBox must contain four finite values and a positive size";
        return false;
    }
    const double scaleX = outputWidth / values[2];
    const double scaleY = outputHeight / values[3];
    const std::wstring preserve = Attribute(root, L"preserveaspectratio") == nullptr ? L"xmidymid meet" : Lower(*Attribute(root, L"preserveaspectratio"));
    if (preserve == L"none")
    {
        *matrix = {scaleX, 0.0, 0.0, scaleY, -values[0] * scaleX, -values[1] * scaleY};
        *requiresClip = false;
        return true;
    }
    const bool slice = preserve.find(L"slice") != std::wstring::npos;
    const double scale = slice ? (std::max)(scaleX, scaleY) : (std::min)(scaleX, scaleY);
    double offsetX = 0.0;
    double offsetY = 0.0;
    const double spareX = outputWidth - values[2] * scale;
    const double spareY = outputHeight - values[3] * scale;
    if (preserve.find(L"xmax") != std::wstring::npos) offsetX = spareX;
    else if (preserve.find(L"xmid") != std::wstring::npos || preserve.empty()) offsetX = spareX / 2.0;
    if (preserve.find(L"ymax") != std::wstring::npos) offsetY = spareY;
    else if (preserve.find(L"ymid") != std::wstring::npos || preserve.empty()) offsetY = spareY / 2.0;
    *matrix = {scale, 0.0, 0.0, scale, offsetX - values[0] * scale, offsetY - values[1] * scale};
    *requiresClip = slice;
    return true;
}

bool ReadEmfRecords(const std::vector<BYTE>& bytes, bool* raster, bool* vector, std::wstring* reason)
{
    *raster = false;
    *vector = false;
    if (bytes.size() < sizeof(ENHMETAHEADER) || bytes.size() > kMaxEmfBytes)
    {
        if (reason) *reason = L"EMF_INVALID: file size is outside safety limits";
        return false;
    }
    ENHMETAHEADER header{};
    std::memcpy(&header, bytes.data(), sizeof(header));
    if (header.dSignature != ENHMETA_SIGNATURE || header.nBytes != bytes.size() ||
        header.nRecords < 2 || header.nRecords > kMaxEmfRecords)
    {
        if (reason) *reason = L"EMF_INVALID: header size, signature, or record count is invalid";
        return false;
    }
    size_t offset = 0;
    size_t recordCount = 0;
    bool sawEof = false;
    while (offset + sizeof(EMR) <= bytes.size())
    {
        if (++recordCount > kMaxEmfRecords)
        {
            if (reason) *reason = L"EMF_INVALID: record count exceeds safety limit";
            return false;
        }
        EMR record{};
        std::memcpy(&record, bytes.data() + offset, sizeof(record));
        if (record.nSize < sizeof(EMR) || record.nSize > kMaxEmfRecordBytes ||
            record.nSize % 4 != 0 || record.nSize > bytes.size() - offset)
        {
            if (reason) *reason = L"EMF_INVALID: malformed record at offset " + std::to_wstring(offset) +
                L", type " + std::to_wstring(record.iType) + L", size " + std::to_wstring(record.nSize);
            return false;
        }
        switch (record.iType)
        {
        case EMR_BITBLT: case EMR_STRETCHBLT: case EMR_MASKBLT: case EMR_PLGBLT:
        case EMR_SETDIBITSTODEVICE: case EMR_STRETCHDIBITS: case EMR_ALPHABLEND: case EMR_TRANSPARENTBLT:
            *raster = true;
            if (reason) *reason = L"EMF_RASTER_RECORD: bitmap transfer record type " + std::to_wstring(record.iType);
            break;
        case EMR_STROKEPATH: case EMR_FILLPATH: case EMR_STROKEANDFILLPATH:
        case EMR_POLYBEZIER: case EMR_POLYBEZIERTO: case EMR_POLYGON: case EMR_POLYLINE:
        case EMR_POLYBEZIER16: case EMR_POLYBEZIERTO16: case EMR_POLYGON16: case EMR_POLYLINE16:
            *vector = true;
            break;
        case EMR_GDICOMMENT:
        {
            DWORD commentBytes = 0;
            constexpr size_t dataOffset = offsetof(EMRGDICOMMENT, Data);
            if (record.nSize < dataOffset) return false;
            std::memcpy(&commentBytes, bytes.data() + offset + offsetof(EMRGDICOMMENT, cbData), sizeof(commentBytes));
            if (commentBytes > record.nSize - dataOffset)
            {
                if (reason) *reason = L"EMF_INVALID: GDI comment length exceeds record";
                return false;
            }
            const BYTE* commentData = bytes.data() + offset + dataOffset;
            if (commentBytes >= 4 && commentData[0] == 'E' && commentData[1] == 'M' && commentData[2] == 'F' && commentData[3] == '+')
            {
                size_t commentOffset = 4;
                while (commentOffset + 12 <= commentBytes)
                {
                    const BYTE* data = commentData + commentOffset;
                    WORD type = 0;
                    WORD flags = 0;
                    DWORD size = 0;
                    std::memcpy(&type, data, sizeof(type));
                    std::memcpy(&flags, data + 2, sizeof(flags));
                    std::memcpy(&size, data + 4, sizeof(size));
                    if (size < 12 || size > commentBytes - commentOffset)
                    {
                        if (reason) *reason = L"EMF_INVALID: malformed EMF+ record";
                        return false;
                    }
                    if (type == 0x401A || type == 0x401B || (type == 0x4008 && ((flags >> 8) & 0x7F) == 5))
                    {
                        *raster = true;
                        if (reason) *reason = L"EMF_RASTER_RECORD: EMF+ image record";
                    }
                    if (type == 0x4014 || type == 0x4015) *vector = true;
                    commentOffset += size;
                }
            }
            break;
        }
        default:
            break;
        }
        offset += record.nSize;
        if (record.iType == EMR_EOF)
        {
            sawEof = true;
            break;
        }
    }
    if (!sawEof || offset != bytes.size() || recordCount != header.nRecords)
    {
        if (reason) *reason = L"EMF_INVALID: missing EOF, trailing data, or record count mismatch";
        return false;
    }
    return true;
}
}

bool ContainsRasterEmfRecords(const std::vector<BYTE>& emfBytes, std::wstring* reason)
{
    bool raster = false;
    bool vector = false;
    if (!ReadEmfRecords(emfBytes, &raster, &vector, reason)) return true;
    return raster;
}

bool ValidateEmfRecords(const std::vector<BYTE>& emfBytes, std::wstring* reason)
{
    bool raster = false;
    bool vector = false;
    return ReadEmfRecords(emfBytes, &raster, &vector, reason);
}

bool HasVectorDrawingEmfRecords(const std::vector<BYTE>& emfBytes, std::wstring* reason)
{
    bool raster = false;
    bool vector = false;
    if (!ReadEmfRecords(emfBytes, &raster, &vector, reason)) return false;
    if (!vector && reason != nullptr) *reason = L"EMF_VECTOR_RECORD_MISSING: no path, Bezier, polygon, or EMF+ path record";
    return vector;
}

SvgToEmfResult ConvertMathJaxSvgToVectorEmf(const std::wstring& svg, double widthPt, double heightPt, const std::wstring& currentColor)
{
    SvgToEmfResult result{};
    if (!std::isfinite(widthPt) || !std::isfinite(heightPt) || widthPt <= 0.0 || heightPt <= 0.0 || widthPt > 10000.0 || heightPt > 10000.0)
    {
        result.error = L"SVG_VECTOR_INVALID_SIZE: output point size is invalid";
        return result;
    }
    std::unique_ptr<SvgNode> root;
    if (!ParseXml(svg, &root, &result.error)) return result;
    RenderContext context{};
    if (!IndexIds(root.get(), &context.ids, &result.error)) return result;
    // MathJax's layout width can be slightly tighter than the actual glyph
    // outlines (italic overhangs, integral signs, accents, rule endpoints, etc.).
    // Add a small transparent safety margin so Office does not clip those paths.
    const double paddingXPt = std::clamp(widthPt * 0.02, 1.5, 4.0);
    const double paddingYPt = std::clamp(heightPt * 0.08, 1.0, 3.0);
    const double canvasWidthPt = widthPt + paddingXPt * 2.0;
    const double canvasHeightPt = heightPt + paddingYPt * 2.0;

    const int contentWidthLogical = (std::max)(
        1,
        static_cast<int>(std::lround(widthPt * kLogicalUnitsPerInch / kPointsPerInch)));
    const int contentHeightLogical = (std::max)(
        1,
        static_cast<int>(std::lround(heightPt * kLogicalUnitsPerInch / kPointsPerInch)));
    const int paddingXLogical = static_cast<int>(
        std::lround(paddingXPt * kLogicalUnitsPerInch / kPointsPerInch));
    const int paddingYLogical = static_cast<int>(
        std::lround(paddingYPt * kLogicalUnitsPerInch / kPointsPerInch));
    const int canvasWidthLogical = contentWidthLogical + paddingXLogical * 2;
    const int canvasHeightLogical = contentHeightLogical + paddingYLogical * 2;

    Matrix rootMatrix{};
    bool requiresClip = false;
    if (!BuildRootMatrix(
            *root,
            contentWidthLogical,
            contentHeightLogical,
            &rootMatrix,
            &requiresClip,
            &result.error))
    {
        return result;
    }

    // Keep the original SVG scaling, then translate the whole formula into the
    // padded canvas. No background rectangle is drawn, so the margin stays transparent.
    rootMatrix.e += paddingXLogical;
    rootMatrix.f += paddingYLogical;

    RECT frame{};
    frame.right = static_cast<LONG>(
        std::lround(canvasWidthPt * kHimetricPerInch / kPointsPerInch));
    frame.bottom = static_cast<LONG>(
        std::lround(canvasHeightPt * kHimetricPerInch / kPointsPerInch));

    HDC reference = GetDC(nullptr);
    if (reference == nullptr) { result.error = L"SVG_VECTOR_GDI_ERROR: GetDC failed"; return result; }

    // Use the reference DC's actual DPI, not a hardcoded value, to ensure
    // the EMF frame and drawing bounds are consistent.
    const int dpiX = GetDeviceCaps(reference, LOGPIXELSX);
    const int dpiY = GetDeviceCaps(reference, LOGPIXELSY);
    if (dpiX <= 0 || dpiY <= 0)
    {
        ReleaseDC(nullptr, reference);
        result.error = L"SVG_VECTOR_GDI_ERROR: invalid reference DPI";
        return result;
    }

    // frame is in 0.01 mm; 1 inch = 2540 hundredths of mm.
    const int canvasWidthDevice = (std::max)(1, MulDiv(frame.right, dpiX, 2540));
    const int canvasHeightDevice = (std::max)(1, MulDiv(frame.bottom, dpiY, 2540));

    HDC metafileDc = CreateEnhMetaFileW(reference, nullptr, &frame, L"LaTeXSnipper\0MathJax SVG vector formula\0");
    ReleaseDC(nullptr, reference);
    if (metafileDc == nullptr) { result.error = L"SVG_VECTOR_GDI_ERROR: CreateEnhMetaFile failed"; return result; }
    context.dc = metafileDc;
    if (SetMapMode(metafileDc, MM_ANISOTROPIC) == 0 ||
        !SetWindowExtEx(metafileDc, canvasWidthLogical, canvasHeightLogical, nullptr) ||
        !SetViewportExtEx(metafileDc, canvasWidthDevice, canvasHeightDevice, nullptr) ||
        SetBkMode(metafileDc, TRANSPARENT) == 0)
    {
        HENHMETAFILE failed = CloseEnhMetaFile(metafileDc);
        if (failed != nullptr) DeleteEnhMetaFile(failed);
        result.error = L"SVG_VECTOR_GDI_ERROR: anisotropic mapping setup failed";
        return result;
    }
    if (requiresClip &&
        IntersectClipRect(
            metafileDc,
            paddingXLogical,
            paddingYLogical,
            paddingXLogical + contentWidthLogical,
            paddingYLogical + contentHeightLogical) == ERROR)
    {
        HENHMETAFILE failed = CloseEnhMetaFile(metafileDc);
        if (failed != nullptr) DeleteEnhMetaFile(failed);
        result.error = L"SVG_VECTOR_GDI_ERROR: slice clip setup failed";
        return result;
    }

    Style style{};
    Paint fallback{};
    if (!currentColor.empty() && ParseColor(currentColor, &fallback) && fallback.kind == PaintKind::Color) style.currentColor = fallback.color;
    else style.currentColor = {0, 0, 0, 255};
    std::set<std::wstring> useStack;
    const bool rendered = RenderNode(&context, *root, rootMatrix, style, &useStack, 0, false);
    HENHMETAFILE metafile = CloseEnhMetaFile(metafileDc);
    if (!rendered || metafile == nullptr)
    {
        if (metafile != nullptr) DeleteEnhMetaFile(metafile);
        result.error = context.error.empty() ? L"SVG_VECTOR_GDI_ERROR: CloseEnhMetaFile failed" : context.error;
        return result;
    }
    const UINT byteCount = GetEnhMetaFileBits(metafile, 0, nullptr);
    if (byteCount != 0)
    {
        result.emfBytes.resize(byteCount);
        if (GetEnhMetaFileBits(metafile, byteCount, result.emfBytes.data()) != byteCount) result.emfBytes.clear();
    }
    DeleteEnhMetaFile(metafile);
    if (result.emfBytes.empty()) { result.error = L"SVG_VECTOR_GDI_ERROR: generated EMF is empty"; return result; }
    std::wstring validationReason;
    result.containsRasterRecords = ContainsRasterEmfRecords(result.emfBytes, &validationReason);
    if (result.containsRasterRecords) { result.error = validationReason; result.emfBytes.clear(); return result; }
    if (context.vectorDrawCount == 0 || !HasVectorDrawingEmfRecords(result.emfBytes, &validationReason))
    {
        result.error = validationReason.empty() ? L"EMF_VECTOR_RECORD_MISSING: SVG rendered no visible vector paths" : validationReason;
        result.emfBytes.clear();
        return result;
    }
    result.himetricSize = {frame.right, frame.bottom};
    result.success = true;
    return result;
}

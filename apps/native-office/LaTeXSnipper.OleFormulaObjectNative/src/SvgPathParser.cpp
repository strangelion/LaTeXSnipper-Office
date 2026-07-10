#include "SvgPathParser.h"

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cwchar>
#include <cwctype>
#include <limits>

namespace
{
constexpr size_t kMaxPathCommands = 1000000;
constexpr double kMaxCoordinateMagnitude = 1.0e9;
constexpr double kPi = 3.1415926535897932384626433832795;

bool IsFiniteCoordinate(double value)
{
    return std::isfinite(value) && std::abs(value) <= kMaxCoordinateMagnitude;
}

SvgPoint Add(SvgPoint left, SvgPoint right)
{
    return {left.x + right.x, left.y + right.y};
}

class Parser
{
public:
    explicit Parser(const std::wstring& input) : input_(input) {}

    SvgPathParseResult Parse()
    {
        SvgPathParseResult result{};
        SkipSeparators();
        if (position_ == input_.size())
        {
            result.error = L"SVG_PATH_EMPTY: path data is empty";
            return result;
        }

        wchar_t command = 0;
        while (position_ < input_.size())
        {
            SkipSeparators();
            if (position_ >= input_.size())
            {
                break;
            }

            if (std::iswalpha(input_[position_]))
            {
                command = input_[position_++];
            }
            else if (command == 0 || command == L'Z' || command == L'z')
            {
                return Fail(L"SVG_PATH_INVALID_COMMAND: expected a path command");
            }

            const size_t before = position_;
            if (!ParseCommand(command))
            {
                return Fail(error_);
            }
            if (position_ == before && command != L'Z' && command != L'z')
            {
                return Fail(L"SVG_PATH_NO_PROGRESS: path parser made no progress");
            }
            SkipSeparators();
        }

        result.success = !operations_.empty();
        result.operations = std::move(operations_);
        result.commandCount = commandCount_;
        if (!result.success)
        {
            result.error = L"SVG_PATH_EMPTY: path contains no drawing operations";
        }
        return result;
    }

private:
    SvgPathParseResult Fail(const std::wstring& error)
    {
        SvgPathParseResult result{};
        result.error = error;
        result.commandCount = commandCount_;
        return result;
    }

    void SkipSeparators()
    {
        while (position_ < input_.size())
        {
            const wchar_t ch = input_[position_];
            if (ch == L',' || std::iswspace(ch))
            {
                ++position_;
                continue;
            }
            break;
        }
    }

    bool HasNumber()
    {
        SkipSeparators();
        if (position_ >= input_.size())
        {
            return false;
        }
        const wchar_t ch = input_[position_];
        return ch == L'+' || ch == L'-' || ch == L'.' || (ch >= L'0' && ch <= L'9');
    }

    bool ReadNumber(double* value)
    {
        SkipSeparators();
        if (position_ >= input_.size())
        {
            error_ = L"SVG_PATH_INCOMPLETE: expected a number";
            return false;
        }

        const wchar_t* start = input_.c_str() + position_;
        wchar_t* end = nullptr;
        errno = 0;
        const double parsed = std::wcstod(start, &end);
        if (end == start || errno == ERANGE || !IsFiniteCoordinate(parsed))
        {
            error_ = L"SVG_PATH_INVALID_NUMBER: coordinate is invalid or out of range";
            return false;
        }
        position_ += static_cast<size_t>(end - start);
        *value = parsed;
        return true;
    }

    bool ReadPoint(bool relative, SvgPoint* point)
    {
        SvgPoint parsed{};
        if (!ReadNumber(&parsed.x) || !ReadNumber(&parsed.y))
        {
            return false;
        }
        if (relative)
        {
            parsed = Add(current_, parsed);
        }
        if (!IsFiniteCoordinate(parsed.x) || !IsFiniteCoordinate(parsed.y))
        {
            error_ = L"SVG_PATH_INVALID_NUMBER: resolved coordinate is out of range";
            return false;
        }
        *point = parsed;
        return true;
    }

    bool AddOperation(const SvgPathOperation& operation)
    {
        if (++commandCount_ > kMaxPathCommands)
        {
            error_ = L"SVG_PATH_LIMIT_EXCEEDED: too many path commands";
            return false;
        }
        operations_.push_back(operation);
        return true;
    }

    bool MoveTo(SvgPoint point)
    {
        SvgPathOperation operation{};
        operation.type = SvgPathOperationType::MoveTo;
        operation.points[0] = point;
        if (!AddOperation(operation)) return false;
        current_ = point;
        subpathStart_ = point;
        return true;
    }

    bool LineTo(SvgPoint point)
    {
        SvgPathOperation operation{};
        operation.type = SvgPathOperationType::LineTo;
        operation.points[0] = point;
        if (!AddOperation(operation)) return false;
        current_ = point;
        return true;
    }

    bool CubicTo(SvgPoint control1, SvgPoint control2, SvgPoint end)
    {
        SvgPathOperation operation{};
        operation.type = SvgPathOperationType::CubicTo;
        operation.points = {control1, control2, end};
        if (!AddOperation(operation)) return false;
        current_ = end;
        lastCubicControl_ = control2;
        return true;
    }

    bool ClosePath()
    {
        SvgPathOperation operation{};
        operation.type = SvgPathOperationType::Close;
        if (!AddOperation(operation)) return false;
        current_ = subpathStart_;
        previousCommand_ = L'Z';
        return true;
    }

    SvgPoint Reflect(SvgPoint control) const
    {
        return {2.0 * current_.x - control.x, 2.0 * current_.y - control.y};
    }

    bool ArcTo(double rx, double ry, double rotationDegrees, bool largeArc, bool sweep, SvgPoint end)
    {
        rx = std::abs(rx);
        ry = std::abs(ry);
        if (rx == 0.0 || ry == 0.0 || (end.x == current_.x && end.y == current_.y))
        {
            return end.x == current_.x && end.y == current_.y ? true : LineTo(end);
        }

        const double phi = std::fmod(rotationDegrees, 360.0) * kPi / 180.0;
        const double cosPhi = std::cos(phi);
        const double sinPhi = std::sin(phi);
        const double dx = (current_.x - end.x) / 2.0;
        const double dy = (current_.y - end.y) / 2.0;
        const double x1p = cosPhi * dx + sinPhi * dy;
        const double y1p = -sinPhi * dx + cosPhi * dy;

        double lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
        if (lambda > 1.0)
        {
            const double scale = std::sqrt(lambda);
            rx *= scale;
            ry *= scale;
        }

        const double rx2 = rx * rx;
        const double ry2 = ry * ry;
        const double x1p2 = x1p * x1p;
        const double y1p2 = y1p * y1p;
        const double denominator = rx2 * y1p2 + ry2 * x1p2;
        double factor = 0.0;
        if (denominator > std::numeric_limits<double>::epsilon())
        {
            const double numerator = (std::max)(0.0, rx2 * ry2 - denominator);
            factor = std::sqrt(numerator / denominator);
            if (largeArc == sweep) factor = -factor;
        }

        const double cxp = factor * (rx * y1p / ry);
        const double cyp = factor * (-ry * x1p / rx);
        const double centerX = cosPhi * cxp - sinPhi * cyp + (current_.x + end.x) / 2.0;
        const double centerY = sinPhi * cxp + cosPhi * cyp + (current_.y + end.y) / 2.0;

        auto vectorAngle = [](double ux, double uy, double vx, double vy) {
            const double dot = ux * vx + uy * vy;
            const double determinant = ux * vy - uy * vx;
            return std::atan2(determinant, dot);
        };

        const double ux = (x1p - cxp) / rx;
        const double uy = (y1p - cyp) / ry;
        const double vx = (-x1p - cxp) / rx;
        const double vy = (-y1p - cyp) / ry;
        double startAngle = vectorAngle(1.0, 0.0, ux, uy);
        double deltaAngle = vectorAngle(ux, uy, vx, vy);
        if (!sweep && deltaAngle > 0.0) deltaAngle -= 2.0 * kPi;
        if (sweep && deltaAngle < 0.0) deltaAngle += 2.0 * kPi;

        const int segments = (std::max)(1, static_cast<int>(std::ceil(std::abs(deltaAngle) / (kPi / 2.0))));
        const double step = deltaAngle / segments;
        auto mapUnit = [&](double x, double y) -> SvgPoint {
            return {
                centerX + rx * cosPhi * x - ry * sinPhi * y,
                centerY + rx * sinPhi * x + ry * cosPhi * y
            };
        };

        for (int index = 0; index < segments; ++index)
        {
            const double a0 = startAngle + index * step;
            const double a1 = a0 + step;
            const double alpha = 4.0 / 3.0 * std::tan((a1 - a0) / 4.0);
            const double cos0 = std::cos(a0);
            const double sin0 = std::sin(a0);
            const double cos1 = std::cos(a1);
            const double sin1 = std::sin(a1);
            SvgPoint c1 = mapUnit(cos0 - alpha * sin0, sin0 + alpha * cos0);
            SvgPoint c2 = mapUnit(cos1 + alpha * sin1, sin1 - alpha * cos1);
            SvgPoint target = index + 1 == segments ? end : mapUnit(cos1, sin1);
            if (!CubicTo(c1, c2, target)) return false;
        }
        return true;
    }

    bool ParseCommand(wchar_t command)
    {
        const bool relative = std::iswlower(command) != 0;
        const wchar_t upper = static_cast<wchar_t>(std::towupper(command));
        if (upper == L'Z')
        {
            if (!ClosePath()) return false;
            return true;
        }

        bool parsedAny = false;
        bool firstMove = true;
        while (HasNumber())
        {
            parsedAny = true;
            switch (upper)
            {
            case L'M':
            {
                SvgPoint point{};
                if (!ReadPoint(relative, &point)) return false;
                if (firstMove)
                {
                    if (!MoveTo(point)) return false;
                    firstMove = false;
                }
                else if (!LineTo(point)) return false;
                break;
            }
            case L'L':
            {
                SvgPoint point{};
                if (!ReadPoint(relative, &point) || !LineTo(point)) return false;
                break;
            }
            case L'H':
            {
                double x = 0.0;
                if (!ReadNumber(&x)) return false;
                SvgPoint point = current_;
                point.x = relative ? current_.x + x : x;
                if (!IsFiniteCoordinate(point.x) || !LineTo(point)) return false;
                break;
            }
            case L'V':
            {
                double y = 0.0;
                if (!ReadNumber(&y)) return false;
                SvgPoint point = current_;
                point.y = relative ? current_.y + y : y;
                if (!IsFiniteCoordinate(point.y) || !LineTo(point)) return false;
                break;
            }
            case L'C':
            {
                SvgPoint c1{}, c2{}, end{};
                if (!ReadPoint(relative, &c1) || !ReadPoint(relative, &c2) || !ReadPoint(relative, &end)) return false;
                if (!CubicTo(c1, c2, end)) return false;
                break;
            }
            case L'S':
            {
                SvgPoint c2{}, end{};
                SvgPoint c1 = previousCommand_ == L'C' || previousCommand_ == L'S' ? Reflect(lastCubicControl_) : current_;
                if (!ReadPoint(relative, &c2) || !ReadPoint(relative, &end) || !CubicTo(c1, c2, end)) return false;
                break;
            }
            case L'Q':
            {
                SvgPoint control{}, end{};
                if (!ReadPoint(relative, &control) || !ReadPoint(relative, &end)) return false;
                const SvgPoint c1{current_.x + (control.x - current_.x) * 2.0 / 3.0,
                                  current_.y + (control.y - current_.y) * 2.0 / 3.0};
                const SvgPoint c2{end.x + (control.x - end.x) * 2.0 / 3.0,
                                  end.y + (control.y - end.y) * 2.0 / 3.0};
                if (!CubicTo(c1, c2, end)) return false;
                lastQuadraticControl_ = control;
                break;
            }
            case L'T':
            {
                SvgPoint end{};
                if (!ReadPoint(relative, &end)) return false;
                SvgPoint control = previousCommand_ == L'Q' || previousCommand_ == L'T' ? Reflect(lastQuadraticControl_) : current_;
                const SvgPoint c1{current_.x + (control.x - current_.x) * 2.0 / 3.0,
                                  current_.y + (control.y - current_.y) * 2.0 / 3.0};
                const SvgPoint c2{end.x + (control.x - end.x) * 2.0 / 3.0,
                                  end.y + (control.y - end.y) * 2.0 / 3.0};
                if (!CubicTo(c1, c2, end)) return false;
                lastQuadraticControl_ = control;
                break;
            }
            case L'A':
            {
                double rx = 0.0, ry = 0.0, rotation = 0.0, large = 0.0, sweep = 0.0;
                SvgPoint end{};
                if (!ReadNumber(&rx) || !ReadNumber(&ry) || !ReadNumber(&rotation) ||
                    !ReadNumber(&large) || !ReadNumber(&sweep) || !ReadPoint(relative, &end)) return false;
                if (!((large == 0.0 || large == 1.0) && (sweep == 0.0 || sweep == 1.0)))
                {
                    error_ = L"SVG_PATH_INVALID_ARC_FLAG: arc flags must be 0 or 1";
                    return false;
                }
                if (!ArcTo(rx, ry, rotation, large == 1.0, sweep == 1.0, end)) return false;
                break;
            }
            default:
                error_ = L"SVG_PATH_UNSUPPORTED_COMMAND: unsupported path command";
                return false;
            }

            previousCommand_ = upper;
            SkipSeparators();
            if (position_ < input_.size() && std::iswalpha(input_[position_])) break;
        }

        if (!parsedAny)
        {
            error_ = L"SVG_PATH_INCOMPLETE: command has no coordinate data";
            return false;
        }
        return true;
    }

    const std::wstring& input_;
    size_t position_ = 0;
    size_t commandCount_ = 0;
    SvgPoint current_{};
    SvgPoint subpathStart_{};
    SvgPoint lastCubicControl_{};
    SvgPoint lastQuadraticControl_{};
    wchar_t previousCommand_ = 0;
    std::vector<SvgPathOperation> operations_;
    std::wstring error_;
};
}

SvgPathParseResult ParseSvgPathData(const std::wstring& pathData)
{
    return Parser(pathData).Parse();
}

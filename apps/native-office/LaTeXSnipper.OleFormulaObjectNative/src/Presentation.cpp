#include "Presentation.h"
#include "JsonHelper.h"

#include "OleFormulaIds.h"
#include "Win32Check.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <mutex>
#include <objidl.h>
#include <shlwapi.h>
#include <gdiplus.h>

namespace
{
constexpr int kDefaultWidthPoints = 180;
constexpr int kDefaultHeightPoints = 42;
constexpr int kPointsPerInch = 72;
constexpr int kHimetricPerInch = 2540;
constexpr int kEmfDpi = 144;

// P1-8: Lazy GDI+ initialization — avoids calling GdiplusStartup inside DllMain
// where the loader lock is held, which can cause Office startup deadlocks.
extern ULONG_PTR g_gdiplusToken;

std::once_flag g_gdiplusInitFlag;

void EnsureGdiplusInitialized()
{
    std::call_once(g_gdiplusInitFlag, []() {
        if (g_gdiplusToken == 0)
        {
            Gdiplus::GdiplusStartupInput gdiInput;
            Gdiplus::GdiplusStartup(&g_gdiplusToken, &gdiInput, nullptr);
        }
    });
}

int PointsToHimetric(int points)
{
    return MulDiv(points, kHimetricPerInch, kPointsPerInch);
}

int PointsToHimetric(double points)
{
    return static_cast<int>(std::lround(points * kHimetricPerInch / kPointsPerInch));
}

int PointsToPixels(int points)
{
    return (std::max)(1, MulDiv(points, kEmfDpi, kPointsPerInch));
}

RECT BuildFrameRect(int widthPixels, int heightPixels)
{
    RECT rect{};
    rect.left = 0;
    rect.top = 0;
    rect.right = widthPixels;
    rect.bottom = heightPixels;
    return rect;
}

RECT BuildFrameRectHimetric(int widthPoints, int heightPoints)
{
    RECT rect{};
    rect.left = 0;
    rect.top = 0;
    rect.right = PointsToHimetric(widthPoints);
    rect.bottom = PointsToHimetric(heightPoints);
    return rect;
}

void DrawFormulaText(HDC hdc, RECT bounds, const std::wstring& latex)
{
    SetBkMode(hdc, TRANSPARENT);
    SetTextColor(hdc, RGB(0, 0, 0));

    LOGFONTW logFont{};
    logFont.lfHeight = -MulDiv(18, GetDeviceCaps(hdc, LOGPIXELSY), kPointsPerInch);
    logFont.lfWeight = FW_NORMAL;
    wcscpy_s(logFont.lfFaceName, L"Cambria Math");

    HFONT font = CreateFontIndirectW(&logFont);
    HFONT oldFont = font == nullptr ? nullptr : static_cast<HFONT>(SelectObject(hdc, font));

    std::wstring text = latex.empty() ? L"e^{i\\pi}+1=0" : latex;
    DrawTextW(hdc, text.c_str(), static_cast<int>(text.size()), &bounds, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);

    if (oldFont != nullptr)
    {
        SelectObject(hdc, oldFont);
    }

    if (font != nullptr)
    {
        DeleteObject(font);
    }
}

} // anonymous namespace

std::wstring ExtractJsonString(const std::wstring& json, const std::wstring& propertyName)
{
    const std::wstring marker = L"\"" + propertyName + L"\"";
    size_t property = json.find(marker);
    if (property == std::wstring::npos)
    {
        return L"";
    }

    size_t colon = json.find(L':', property + marker.size());
    if (colon == std::wstring::npos)
    {
        return L"";
    }

    size_t start = json.find(L'"', colon + 1);
    if (start == std::wstring::npos)
    {
        return L"";
    }

    std::wstring value;
    bool escaped = false;
    for (size_t i = start + 1; i < json.size(); ++i)
    {
        wchar_t ch = json[i];
        if (escaped)
        {
            switch (ch)
            {
            case L'"':
            case L'\\':
            case L'/':
                value.push_back(ch);
                break;
            case L'n':
                value.push_back(L'\n');
                break;
            case L'r':
                value.push_back(L'\r');
                break;
            case L't':
                value.push_back(L'\t');
                break;
            default:
                value.push_back(ch);
                break;
            }
            escaped = false;
            continue;
        }

        if (ch == L'\\')
        {
            escaped = true;
            continue;
        }

        if (ch == L'"')
        {
            break;
        }

        value.push_back(ch);
    }

    return value;
}

double ExtractJsonNumber(const std::wstring& json, const std::wstring& propertyName)
{
    // Find property key directly (handles both flat and nested JSON)
    const std::wstring marker = L"\"" + propertyName + L"\"";
    size_t property = json.find(marker);
    if (property == std::wstring::npos)
    {
        return 0;
    }

    size_t colon = json.find(L':', property + marker.size());
    if (colon == std::wstring::npos)
    {
        return 0;
    }

    // Skip whitespace after colon
    size_t start = colon + 1;
    while (start < json.size() && (json[start] == L' ' || json[start] == L'\t' || json[start] == L'\n' || json[start] == L'\r'))
    {
        ++start;
    }

    if (start >= json.size())
    {
        return 0;
    }

    // Check if the value is a number (digit, minus, or plus)
    if (json[start] == L'-' || json[start] == L'+' || (json[start] >= L'0' && json[start] <= L'9'))
    {
        wchar_t* end = nullptr;
        double value = wcstod(json.c_str() + start, &end);
        return end == json.c_str() + start ? 0 : value;
    }

    // Fallback to quoted string extraction (for backward compatibility)
    std::wstring text = ExtractJsonString(json, propertyName);
    if (text.empty())
    {
        return 0;
    }

    wchar_t* end = nullptr;
    double value = wcstod(text.c_str(), &end);
    return end == text.c_str() ? 0 : value;
}

int DecodeBase64Char(wchar_t ch)
{
    if (ch >= L'A' && ch <= L'Z')
    {
        return static_cast<int>(ch - L'A');
    }

    if (ch >= L'a' && ch <= L'z')
    {
        return static_cast<int>(ch - L'a') + 26;
    }

    if (ch >= L'0' && ch <= L'9')
    {
        return static_cast<int>(ch - L'0') + 52;
    }

    if (ch == L'+')
    {
        return 62;
    }

    if (ch == L'/')
    {
        return 63;
    }

    return -1;
}

std::vector<BYTE> DecodeBase64(const std::wstring& value)
{
    std::vector<BYTE> bytes;
    int buffer = 0;
    int bits = -8;
    for (wchar_t ch : value)
    {
        if (ch == L'=')
        {
            break;
        }

        int decoded = DecodeBase64Char(ch);
        if (decoded < 0)
        {
            continue;
        }

        buffer = (buffer << 6) | decoded;
        bits += 6;
        if (bits >= 0)
        {
            bytes.push_back(static_cast<BYTE>((buffer >> bits) & 0xFF));
            bits -= 8;
        }
    }

    return bytes;
}

void ApplyPayloadSize(const std::wstring& payloadJson, FormulaPresentation* presentation)
{
    // Search for leaf keys directly — works for nested JSON like {"render":{"widthPt":120}}
    double widthPoints = ExtractJsonNumber(payloadJson, L"widthPt");
    double heightPoints = ExtractJsonNumber(payloadJson, L"heightPt");
    // Fallback to old field names for backward compatibility
    if (widthPoints <= 0) widthPoints = ExtractJsonNumber(payloadJson, L"widthPoints");
    if (heightPoints <= 0) heightPoints = ExtractJsonNumber(payloadJson, L"heightPoints");
    if (widthPoints > 0 && heightPoints > 0)
    {
        presentation->himetricSize = {PointsToHimetric(widthPoints), PointsToHimetric(heightPoints)};
    }
}

FormulaPresentation CreatePlaceholderPresentation(const std::wstring& latex)
{
    FormulaPresentation presentation{};
    presentation.latex = latex.empty() ? L"e^{i\\pi}+1=0" : latex;
    presentation.payloadJson = L"";
    presentation.himetricSize = {PointsToHimetric(kDefaultWidthPoints), PointsToHimetric(kDefaultHeightPoints)};

    HDC screen = GetDC(nullptr);
    RECT frameHimetric = BuildFrameRectHimetric(kDefaultWidthPoints, kDefaultHeightPoints);
    HDC metafileDc = CreateEnhMetaFileW(screen, nullptr, &frameHimetric, L"LaTeXSnipper\0Formula\0");
    ReleaseDC(nullptr, screen);
    if (metafileDc == nullptr)
    {
        return presentation;
    }

    RECT bounds = BuildFrameRect(PointsToPixels(kDefaultWidthPoints), PointsToPixels(kDefaultHeightPoints));
    DrawFormulaText(metafileDc, bounds, presentation.latex);

    HENHMETAFILE metafile = CloseEnhMetaFile(metafileDc);
    if (metafile == nullptr)
    {
        return presentation;
    }

    UINT byteCount = GetEnhMetaFileBits(metafile, 0, nullptr);
    if (byteCount > 0)
    {
        presentation.enhancedMetafile.resize(byteCount);
        GetEnhMetaFileBits(metafile, byteCount, presentation.enhancedMetafile.data());
    }

    DeleteEnhMetaFile(metafile);
    return presentation;
}

FormulaPresentation CreatePresentationFromPayload(const std::wstring& payloadJson)
{
    std::wstring latex = JsonReadString(payloadJson, L"latex");
    FormulaPresentation presentation{};
    presentation.latex = latex.empty() ? kFormulaDefaultLatex : latex;
    presentation.payloadJson = payloadJson;
    presentation.himetricSize = {PointsToHimetric(kDefaultWidthPoints), PointsToHimetric(kDefaultHeightPoints)};
    ApplyPayloadSize(payloadJson, &presentation);

    // Try emfBase64 from presentation.emfBase64 (v3 canonical path)
    std::wstring emfBase64 = JsonReadNestedString(payloadJson, L"presentation", L"emfBase64");
    if (emfBase64.empty())
    {
        // Fallback: flat search for emfBase64
        emfBase64 = ExtractJsonString(payloadJson, L"emfBase64");
    }
    std::vector<BYTE> emfFromPresentation = DecodeBase64(emfBase64);
    if (!emfFromPresentation.empty() && HasValidEmf(emfFromPresentation))
    {
        presentation.enhancedMetafile = std::move(emfFromPresentation);
        return presentation;
    }

    // Legacy: presentationPayloadBase64
    std::vector<BYTE> payloadPresentation = DecodeBase64(ExtractJsonString(payloadJson, L"presentationPayloadBase64"));
    if (!payloadPresentation.empty())
    {
        if (HasValidEmf(payloadPresentation))
        {
            presentation.enhancedMetafile = std::move(payloadPresentation);
            return presentation;
        }
    }

    // No valid EMF found — try to generate EMF from render.png
    FormulaPresentation pngPres = CreatePresentationFromPayloadPng(payloadJson);
    if (!pngPres.enhancedMetafile.empty())
    {
        return pngPres;
    }

    // No EMF and no PNG — return empty presentation (no raw LaTeX fallback).
    // The caller should check enhancedMetafile.empty() and reject OLE insertion.
    return presentation;
}

FormulaPresentation CreatePresentationFromPayloadWithoutRendering(const std::wstring& payloadJson)
{
    std::wstring latex = ExtractJsonString(payloadJson, L"latex");
    FormulaPresentation presentation{};
    presentation.latex = latex.empty() ? kFormulaDefaultLatex : latex;
    presentation.payloadJson = payloadJson;
    presentation.himetricSize = {PointsToHimetric(kDefaultWidthPoints), PointsToHimetric(kDefaultHeightPoints)};
    ApplyPayloadSize(payloadJson, &presentation);

    // Try emfBase64 (new v3 field)
    std::vector<BYTE> emfFromPresentation = DecodeBase64(ExtractJsonString(payloadJson, L"emfBase64"));
    if (!emfFromPresentation.empty())
    {
        presentation.enhancedMetafile = std::move(emfFromPresentation);
        return presentation;
    }

    // Legacy: presentationPayloadBase64
    std::vector<BYTE> payloadPresentation = DecodeBase64(ExtractJsonString(payloadJson, L"presentationPayloadBase64"));
    if (!payloadPresentation.empty())
    {
        presentation.enhancedMetafile = std::move(payloadPresentation);
        return presentation;
    }

    // Try PNG fallback
    FormulaPresentation pngPres = CreatePresentationFromPayloadPng(payloadJson);
    if (!pngPres.enhancedMetafile.empty())
    {
        return pngPres;
    }

    return presentation;
}

HENHMETAFILE CopyEnhMetaFileFromBytes(const std::vector<BYTE>& bytes)
{
    if (bytes.empty())
    {
        return nullptr;
    }

    return SetEnhMetaFileBits(static_cast<UINT>(bytes.size()), bytes.data());
}

bool HasValidEmf(const std::vector<BYTE>& bytes)
{
    if (bytes.empty())
    {
        return false;
    }

    HENHMETAFILE emf = SetEnhMetaFileBits(static_cast<UINT>(bytes.size()), bytes.data());
    if (emf == nullptr)
    {
        return false;
    }

    // Validate EMF header
    ENHMETAHEADER header{};
    bool valid = GetEnhMetaFileHeader(emf, sizeof(header), &header) != 0;
    DeleteEnhMetaFile(emf);
    return valid;
}

FormulaPresentation CreatePresentationFromPayloadPng(const std::wstring& payloadJson)
{
    FormulaPresentation presentation{};
    presentation.payloadJson = payloadJson;

    // P1-8: Ensure GDI+ is initialized before any GDI+ calls
    EnsureGdiplusInitialized();

    // Get size from payload (try nested render.widthPt first, then flat widthPt)
    double widthPoints = JsonReadNestedString(payloadJson, L"render", L"widthPt").empty()
        ? ExtractJsonNumber(payloadJson, L"widthPt")
        : std::stod(JsonReadNestedString(payloadJson, L"render", L"widthPt"));
    double heightPoints = JsonReadNestedString(payloadJson, L"render", L"heightPt").empty()
        ? ExtractJsonNumber(payloadJson, L"heightPt")
        : std::stod(JsonReadNestedString(payloadJson, L"render", L"heightPt"));
    if (widthPoints <= 0) widthPoints = 180;
    if (heightPoints <= 0) heightPoints = 42;

    // Try render.png first, then render.svg → we need PNG for GDI bitmap
    std::wstring pngBase64 = ExtractJsonString(payloadJson, L"png");
    if (pngBase64.empty())
    {
        // Fallback: nested render.png
        pngBase64 = JsonReadNestedString(payloadJson, L"render", L"png");
    }
    if (pngBase64.empty()) return presentation;

    std::vector<BYTE> pngBytes = DecodeBase64(pngBase64);
    if (pngBytes.empty()) return presentation;

    // Wrap PNG bytes in an IStream for GDI+ to read
    HGLOBAL hGlobal = GlobalAlloc(GMEM_MOVEABLE, pngBytes.size());
    if (hGlobal == nullptr) return presentation;
    void* locked = GlobalLock(hGlobal);
    if (locked == nullptr) { GlobalFree(hGlobal); return presentation; }
    CopyMemory(locked, pngBytes.data(), pngBytes.size());
    GlobalUnlock(hGlobal);

    IStream* stream = nullptr;
    HRESULT hr = CreateStreamOnHGlobal(hGlobal, TRUE, &stream);
    if (FAILED(hr)) { GlobalFree(hGlobal); return presentation; }

    // Decode PNG via GDI+
    Gdiplus::Bitmap bitmap(stream);
    stream->Release();  // HGLOBAL now owned by GDI+ bitmap
    if (bitmap.GetLastStatus() != Gdiplus::Ok) return presentation;

    // Create a metafile DC to render the bitmap into
    HDC screenDc = GetDC(nullptr);
    int dpiX = GetDeviceCaps(screenDc, LOGPIXELSX);
    int dpiY = GetDeviceCaps(screenDc, LOGPIXELSY);
    int widthPx = static_cast<int>(widthPoints * dpiX / 72.0);
    int heightPx = static_cast<int>(heightPoints * dpiY / 72.0);
    if (widthPx < 1) widthPx = 1;
    if (heightPx < 1) heightPx = 1;

    RECT frame01mm = {
        0, 0,
        PointsToHimetric(widthPoints),
        PointsToHimetric(heightPoints)
    };
    HDC metaDc = CreateEnhMetaFileW(screenDc, nullptr, &frame01mm,
                                     L"LaTeXSnipper\0Formula\0");
    ReleaseDC(nullptr, screenDc);

    if (metaDc == nullptr) return presentation;

    // Draw the PNG bitmap onto the metafile
    Gdiplus::Graphics graphics(metaDc);
    graphics.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);
    graphics.SetPixelOffsetMode(Gdiplus::PixelOffsetModeHalf);
    graphics.DrawImage(&bitmap,
                       Gdiplus::Rect(0, 0, widthPx, heightPx),
                       0, 0,
                       bitmap.GetWidth(), bitmap.GetHeight(),
                       Gdiplus::UnitPixel);

    HENHMETAFILE emf = CloseEnhMetaFile(metaDc);
    if (emf == nullptr) return presentation;

    UINT byteCount = GetEnhMetaFileBits(emf, 0, nullptr);
    if (byteCount > 0)
    {
        presentation.enhancedMetafile.resize(byteCount);
        GetEnhMetaFileBits(emf, byteCount, presentation.enhancedMetafile.data());
    }
    DeleteEnhMetaFile(emf);

    presentation.himetricSize = {PointsToHimetric(widthPoints), PointsToHimetric(heightPoints)};
    return presentation;
}

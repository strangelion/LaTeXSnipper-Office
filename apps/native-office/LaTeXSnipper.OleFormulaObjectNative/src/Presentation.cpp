#include "Presentation.h"
#include "JsonHelper.h"
#include "NativeLog.h"
#include "SvgToEmf.h"

#include "Win32Check.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cwctype>
#include <memory>
#include <mutex>
#include <objidl.h>
#include <shlwapi.h>
#include <gdiplus.h>

// Defined in OleFormulaHandlerModule.cpp.
// Must remain outside the anonymous namespace for external linkage.
extern ULONG_PTR g_gdiplusToken;

namespace
{
constexpr int kPointsPerInch = 72;
constexpr int kHimetricPerInch = 2540;

std::wstring Lowercase(std::wstring value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](wchar_t ch) {
        return static_cast<wchar_t>(std::towlower(ch));
    });
    return value;
}

struct StreamReleaser
{
    void operator()(IStream* stream) const
    {
        if (stream != nullptr) stream->Release();
    }
};

// P1-8: Lazy GDI+ initialization — avoids calling GdiplusStartup inside DllMain
// where the loader lock is held, which can cause Office startup deadlocks.
std::once_flag g_gdiplusInitFlag;
bool g_gdiplusInitSucceeded = false;

bool EnsureGdiplusInitialized()
{
    std::call_once(g_gdiplusInitFlag, []() {
        if (::g_gdiplusToken == 0)
        {
            Gdiplus::GdiplusStartupInput gdiInput;
            g_gdiplusInitSucceeded = Gdiplus::GdiplusStartup(&::g_gdiplusToken, &gdiInput, nullptr) == Gdiplus::Ok;
        }
        else g_gdiplusInitSucceeded = true;
    });
    return g_gdiplusInitSucceeded;
}

int PointsToHimetric(int points)
{
    return MulDiv(points, kHimetricPerInch, kPointsPerInch);
}

int PointsToHimetric(double points)
{
    return static_cast<int>(std::lround(points * kHimetricPerInch / kPointsPerInch));
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
    constexpr size_t kMaxDecodedBytes = 64U * 1024U * 1024U;
    std::wstring encoded = value;
    if (encoded.rfind(L"data:", 0) == 0)
    {
        const size_t comma = encoded.find(L',');
        if (comma == std::wstring::npos || comma <= 5) return {};
        std::wstring metadata = Lowercase(encoded.substr(5, comma - 5));
        if (metadata.size() < 7 || metadata.compare(metadata.size() - 7, 7, L";base64") != 0) return {};
        encoded.erase(0, comma + 1);
    }

    if (encoded.empty()) return {};
    if (encoded.size() % 4 != 0) return {};
    if (encoded.size() > ((kMaxDecodedBytes + 2) / 3) * 4 + 4) return {};

    size_t padding = 0;
    if (encoded.back() == L'=') padding++;
    if (encoded.size() >= 2 && encoded[encoded.size() - 2] == L'=') padding++;
    for (size_t index = 0; index < encoded.size(); ++index)
    {
        const wchar_t ch = encoded[index];
        if (ch == L'=')
        {
            if (index < encoded.size() - padding) return {};
            continue;
        }
        if (DecodeBase64Char(ch) < 0) return {};
    }
    if (padding == 1 && (DecodeBase64Char(encoded[encoded.size() - 2]) & 0x03) != 0) return {};
    if (padding == 2 && (DecodeBase64Char(encoded[encoded.size() - 3]) & 0x0F) != 0) return {};

    const size_t decodedSize = encoded.size() / 4 * 3 - padding;
    if (decodedSize > kMaxDecodedBytes) return {};
    std::vector<BYTE> bytes;
    bytes.reserve(decodedSize);
    for (size_t index = 0; index < encoded.size(); index += 4)
    {
        const int a = DecodeBase64Char(encoded[index]);
        const int b = DecodeBase64Char(encoded[index + 1]);
        const int c = encoded[index + 2] == L'=' ? 0 : DecodeBase64Char(encoded[index + 2]);
        const int d = encoded[index + 3] == L'=' ? 0 : DecodeBase64Char(encoded[index + 3]);
        const unsigned value24 = (static_cast<unsigned>(a) << 18)
            | (static_cast<unsigned>(b) << 12)
            | (static_cast<unsigned>(c) << 6)
            | static_cast<unsigned>(d);
        bytes.push_back(static_cast<BYTE>((value24 >> 16) & 0xFF));
        if (encoded[index + 2] != L'=') bytes.push_back(static_cast<BYTE>((value24 >> 8) & 0xFF));
        if (encoded[index + 3] != L'=') bytes.push_back(static_cast<BYTE>(value24 & 0xFF));
    }

    return bytes;
}

double ReadRenderDimension(const std::wstring& payloadJson, const char* propertyName)
{
#if HAS_NLOHMANN_JSON
    try
    {
        const auto root = nlohmann::json::parse(WideToUtf8(payloadJson));
        if (!root.contains("render") || !root["render"].is_object())
            return 0.0;
        const auto& render = root["render"];
        if (!render.contains(propertyName) || !render[propertyName].is_number())
            return 0.0;
        return render[propertyName].get<double>();
    }
    catch (...)
    {
        return 0.0;
    }
#else
    return 0.0;
#endif
}

void ApplyPayloadSize(const std::wstring& payloadJson, FormulaPresentation* presentation)
{
    // Strictly read from render.widthPt/render.heightPt to avoid picking up
    // unrelated fields (e.g. thumbnail.widthPt) from the full JSON.
    double widthPoints = ReadRenderDimension(payloadJson, "widthPt");
    double heightPoints = ReadRenderDimension(payloadJson, "heightPt");
    if (widthPoints <= 0) widthPoints = ExtractJsonNumber(payloadJson, L"widthPoints");
    if (heightPoints <= 0) heightPoints = ExtractJsonNumber(payloadJson, L"heightPoints");
    if (widthPoints > 0 && heightPoints > 0)
    {
        presentation->himetricSize = {PointsToHimetric(widthPoints), PointsToHimetric(heightPoints)};
    }
}

FormulaPresentation CreatePresentationFromPayload(const std::wstring& payloadJson)
{
    FormulaPresentation presentation{};
    presentation.latex = JsonReadString(payloadJson, L"latex");
    presentation.payloadJson = payloadJson;
    ApplyPayloadSize(payloadJson, &presentation);
    if (presentation.latex.empty())
    {
        presentation.diagnostic = L"OLE_PRESENTATION_INVALID: latex is empty";
        return presentation;
    }
    if (presentation.himetricSize.cx <= 0 || presentation.himetricSize.cy <= 0)
    {
        presentation.diagnostic = L"OLE_PRESENTATION_INVALID: widthPt and heightPt must be positive";
        return presentation;
    }

    std::wstring emfBase64 = JsonReadNestedString(payloadJson, L"presentation", L"emfBase64");
    if (emfBase64.empty()) emfBase64 = ExtractJsonString(payloadJson, L"emfBase64");
    std::vector<BYTE> emfFromPresentation = DecodeBase64(emfBase64);
    if (!emfFromPresentation.empty() && HasValidEmf(emfFromPresentation))
    {
        const std::wstring emfKind = JsonReadNestedString(payloadJson, L"presentation", L"emfKind");
        std::wstring reason;
        const bool raster = ContainsRasterEmfRecords(emfFromPresentation, &reason);
        if (Lowercase(emfKind) == L"vector" && (raster || !HasVectorDrawingEmfRecords(emfFromPresentation, &reason)))
        {
            presentation.diagnostic = L"OLE_VECTOR_PREVIEW_FAILED: " + reason;
        }
        else
        {
            presentation.enhancedMetafile = std::move(emfFromPresentation);
            presentation.previewKind = raster ? PreviewKind::RasterEmfFallback : PreviewKind::EmbeddedVectorEmf;
            presentation.isVector = !raster;
            presentation.diagnostic = raster ? L"Embedded EMF contains raster records" : L"Embedded vector EMF validated";
            WriteNativeOleLog(raster ? L"Presentation route: EMBEDDED_RASTER_EMF" : L"Presentation route: EMBEDDED_VECTOR_EMF");
            return presentation;
        }
    }

    const std::wstring svg = JsonReadNestedString(payloadJson, L"render", L"svg");
    if (!svg.empty())
    {
        double widthPoints = ReadRenderDimension(payloadJson, "widthPt");
        double heightPoints = ReadRenderDimension(payloadJson, "heightPt");
        if (widthPoints <= 0.0) widthPoints = ExtractJsonNumber(payloadJson, L"widthPoints");
        if (heightPoints <= 0.0) heightPoints = ExtractJsonNumber(payloadJson, L"heightPoints");
        const std::wstring color = JsonReadNestedString(payloadJson, L"presentation", L"color");
        SvgToEmfResult vectorResult = ConvertMathJaxSvgToVectorEmf(svg, widthPoints, heightPoints, color);
        if (vectorResult.success)
        {
            presentation.enhancedMetafile = std::move(vectorResult.emfBytes);
            presentation.himetricSize = vectorResult.himetricSize;
            presentation.previewKind = PreviewKind::GeneratedVectorEmf;
            presentation.isVector = true;
            presentation.diagnostic = L"SVG vector EMF generated and validated";
            WriteNativeOleLog(L"Presentation route: SVG_VECTOR_EMF");
            return presentation;
        }
        presentation.diagnostic = vectorResult.error;
    }

    FormulaPresentation pngPres = CreatePresentationFromPayloadPng(payloadJson);
    if (!pngPres.enhancedMetafile.empty())
    {
        WriteNativeOleLog(L"Presentation route: PNG_RASTER_EMF_FALLBACK");
        if (!presentation.diagnostic.empty()) pngPres.diagnostic = presentation.diagnostic + L"; fallback: " + pngPres.diagnostic;
        return pngPres;
    }

    if (presentation.diagnostic.empty()) presentation.diagnostic = pngPres.diagnostic.empty()
        ? L"OLE_PRESENTATION_INVALID: payload has no valid EMF, SVG, or PNG"
        : pngPres.diagnostic;
    return presentation;
}

FormulaPresentation CreatePresentationFromPayloadWithoutRendering(const std::wstring& payloadJson)
{
    FormulaPresentation presentation{};
    presentation.latex = JsonReadString(payloadJson, L"latex");
    presentation.payloadJson = payloadJson;
    ApplyPayloadSize(payloadJson, &presentation);

    std::wstring emfBase64 = JsonReadNestedString(payloadJson, L"presentation", L"emfBase64");
    if (emfBase64.empty()) emfBase64 = ExtractJsonString(payloadJson, L"emfBase64");
    std::vector<BYTE> emfFromPresentation = DecodeBase64(emfBase64);
    if (!emfFromPresentation.empty() && HasValidEmf(emfFromPresentation))
    {
        std::wstring reason;
        const bool raster = ContainsRasterEmfRecords(emfFromPresentation, &reason);
        presentation.enhancedMetafile = std::move(emfFromPresentation);
        presentation.previewKind = raster ? PreviewKind::RasterEmfFallback : PreviewKind::EmbeddedVectorEmf;
        presentation.isVector = !raster;
        return presentation;
    }

    std::vector<BYTE> payloadPresentation = DecodeBase64(ExtractJsonString(payloadJson, L"presentationPayloadBase64"));
    if (!payloadPresentation.empty() && HasValidEmf(payloadPresentation))
    {
        std::wstring reason;
        const bool raster = ContainsRasterEmfRecords(payloadPresentation, &reason);
        presentation.enhancedMetafile = std::move(payloadPresentation);
        presentation.previewKind = raster ? PreviewKind::RasterEmfFallback : PreviewKind::EmbeddedVectorEmf;
        presentation.isVector = !raster;
        return presentation;
    }
    presentation.diagnostic = L"OLE_STORAGE_INVALID: payload does not contain a valid embedded EMF";
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
    if (bytes.empty() || bytes.size() > 128U * 1024U * 1024U)
    {
        return false;
    }

    std::wstring validationReason;
    if (!ValidateEmfRecords(bytes, &validationReason)) return false;

    HENHMETAFILE emf = SetEnhMetaFileBits(static_cast<UINT>(bytes.size()), bytes.data());
    if (emf == nullptr)
    {
        return false;
    }

    ENHMETAHEADER header{};
    bool valid = GetEnhMetaFileHeader(emf, sizeof(header), &header) != 0 &&
        header.dSignature == ENHMETA_SIGNATURE &&
        header.nBytes == bytes.size() &&
        header.nRecords >= 2 &&
        header.rclFrame.right > header.rclFrame.left &&
        header.rclFrame.bottom > header.rclFrame.top;
    DeleteEnhMetaFile(emf);
    return valid;
}

FormulaPresentation CreatePresentationFromPayloadPng(const std::wstring& payloadJson)
{
    FormulaPresentation presentation{};
    presentation.latex = JsonReadString(payloadJson, L"latex");
    presentation.payloadJson = payloadJson;

    // P1-8: Ensure GDI+ is initialized before any GDI+ calls
    if (!EnsureGdiplusInitialized())
    {
        presentation.diagnostic = L"OLE_RASTER_FALLBACK_FAILED: GDI+ startup failed";
        return presentation;
    }

    // Get size from payload (try nested render.widthPt first, then flat widthPt)
    double widthPoints = ExtractJsonNumber(payloadJson, L"widthPt");
    double heightPoints = ExtractJsonNumber(payloadJson, L"heightPt");
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

    IStream* rawStream = nullptr;
    HRESULT hr = CreateStreamOnHGlobal(hGlobal, TRUE, &rawStream);
    if (FAILED(hr)) { GlobalFree(hGlobal); return presentation; }
    std::unique_ptr<IStream, StreamReleaser> stream(rawStream);

    std::unique_ptr<Gdiplus::Bitmap> bitmap(new Gdiplus::Bitmap(stream.get()));
    if (bitmap->GetLastStatus() != Gdiplus::Ok)
    {
        presentation.diagnostic = L"OLE_RASTER_FALLBACK_FAILED: PNG decode failed";
        return presentation;
    }

    // Create a metafile DC to render the bitmap into
    constexpr double kRasterFallbackDpi = 300.0;
    HDC screenDc = GetDC(nullptr);
    if (screenDc == nullptr)
    {
        presentation.diagnostic = L"OLE_RASTER_FALLBACK_FAILED: GetDC failed";
        return presentation;
    }
    int widthPx = static_cast<int>(std::lround(widthPoints * kRasterFallbackDpi / 72.0));
    int heightPx = static_cast<int>(std::lround(heightPoints * kRasterFallbackDpi / 72.0));
    if (widthPx < 1) widthPx = 1;
    if (heightPx < 1) heightPx = 1;
    if (widthPx > 8192 || heightPx > 8192 ||
        static_cast<unsigned long long>(widthPx) * static_cast<unsigned long long>(heightPx) > 32ULL * 1024ULL * 1024ULL)
    {
        ReleaseDC(nullptr, screenDc);
        presentation.diagnostic = L"OLE_RASTER_FALLBACK_FAILED: raster dimensions exceed safety limits";
        return presentation;
    }

    RECT frame01mm = {
        0, 0,
        PointsToHimetric(widthPoints),
        PointsToHimetric(heightPoints)
    };
    HDC metaDc = CreateEnhMetaFileW(screenDc, nullptr, &frame01mm,
                                     L"LaTeXSnipper\0Formula\0");
    ReleaseDC(nullptr, screenDc);

    if (metaDc == nullptr) return presentation;

    Gdiplus::Status drawStatus = Gdiplus::GenericError;
    {
        Gdiplus::Graphics graphics(metaDc);
        graphics.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);
        graphics.SetPixelOffsetMode(Gdiplus::PixelOffsetModeHalf);
        drawStatus = graphics.DrawImage(bitmap.get(),
                                        Gdiplus::Rect(0, 0, widthPx, heightPx),
                                        0, 0,
                                        bitmap->GetWidth(), bitmap->GetHeight(),
                                        Gdiplus::UnitPixel);
        graphics.Flush(Gdiplus::FlushIntentionSync);
    }
    if (drawStatus != Gdiplus::Ok)
    {
        HENHMETAFILE failedMetafile = CloseEnhMetaFile(metaDc);
        if (failedMetafile != nullptr) DeleteEnhMetaFile(failedMetafile);
        presentation.diagnostic = L"OLE_RASTER_FALLBACK_FAILED: DrawImage failed";
        return presentation;
    }

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
    presentation.previewKind = PreviewKind::RasterEmfFallback;
    presentation.isVector = false;
    std::wstring rasterReason;
    if (!ContainsRasterEmfRecords(presentation.enhancedMetafile, &rasterReason))
    {
        presentation.enhancedMetafile.clear();
        presentation.previewKind = PreviewKind::None;
        presentation.diagnostic = L"OLE_RASTER_FALLBACK_FAILED: generated EMF did not contain a bitmap record";
        return presentation;
    }
    presentation.diagnostic = L"PNG compatibility fallback embedded as raster EMF";
    return presentation;
}

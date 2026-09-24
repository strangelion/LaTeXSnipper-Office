#nullable enable
using System;
using System.Globalization;
using System.Text.Json;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// Validated, host-neutral view of a versioned formula style snapshot.
/// Unknown fields remain in <see cref="PresentationData.StyleProfile"/> for
/// round trips, while hosts consume only the subset they can express safely.
/// </summary>
public sealed class FormulaPresentationStyle
{
    public bool HasVersionedProfile { get; private set; }
    public string? OfficeFont { get; private set; }
    public string? TextFont { get; private set; }
    public float? FontSizePt { get; private set; }
    public bool? Bold { get; private set; }
    public string? MathVariant { get; private set; }
    public string ColorHex { get; private set; } = "#000000";
    public string Alignment { get; private set; } = "center";
    public string? DisplayMode { get; private set; }
    public float? ParagraphBeforePt { get; private set; }
    public float? ParagraphAfterPt { get; private set; }
    public float? BaselineShiftPt { get; private set; }
    public float? MaxWidthPt { get; private set; }
    public string? OutputStrategy { get; private set; }

    public static FormulaPresentationStyle From(PresentationData? presentation)
    {
        var style = new FormulaPresentationStyle();
        if (presentation == null) return style;

        style.Alignment = NormalizeEnum(
            presentation.Alignment,
            "center",
            "baseline",
            "left",
            "center",
            "right");
        style.ColorHex = NormalizeColor(presentation.Color, "#000000");

        if (!presentation.StyleProfile.HasValue) return style;
        JsonElement root = presentation.StyleProfile.Value;
        if (root.ValueKind != JsonValueKind.Object) return style;
        if (!TryReadInt(root, "schemaVersion", out int schemaVersion) || schemaVersion != 1)
            return style;

        style.HasVersionedProfile = true;
        if (root.TryGetProperty("math", out JsonElement math) &&
            math.ValueKind == JsonValueKind.Object)
        {
            style.OfficeFont = ReadSafeText(math, "officeFont", 64);
            style.TextFont = ReadSafeText(math, "textFont", 64);
            style.FontSizePt = ReadClampedFloat(math, "fontSizePt", 6.0f, 72.0f);
            string? weight = ReadSafeText(math, "fontWeight", 16);
            if (weight == "bold") style.Bold = true;
            else if (weight == "normal") style.Bold = false;
            style.MathVariant = NormalizeNullableEnum(
                ReadSafeText(math, "mathVariant", 16),
                "tex",
                "roman",
                "italic");
            style.ColorHex = NormalizeColor(
                ReadSafeText(math, "color", 16),
                style.ColorHex);
        }

        if (root.TryGetProperty("layout", out JsonElement layout) &&
            layout.ValueKind == JsonValueKind.Object)
        {
            style.DisplayMode = NormalizeNullableEnum(
                ReadSafeText(layout, "displayMode", 16),
                "inline",
                "display",
                "numbered");
            style.Alignment = NormalizeEnum(
                ReadSafeText(layout, "alignment", 16),
                style.Alignment,
                "baseline",
                "left",
                "center",
                "right");
            style.ParagraphBeforePt = ReadClampedFloat(
                layout,
                "paragraphBeforePt",
                0.0f,
                144.0f);
            style.ParagraphAfterPt = ReadClampedFloat(
                layout,
                "paragraphAfterPt",
                0.0f,
                144.0f);
            style.BaselineShiftPt = ReadClampedFloat(
                layout,
                "baselineShiftPt",
                -36.0f,
                36.0f);
            style.MaxWidthPt = ReadClampedFloat(
                layout,
                "maxWidthPt",
                72.0f,
                1440.0f);
        }

        if (root.TryGetProperty("output", out JsonElement output) &&
            output.ValueKind == JsonValueKind.Object)
        {
            style.OutputStrategy = NormalizeNullableEnum(
                ReadSafeText(output, "strategy", 16),
                "editable",
                "fixed");
        }

        return style;
    }

    public bool TryGetOfficeColor(out int bgr)
    {
        bgr = 0;
        if (ColorHex.Length != 7 || ColorHex[0] != '#') return false;
        if (!int.TryParse(
                ColorHex.Substring(1),
                NumberStyles.HexNumber,
                CultureInfo.InvariantCulture,
                out int rgb))
            return false;
        int red = (rgb >> 16) & 0xff;
        int green = (rgb >> 8) & 0xff;
        int blue = rgb & 0xff;
        bgr = (blue << 16) | (green << 8) | red;
        return true;
    }

    private static bool TryReadInt(JsonElement parent, string name, out int value)
    {
        value = 0;
        return parent.TryGetProperty(name, out JsonElement element) &&
            element.ValueKind == JsonValueKind.Number &&
            element.TryGetInt32(out value);
    }

    private static float? ReadClampedFloat(
        JsonElement parent,
        string name,
        float minimum,
        float maximum)
    {
        if (!parent.TryGetProperty(name, out JsonElement element) ||
            element.ValueKind != JsonValueKind.Number ||
            !element.TryGetSingle(out float value) ||
            float.IsNaN(value) ||
            float.IsInfinity(value))
            return null;
        return Math.Min(maximum, Math.Max(minimum, value));
    }

    private static string? ReadSafeText(JsonElement parent, string name, int maxLength)
    {
        if (!parent.TryGetProperty(name, out JsonElement element) ||
            element.ValueKind != JsonValueKind.String)
            return null;
        string value = (element.GetString() ?? string.Empty).Trim();
        if (value.Length == 0 || value.Length > maxLength) return null;
        foreach (char character in value)
        {
            if (char.IsControl(character)) return null;
        }
        return value;
    }

    private static string NormalizeColor(string? value, string fallback)
    {
        if (value == null || value.Trim().Length == 0 || value.Length != 7 || value[0] != '#')
            return fallback;
        for (int index = 1; index < value.Length; index++)
        {
            if (!Uri.IsHexDigit(value[index])) return fallback;
        }
        return value.ToUpperInvariant();
    }

    private static string NormalizeEnum(
        string? value,
        string fallback,
        params string[] allowed)
    {
        foreach (string candidate in allowed)
        {
            if (string.Equals(value, candidate, StringComparison.Ordinal))
                return candidate;
        }
        return fallback;
    }

    private static string? NormalizeNullableEnum(string? value, params string[] allowed)
    {
        foreach (string candidate in allowed)
        {
            if (string.Equals(value, candidate, StringComparison.Ordinal))
                return candidate;
        }
        return null;
    }
}

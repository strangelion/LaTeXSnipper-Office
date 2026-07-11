#nullable enable
using System;
using System.Text.Json;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// Shared OLE automation helpers for calling ILatexSnipperFormula methods
/// on an embedded OLE object via IDispatch / dynamic dispatch.
///
/// Works across Excel (OLEObject.Object), PowerPoint (Shape.OLEFormat.Object),
/// and Word (InlineShape.OLEFormat.Object).
/// </summary>
public static class OleFormulaInterop
{
    /// <summary>
    /// Call ILatexSnipperFormula.InitializeFromJson on the OLE automation object.
    /// Returns true on success.
    /// </summary>
    public static bool Initialize(dynamic oleAutomationObject, FormulaPayload payload)
    {
        try
        {
            string json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
            {
                DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
            });
            oleAutomationObject.InitializeFromJson(json);
            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[OleFormulaInterop] InitializeFromJson failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Read back the payload from an OLE object and verify formulaId and revision match.
    /// Returns the full payload JSON string from the OLE object if successful, null otherwise.
    /// </summary>
    public static string? GetPayloadJson(dynamic oleAutomationObject)
    {
        try
        {
            string? json = oleAutomationObject.GetPayloadJson();
            return json;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[OleFormulaInterop] GetPayloadJson failed: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Check whether the OLE object was initialized with a real payload
    /// (not a placeholder). Returns true if initialized, false otherwise.
    /// </summary>
    public static bool IsInitialized(dynamic oleAutomationObject)
    {
        try
        {
            return oleAutomationObject.IsInitialized();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[OleFormulaInterop] IsInitialized failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Verify round-trip: all key fields survive the OLE object's InitializeFromJson
    /// and GetPayloadJson cycle without corruption.
    /// </summary>
    public static bool VerifyRoundTrip(dynamic oleAutomationObject, FormulaPayload expectedPayload)
    {
        try
        {
            // Check FormulaId matches
            string? formulaId = oleAutomationObject.GetFormulaId();
            if (!string.Equals(formulaId, expectedPayload.FormulaId, StringComparison.Ordinal))
                return false;

            // Check full payload round-trip via GetPayloadJson
            string? json = oleAutomationObject.GetPayloadJson();
            if (string.IsNullOrEmpty(json))
                return false;

            var actual = System.Text.Json.JsonSerializer.Deserialize<FormulaPayload>(json,
                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (actual == null)
                return false;

            // Structural comparison of key fields
            if (actual.FormulaId != expectedPayload.FormulaId)
                return false;
            if (actual.SchemaVersion != expectedPayload.SchemaVersion)
                return false;
            if (actual.Revision != expectedPayload.Revision)
                return false;

            // OLE internally normalizes StorageMode to "ole".
            // Allow null/auto/native from input payload to match "ole" after round-trip.
            var expectedMode = expectedPayload.StorageMode;
            if (expectedMode == null || expectedMode == "auto" || expectedMode == "native")
                expectedMode = "ole";
            if (actual.StorageMode != expectedMode)
                return false;

            // P1-1: Verify content fields survived the round-trip
            if (!string.Equals(actual.Latex, expectedPayload.Latex, StringComparison.Ordinal))
                return false;
            if (!string.Equals(actual.Display, expectedPayload.Display, StringComparison.Ordinal))
                return false;

            // Compare Omml only if both sides have it (may be null in some paths)
            if (!string.IsNullOrEmpty(expectedPayload.Omml) && !string.IsNullOrEmpty(actual.Omml))
            {
                if (!string.Equals(actual.Omml, expectedPayload.Omml, StringComparison.Ordinal))
                    return false;
            }

            // P1-1: Verify the OLE object still has valid preview data
            bool hasPreview = (actual.Render?.Svg != null) || (actual.Render?.Png != null) || (actual.Presentation?.EmfBase64 != null);
            if (!hasPreview)
            {
                System.Diagnostics.Debug.WriteLine("[OleFormulaInterop] VerifyRoundTrip failed: OLE object lost preview data");
                return false;
            }

            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[OleFormulaInterop] VerifyRoundTrip failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Call ILatexSnipperFormula.ReplacePayloadJson on the OLE automation object.
    /// Returns true on success.
    /// </summary>
    public static bool ReplacePayloadJson(dynamic oleAutomationObject, FormulaPayload payload)
    {
        try
        {
            string json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
            {
                DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
            });
            oleAutomationObject.ReplacePayloadJson(json);
            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[OleFormulaInterop] ReplacePayloadJson failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Normalize a FormulaPayload for OLE insertion.
    /// Sets storageMode to "ole", ensures schemaVersion and revision are valid,
    /// and checks that preview data (PNG or EMF) is present.
    /// Throws InvalidOperationException if required fields are missing.
    /// </summary>
    public static FormulaPayload NormalizeForOle(FormulaPayload payload)
    {
        if (payload == null)
            throw new ArgumentNullException(nameof(payload));

        if (string.IsNullOrWhiteSpace(payload.FormulaId))
            throw new InvalidOperationException("OLE formula requires a non-empty FormulaId");

        if (string.IsNullOrWhiteSpace(payload.Latex))
            throw new InvalidOperationException("OLE formula requires non-empty LaTeX");

        payload.StorageMode = "ole";
        if (payload.SchemaVersion <= 0)
            payload.SchemaVersion = 3;
        if (payload.Revision < 0)
            payload.Revision = 0;

        // Check for preview data — must be valid, not just non-null.
        bool hasPng = !string.IsNullOrWhiteSpace(payload.Render?.Png) && IsValidPngBase64(payload.Render!.Png!);
        bool hasSvg = !string.IsNullOrWhiteSpace(payload.Render?.Svg) && payload.Render!.Svg!.IndexOf("<svg", StringComparison.OrdinalIgnoreCase) >= 0;
        bool hasEmf = !string.IsNullOrWhiteSpace(payload.Presentation?.EmfBase64);
        if (!hasSvg && !hasPng && !hasEmf)
        {
            throw new InvalidOperationException(
                "OLE formula requires valid preview data (Render.Svg, Render.Png with valid Base64+PNG magic, or Presentation.EmfBase64). " +
                "Ensure the formula is rendered before OLE insertion.");
        }

        return payload;
    }

    /// <summary>
    /// Validate that a string is a valid Base64-encoded PNG image.
    /// Checks: non-empty, valid Base64, and PNG magic bytes (0x89 PNG ...).
    /// Handles optional "data:image/png;base64," prefix.
    /// </summary>
    private static bool IsValidPngBase64(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return false;

        if (!StrictBase64.TryDecode(value, out byte[] bytes, allowDataUrl: true,
                expectedMediaType: "image/png")) return false;

        // PNG magic: 89 50 4E 47 0D 0A 1A 0A
        return bytes.Length >= 8 &&
               bytes[0] == 0x89 &&
               bytes[1] == 0x50 &&
               bytes[2] == 0x4E &&
               bytes[3] == 0x47 &&
               bytes[4] == 0x0D &&
               bytes[5] == 0x0A &&
               bytes[6] == 0x1A &&
               bytes[7] == 0x0A;
    }
}

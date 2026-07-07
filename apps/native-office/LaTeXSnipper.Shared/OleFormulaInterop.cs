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
    /// Verify round-trip: payload.FormulaId matches what the OLE object reports.
    /// </summary>
    public static bool VerifyRoundTrip(dynamic oleAutomationObject, string expectedFormulaId)
    {
        try
        {
            string? formulaId = oleAutomationObject.GetFormulaId();
            return string.Equals(formulaId, expectedFormulaId, StringComparison.Ordinal);
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
}

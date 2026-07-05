using System;
using Microsoft.Office.Interop.Word;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Word.Metadata;

/// <summary>
/// Manages formula metadata in Word CustomXMLParts.
/// Namespace: urn:latexsnipper:native-office:v2
/// </summary>
public static class FormulaMetadata
{
    private const string NamespaceUri = "urn:latexsnipper:native-office:v2";

    /// <summary>
    /// Write formula metadata to document CustomXMLParts.
    /// </summary>
    public static void Write(Document doc, string formulaId, FormulaPayload payload)
    {
        try
        {
            var xml = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<lsno:noffice xmlns:lsno=""{NamespaceUri}"">
  <lsno:formula id=""{formulaId}"" version=""2"" created=""{DateTime.UtcNow:O}"">
    <lsno:latex>{EscapeXml(payload.Latex)}</lsno:latex>
    <lsno:omml sha256=""{ComputeSha256(payload.Omml)}"">{Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(payload.Omml))}</lsno:omml>
    <lsno:presentation display=""{payload.Display}"" alignment=""{payload.Presentation?.Alignment ?? "center"}"" scale=""{payload.Presentation?.FontScale ?? 1.0f}"" />
  </lsno:formula>
</lsno:noffice>";

            doc.CustomXMLParts.Add(xml);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[FormulaMetadata] Write failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Read formula metadata for a given range.
    /// Returns null if no managed formula is found.
    /// </summary>
    public static FormulaPayload? Read(Range range)
    {
        try
        {
            var doc = range.Document;
            foreach (CustomXMLPart part in doc.CustomXMLParts)
            {
                if (part.NamespaceURI == NamespaceUri)
                {
                    var node = part.SelectSingleNode("//lsno:formula");
                    if (node != null)
                    {
                        var formulaId = node.Attributes.GetNamedItem("id")?.Value;
                        var latex = part.SelectSingleNode("//lsno:latex")?.Text ?? "";
                        var display = part.SelectSingleNode("//lsno:presentation")?.Attributes?.GetNamedItem("display")?.Value ?? "block";

                        // Decode OMML from base64
                        var ommlBase64 = part.SelectSingleNode("//lsno:omml")?.Text ?? "";
                        var omml = "";
                        try
                        {
                            omml = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(ommlBase64));
                        }
                        catch { }

                        if (!string.IsNullOrEmpty(formulaId))
                        {
                            return new FormulaPayload
                            {
                                FormulaId = formulaId,
                                Latex = latex,
                                Omml = omml,
                                Display = display
                            };
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[FormulaMetadata] Read failed: {ex.Message}");
        }
        return null;
    }

    /// <summary>
    /// Update metadata for an existing formula.
    /// </summary>
    public static void Update(Document doc, string formulaId, FormulaPayload payload)
    {
        // Remove old metadata and write new
        Remove(doc, formulaId);
        Write(doc, formulaId, payload);
    }

    /// <summary>
    /// Remove metadata for a formula.
    /// </summary>
    public static void Remove(Document doc, string formulaId)
    {
        try
        {
            for (int i = doc.CustomXMLParts.Count; i >= 1; i--)
            {
                var part = doc.CustomXMLParts[i];
                if (part.NamespaceURI == NamespaceUri)
                {
                    var node = part.SelectSingleNode($"//lsno:formula[@id='{formulaId}']");
                    if (node != null)
                    {
                        part.Delete();
                        break;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[FormulaMetadata] Remove failed: {ex.Message}");
        }
    }

    private static string EscapeXml(string text)
    {
        return text
            .Replace("&", "&amp;")
            .Replace("<", "&lt;")
            .Replace(">", "&gt;")
            .Replace("\"", "&quot;")
            .Replace("'", "&apos;");
    }

    private static string ComputeSha256(string input)
    {
        using var sha = System.Security.Cryptography.SHA256.Create();
        var bytes = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(input));
        return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
    }
}

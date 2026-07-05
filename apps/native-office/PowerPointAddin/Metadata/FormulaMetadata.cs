using Microsoft.Office.Interop.PowerPoint;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.PowerPoint.Metadata;

/// <summary>
/// Manages formula metadata in PowerPoint Presentation CustomXMLParts.
/// Namespace: urn:latexsnipper:native-office:v2
/// </summary>
public static class FormulaMetadata
{
    private const string NamespaceUri = "urn:latexsnipper:native-office:v2";

    /// <summary>
    /// Write formula metadata to presentation CustomXMLParts.
    /// </summary>
    public static void Write(Presentation presentation, FormulaPayload payload)
    {
        try
        {
            var xml = $@"<?xml version=""1.0"" encoding=""UTF-8""?>
<lsno:noffice xmlns:lsno=""{NamespaceUri}"">
  <lsno:formula id=""{payload.FormulaId}"" version=""2"" created=""{DateTime.UtcNow:O}"">
    <lsno:latex>{EscapeXml(payload.Latex)}</lsno:latex>
    <lsno:omml sha256=""{ComputeSha256(payload.Omml)}"">{Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(payload.Omml))}</lsno:omml>
    <lsno:presentation display=""{payload.Display}"" alignment=""{payload.Presentation?.Alignment ?? "center"}"" scale=""{payload.Presentation?.FontScale ?? 1.0f}"" />
  </lsno:formula>
</lsno:noffice>";

            presentation.CustomXMLParts.Add(xml);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[FormulaMetadata] Write failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Read formula metadata by formula ID.
    /// </summary>
    public static FormulaPayload? Read(Presentation presentation, string formulaId)
    {
        try
        {
            foreach (CustomXMLPart part in presentation.CustomXMLParts)
            {
                if (part.NamespaceURI == NamespaceUri)
                {
                    var node = part.SelectSingleNode($"//lsno:formula[@id='{formulaId}']");
                    if (node != null)
                    {
                        var latex = part.SelectSingleNode("//lsno:latex")?.Text ?? "";
                        var display = part.SelectSingleNode("//lsno:presentation")?.Attributes?.GetNamedItem("display")?.Value ?? "block";

                        var ommlBase64 = part.SelectSingleNode("//lsno:omml")?.Text ?? "";
                        var omml = "";
                        try
                        {
                            omml = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(ommlBase64));
                        }
                        catch { }

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
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[FormulaMetadata] Read failed: {ex.Message}");
        }
        return null;
    }

    /// <summary>
    /// Update metadata for an existing formula.
    /// </summary>
    public static void Update(Presentation presentation, string formulaId, FormulaPayload payload)
    {
        Remove(presentation, formulaId);
        Write(presentation, payload);
    }

    /// <summary>
    /// Remove metadata for a formula.
    /// </summary>
    public static void Remove(Presentation presentation, string formulaId)
    {
        try
        {
            for (int i = presentation.CustomXMLParts.Count; i >= 1; i--)
            {
                var part = presentation.CustomXMLParts[i];
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

    /// <summary>
    /// Clean up orphaned metadata entries.
    /// </summary>
    public static int CleanupOrphans(Presentation presentation, HashSet<string> activeFormulaIds)
    {
        int removed = 0;
        try
        {
            for (int i = presentation.CustomXMLParts.Count; i >= 1; i--)
            {
                var part = presentation.CustomXMLParts[i];
                if (part.NamespaceURI == NamespaceUri)
                {
                    var node = part.SelectSingleNode("//lsno:formula");
                    if (node != null)
                    {
                        var id = node.Attributes.GetNamedItem("id")?.Value;
                        if (id != null && !activeFormulaIds.Contains(id))
                        {
                            part.Delete();
                            removed++;
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[FormulaMetadata] CleanupOrphans failed: {ex.Message}");
        }
        return removed;
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
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}

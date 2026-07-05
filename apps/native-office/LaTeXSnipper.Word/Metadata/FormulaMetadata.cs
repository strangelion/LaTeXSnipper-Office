using System;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.Word.Metadata
{
    internal static class FormulaMetadata
    {
        private const string NamespaceUri = "urn:latexsnipper:native-office:v2";

        public static void Write(Microsoft.Office.Interop.Word.Document doc, string formulaId, FormulaPayload payload)
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

        public static FormulaPayload Read(Microsoft.Office.Interop.Word.Range range)
        {
            try
            {
                var doc = range.Document;
                foreach (dynamic part in doc.CustomXMLParts)
                {
                    try
                    {
                        if (part.NamespaceURI == NamespaceUri)
                        {
                            var node = part.SelectSingleNode("//lsno:formula");
                            if (node != null)
                            {
                                var formulaId = node.Attributes.GetNamedItem("id")?.Value;
                                var latex = part.SelectSingleNode("//lsno:latex")?.Text ?? "";
                                var display = part.SelectSingleNode("//lsno:presentation")?.Attributes?.GetNamedItem("display")?.Value ?? "block";

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
                    catch
                    {
                        // Skip parts with undeclared namespace prefixes
                    }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FormulaMetadata] Read failed: {ex.Message}");
            }
            return null;
        }

        public static void Update(Microsoft.Office.Interop.Word.Document doc, string formulaId, FormulaPayload payload)
        {
            Remove(doc, formulaId);
            Write(doc, formulaId, payload);
        }

        public static void Remove(Microsoft.Office.Interop.Word.Document doc, string formulaId)
        {
            try
            {
                for (int i = doc.CustomXMLParts.Count; i >= 1; i--)
                {
                    dynamic part = doc.CustomXMLParts[i];
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

        public static string EscapeXml(string text)
        {
            return text
                .Replace("&", "&amp;")
                .Replace("<", "&lt;")
                .Replace(">", "&gt;")
                .Replace("\"", "&quot;")
                .Replace("'", "&apos;");
        }

        public static string ComputeSha256(string input)
        {
            using var sha = System.Security.Cryptography.SHA256.Create();
            var bytes = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(input));
            return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
        }
    }
}

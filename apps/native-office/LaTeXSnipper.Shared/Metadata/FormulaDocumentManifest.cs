#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;

namespace LaTeXSnipper.NativeOffice.Shared.Metadata
{
    /// <summary>
    /// Single-document manifest for all LaTeXSnipper formula objects.
    /// Replaces the per-formula CustomXMLPart approach in Word and the
    /// AlternativeText-only approach in Excel/PowerPoint.
    ///
    /// One CustomXMLPart per document, keyed by namespace
    /// "urn:latexsnipper:office:objects:v3".
    /// </summary>
    public static class FormulaDocumentManifest
    {
        private const string NamespaceUri = "urn:latexsnipper:office:objects:v3";
        private const string PartId = "LatexSnipperFormulaManifest";

        /// <summary>
        /// Write (or replace) a single entry in the document manifest.
        /// Creates the CustomXMLPart if it does not already exist.
        /// </summary>
        public static void Write(Microsoft.Office.Interop.Word.Document doc, FormulaPayload payload)
        {
            try
            {
                dynamic existing = FindOrCreatePart(doc);
                var existingXml = (string?)GetPartXml(existing);
                var xdoc = ParseOrCreate(existingXml);

                // Remove old entry for this formulaId, then add new one
                var root = xdoc.Root!;
                var oldEntry = root.Elements()
                    .FirstOrDefault(e => (string?)e.Attribute("id") == payload.FormulaId);
                if (oldEntry != null)
                    oldEntry.Remove();

                root.Add(new XElement("formula",
                    new XAttribute("id", payload.FormulaId),
                    new XAttribute("revision", payload.Revision),
                    new XAttribute("storageMode", ChooseStorageMode(payload)),
                    new XAttribute("schemaVersion", payload.SchemaVersion),
                    new XElement("latex", payload.Latex ?? ""),
                    new XElement("display", payload.Display ?? "inline"),
                    new XElement("payload", SerializePayloadJson(payload)),
                    new XElement("locator",
                        new XAttribute("host", "word"),
                        new XAttribute("objectName", $"LSNO_{payload.FormulaId}"),
                        new XAttribute("kind", ChooseStorageMode(payload))
                    ),
                    string.IsNullOrEmpty(payload.Omml) ? null :
                        new XElement("omml", new XAttribute("sha256", ComputeSha256(payload.Omml)),
                            Convert.ToBase64String(Encoding.UTF8.GetBytes(payload.Omml)))
                ));

                var newXml = xdoc.ToString(SaveOptions.DisableFormatting);

                // Add new part BEFORE deleting old one (protect against Add failure)
                doc.CustomXMLParts.Add(newXml);
                existing.Delete();
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FormulaManifest] Write failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Read a formula entry from the manifest by formulaId.
        /// Returns null if not found.
        /// </summary>
        public static FormulaPayload? Read(Microsoft.Office.Interop.Word.Document doc, string formulaId)
        {
            try
            {
                dynamic part = FindPart(doc);
                if (part == null) return null;

                var xml = (string?)GetPartXml(part);
                if (string.IsNullOrEmpty(xml)) return null;

                var xdoc = XDocument.Parse(xml);
                var entry = xdoc.Root?.Elements()
                    .FirstOrDefault(e => (string?)e.Attribute("id") == formulaId);
                if (entry == null) return null;

                return DeserializeFromEntry(entry, formulaId)
                    ?? new FormulaPayload
                    {
                        FormulaId = formulaId,
                        Latex = entry.Element("latex")?.Value ?? "",
                        Display = entry.Element("display")?.Value ?? "inline",
                        Revision = (int?)entry.Attribute("revision") ?? 0,
                        StorageMode = (string?)entry.Attribute("storageMode"),
                        SchemaVersion = (int?)entry.Attribute("schemaVersion") ?? 3,
                        Omml = DecodeOmml(entry.Element("omml")),
                    };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FormulaManifest] Read({formulaId}) failed: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Read the entire manifest as a dictionary.
        /// </summary>
        public static Dictionary<string, FormulaPayload> ReadAll(Microsoft.Office.Interop.Word.Document doc)
        {
            var result = new Dictionary<string, FormulaPayload>();
            try
            {
                var part = FindPart(doc);
                if (part == null) return result;

                var xml = GetPartXml(part);
                if (string.IsNullOrEmpty(xml)) return result;

                var xdoc = XDocument.Parse(xml);
                foreach (var entry in xdoc.Root?.Elements() ?? Enumerable.Empty<XElement>())
                {
                    var id = (string?)entry.Attribute("id");
                    if (string.IsNullOrEmpty(id)) continue;

                    result[id] = DeserializeFromEntry(entry, id)
                        ?? new FormulaPayload
                        {
                            FormulaId = id,
                            Latex = entry.Element("latex")?.Value ?? "",
                            Display = entry.Element("display")?.Value ?? "inline",
                            Revision = (int?)entry.Attribute("revision") ?? 0,
                            StorageMode = (string?)entry.Attribute("storageMode"),
                            SchemaVersion = (int?)entry.Attribute("schemaVersion") ?? 3,
                        };
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FormulaManifest] ReadAll failed: {ex.Message}");
            }
            return result;
        }

        /// <summary>
        /// Remove a formula from the manifest by formulaId.
        /// </summary>
        public static void Remove(Microsoft.Office.Interop.Word.Document doc, string formulaId)
        {
            try
            {
                dynamic part = FindPart(doc);
                if (part == null) return;

                var xml = (string?)GetPartXml(part);
                if (string.IsNullOrEmpty(xml)) return;

                var xdoc = XDocument.Parse(xml);
                var entry = xdoc.Root?.Elements()
                    .FirstOrDefault(e => (string?)e.Attribute("id") == formulaId);
                if (entry == null) return;

                entry.Remove();

                var newXml = xdoc.ToString(SaveOptions.DisableFormatting);
                doc.CustomXMLParts.Add(newXml);
                part.Delete();
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FormulaManifest] Remove failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Find the manifest CustomXMLPart, or null if it doesn't exist.
        /// </summary>
        public static dynamic? FindPart(Microsoft.Office.Interop.Word.Document doc)
        {
            try
            {
                for (int i = doc.CustomXMLParts.Count; i >= 1; i--)
                {
                    dynamic part = doc.CustomXMLParts[i];
                    try
                    {
                        if ((string?)part.NamespaceURI == NamespaceUri)
                            return part;
                    }
                    catch { }
                }
            }
            catch { }
            return null;
        }

        // ── Private helpers ──

        private static dynamic FindOrCreatePart(Microsoft.Office.Interop.Word.Document doc)
        {
            var existing = FindPart(doc);
            if (existing != null) return existing;

            var emptyXml = $"<?xml version=\"1.0\" encoding=\"UTF-8\"?><lsno:manifest xmlns:lsno=\"{NamespaceUri}\" />";
            doc.CustomXMLParts.Add(emptyXml);
            return FindPart(doc)!;
        }

        private static string? GetPartXml(object part)
        {
            try { return (string?)part.GetType().GetProperty("XML")?.GetValue(part); }
            catch { return null; }
        }

        private static XDocument ParseOrCreate(string? xml)
        {
            if (!string.IsNullOrEmpty(xml))
            {
                try { return XDocument.Parse(xml); }
                catch { }
            }
            return XDocument.Parse($"<?xml version=\"1.0\" encoding=\"UTF-8\"?><lsno:manifest xmlns:lsno=\"{NamespaceUri}\" />");
        }

        private static string ChooseStorageMode(FormulaPayload payload)
        {
            if (!string.IsNullOrEmpty(payload.StorageMode))
                return payload.StorageMode;
            return "native-omml";
        }

        private static string ComputeSha256(string input)
        {
            using var sha = SHA256.Create();
            var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(input));
            return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
        }

        private static string DecodeOmml(XElement? ommlEl)
        {
            if (ommlEl == null) return "";
            try
            {
                return Encoding.UTF8.GetString(Convert.FromBase64String(ommlEl.Value));
            }
            catch { return ""; }
        }

        /// <summary>
        /// Deserialize a FormulaPayload from the entry's &lt;payload&gt; element (base64 canonical JSON).
        /// Returns null if no valid payload element exists.
        /// </summary>
        private static FormulaPayload? DeserializeFromEntry(XElement entry, string formulaId)
        {
            var payloadEl = entry.Element("payload");
            if (payloadEl == null || string.IsNullOrEmpty(payloadEl.Value))
                return null;

            try
            {
                var json = Encoding.UTF8.GetString(Convert.FromBase64String(payloadEl.Value));
                var result = System.Text.Json.JsonSerializer.Deserialize<FormulaPayload>(json,
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (result != null && result.FormulaId == formulaId)
                    return result;
                // Payload formulaId mismatch — fall back to entry-level data
                return null;
            }
            catch
            {
                return null;
            }
        }

        // ── Excel/PowerPoint manifest helpers (via document-level CustomXML) ──

        /// <summary>
        /// Excel-specific: find manifest part on a Workbook.
        /// </summary>
        public static object? FindPartWorksheet(dynamic workbook)
        {
            try
            {
                var parts = workbook.CustomXMLParts;
                for (int i = parts.Count; i >= 1; i--)
                {
                    dynamic part = parts[i];
                    try
                    {
                        if ((string?)part.NamespaceURI == NamespaceUri)
                            return part;
                    }
                    catch { }
                }
            }
            catch { }
            return null;
        }

        /// <summary>
        /// PowerPoint-specific: find manifest part on a Presentation.
        /// </summary>
        public static object? FindPartPresentation(dynamic presentation)
        {
            try
            {
                var parts = presentation.CustomXMLParts;
                for (int i = parts.Count; i >= 1; i--)
                {
                    dynamic part = parts[i];
                    try
                    {
                        if ((string?)part.NamespaceURI == NamespaceUri)
                            return part;
                    }
                    catch { }
                }
            }
            catch { }
            return null;
        }

        /// <summary>
        /// Write a formula entry to the manifest on a Workbook/Presentation.
        /// </summary>
        public static void WriteEntry(dynamic customXmlParts, FormulaPayload payload, string host = "excel")
        {
            try
            {
                dynamic? existing = null;
                for (int i = customXmlParts.Count; i >= 1; i--)
                {
                    dynamic part = customXmlParts[i];
                    try
                    {
                        if ((string?)part.NamespaceURI == NamespaceUri)
                        {
                            existing = part;
                            break;
                        }
                    }
                    catch { }
                }

                string xml;
                var locator = FormulaObjectLocator.FromFormulaId(host, payload.FormulaId, ChooseStorageMode(payload));
                if (existing != null)
                {
                    string existingXml;
                    try { existingXml = (string)existing.GetType().GetProperty("XML")?.GetValue(existing); }
                    catch { existingXml = ""; }

                    var xdoc = ParseOrCreate(existingXml);
                    var root = xdoc.Root!;
                    var oldEntry = root.Elements()
                        .FirstOrDefault(e => (string?)e.Attribute("id") == payload.FormulaId);
                    if (oldEntry != null)
                        oldEntry.Remove();

                    root.Add(BuildEntryElement(payload, locator));

                    xml = xdoc.ToString(SaveOptions.DisableFormatting);

                    // Add new Part first, then delete old Part (avoid orphan on failure)
                    customXmlParts.Add(xml);
                    try { existing.Delete(); } catch { }
                }
                else
                {
                    var xdoc = XDocument.Parse($"<?xml version=\"1.0\" encoding=\"UTF-8\"?><lsno:manifest xmlns:lsno=\"{NamespaceUri}\" />");
                    xdoc.Root!.Add(BuildEntryElement(payload, locator));
                    xml = xdoc.ToString(SaveOptions.DisableFormatting);
                    customXmlParts.Add(xml);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FormulaManifest] WriteEntry failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Remove a formula entry from the manifest on a Workbook/Presentation.
        /// </summary>
        public static void RemoveEntry(dynamic customXmlParts, string formulaId)
        {
            try
            {
                for (int i = customXmlParts.Count; i >= 1; i--)
                {
                    dynamic part = customXmlParts[i];
                    try
                    {
                        if ((string?)part.NamespaceURI != NamespaceUri)
                            continue;

                        string existingXml;
                        try { existingXml = (string)part.GetType().GetProperty("XML")?.GetValue(part); }
                        catch { existingXml = ""; }

                        if (string.IsNullOrEmpty(existingXml))
                            continue;

                        var xdoc = XDocument.Parse(existingXml);
                        var entry = xdoc.Root?.Elements()
                            .FirstOrDefault(e => (string?)e.Attribute("id") == formulaId);
                        if (entry == null)
                            return;

                        entry.Remove();

                        try { part.Delete(); } catch { }
                        customXmlParts.Add(xdoc.ToString(SaveOptions.DisableFormatting));
                        return;
                    }
                    catch { }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FormulaManifest] RemoveEntry failed: {ex.Message}");
            }
        }

        private static XElement BuildEntryElement(FormulaPayload payload, FormulaObjectLocator? locator = null)
        {
            locator ??= FormulaObjectLocator.FromFormulaId("word", payload.FormulaId, ChooseStorageMode(payload));
            return new XElement("formula",
                new XAttribute("id", payload.FormulaId),
                new XAttribute("revision", payload.Revision),
                new XAttribute("storageMode", ChooseStorageMode(payload)),
                new XAttribute("schemaVersion", payload.SchemaVersion),
                new XElement("latex", payload.Latex ?? ""),
                new XElement("display", payload.Display ?? "inline"),
                new XElement("locator",
                    new XAttribute("host", locator.Host),
                    new XAttribute("objectName", locator.ObjectName),
                    new XAttribute("kind", locator.Kind),
                    string.IsNullOrEmpty(locator.Container) ? null :
                        new XAttribute("container", locator.Container)
                ),
                new XElement("payload", SerializePayloadJson(payload))
            );
        }

        private static string SerializePayloadJson(FormulaPayload payload)
        {
            try
            {
                var json = System.Text.Json.JsonSerializer.Serialize(payload, new System.Text.Json.JsonSerializerOptions
                {
                    DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
                });
                return Convert.ToBase64String(Encoding.UTF8.GetBytes(json));
            }
            catch
            {
                return "";
            }
        }
    }
}

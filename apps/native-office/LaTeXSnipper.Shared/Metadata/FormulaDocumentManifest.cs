#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;
using System.Runtime.InteropServices;
using Office = Microsoft.Office.Core;

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
    public static partial class FormulaDocumentManifest
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
                using var store = new CustomXmlManifestReplacementStore(doc.CustomXMLParts, ownsParts: true);
                FormulaManifestReplacement.Write(store, payload);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FormulaManifest] Write failed: {ex.Message}");
                OfficeOperationLog.Failure("write-word-manifest", "word", payload?.FormulaId, ex);
                throw;
            }
        }

        internal static XElement BuildWordEntryElement(FormulaPayload payload) =>
            new XElement("formula",
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
                );

        /// <summary>
        /// Read a formula entry from the manifest by formulaId.
        /// Returns null if not found.
        /// </summary>
        public static FormulaPayload? Read(Microsoft.Office.Interop.Word.Document doc, string formulaId)
        {
            try
            {
                using var store = new CustomXmlManifestReplacementStore(doc.CustomXMLParts, ownsParts: true);
                return FormulaManifestReader.Read(store.ReadOriginal(), formulaId);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FormulaManifest] Read({formulaId}) failed: {ex.Message}");
                OfficeOperationLog.Failure("read-word-manifest", "word", formulaId, ex);
                throw;
            }
        }

        /// <summary>
        /// Read the entire manifest as a dictionary.
        /// </summary>
        public static Dictionary<string, FormulaPayload> ReadAll(Microsoft.Office.Interop.Word.Document doc)
        {
            try
            {
                using var store = new CustomXmlManifestReplacementStore(doc.CustomXMLParts, ownsParts: true);
                return FormulaManifestReader.ReadAll(store.ReadOriginal());
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FormulaManifest] ReadAll failed: {ex.Message}");
                OfficeOperationLog.Failure("read-all-word-manifest", "word", null, ex);
                throw;
            }
        }

        /// <summary>
        /// Remove a formula from the manifest by formulaId.
        /// </summary>
        public static void Remove(Microsoft.Office.Interop.Word.Document doc, string formulaId)
        {
            try
            {
                using var store = new CustomXmlManifestReplacementStore(doc.CustomXMLParts, ownsParts: true);
                FormulaManifestReplacement.Remove(store, formulaId);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FormulaManifest] Remove failed: {ex.Message}");
                OfficeOperationLog.Failure("remove-word-manifest", "word", formulaId, ex);
                throw;
            }
        }

        /// <summary>
        /// Find the manifest CustomXMLPart, or null if it doesn't exist.
        /// </summary>
        public static dynamic? FindPart(Microsoft.Office.Interop.Word.Document doc)
        {
            var parts = doc.CustomXMLParts;
            try { return FindUniquePart(parts); }
            finally { Marshal.ReleaseComObject(parts); }
        }

        // ── Private helpers ──

        private static string ChooseStorageMode(FormulaPayload payload)
        {
            if (!string.IsNullOrEmpty(payload.StorageMode))
                return payload.StorageMode!;
            return "native-omml";
        }

        private static string ComputeSha256(string input)
        {
            using var sha = SHA256.Create();
            var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(input));
            return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
        }

        // ── Excel/PowerPoint manifest helpers (via document-level CustomXML) ──

        /// <summary>
        /// Excel-specific: find manifest part on a Workbook.
        /// </summary>
        public static object? FindPartWorksheet(dynamic workbook)
        {
            Office.CustomXMLParts parts = workbook.CustomXMLParts;
            try { return FindUniquePart(parts); }
            finally { Marshal.ReleaseComObject(parts); }
        }

        /// <summary>
        /// PowerPoint-specific: find manifest part on a Presentation.
        /// </summary>
        public static object? FindPartPresentation(dynamic presentation)
        {
            return FindPartWorksheet(presentation);
        }

        private static Office.CustomXMLPart? FindUniquePart(Office.CustomXMLParts parts)
        {
            var matches = parts.SelectByNamespace(NamespaceUri);
            try
            {
                if (matches.Count > 1) throw new InvalidOperationException("MANIFEST_PART_AMBIGUOUS");
                return matches.Count == 0 ? null : matches[1];
            }
            finally { Marshal.ReleaseComObject(matches); }
        }

        public static Dictionary<string, FormulaPayload> ReadAllEntries(Office.CustomXMLParts parts)
        {
            using var store = new CustomXmlManifestReplacementStore(parts);
            return FormulaManifestReader.ReadAll(store.ReadOriginal());
        }

        /// <summary>
        /// Write a formula entry to the manifest on a Workbook/Presentation.
        /// </summary>
        public static void WriteEntry(dynamic customXmlParts, FormulaPayload payload, string host = "excel")
        {
            try
            {
                // The caller retains ownership of this supplied collection.
                using var store = new CustomXmlManifestReplacementStore((Microsoft.Office.Core.CustomXMLParts)customXmlParts);
                FormulaManifestReplacement.Write(store, payload, host);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FormulaManifest] WriteEntry failed: {ex.Message}");
                OfficeOperationLog.Failure("write-manifest", host, payload?.FormulaId, ex);
                throw;
            }
        }

        public static IFormulaManifestReplacementStore OpenReplacementStore(Microsoft.Office.Core.CustomXMLParts parts)
            => new CustomXmlManifestReplacementStore(parts);

        /// <summary>
        /// Remove a formula entry from the manifest on a Workbook/Presentation.
        /// </summary>
        public static void RemoveEntry(dynamic customXmlParts, string formulaId, string host = "excel")
        {
            try
            {
                using var store = new CustomXmlManifestReplacementStore((Office.CustomXMLParts)customXmlParts);
                FormulaManifestReplacement.Remove(store, formulaId, host);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FormulaManifest] RemoveEntry failed: {ex.Message}");
                OfficeOperationLog.Failure("remove-manifest", host, formulaId, ex);
                throw;
            }
        }

        internal static XElement BuildEntryElement(FormulaPayload payload, FormulaObjectLocator? locator = null)
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

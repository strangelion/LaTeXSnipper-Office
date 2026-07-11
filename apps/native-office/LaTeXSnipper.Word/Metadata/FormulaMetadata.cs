#nullable enable
using System;
using System.Linq;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Metadata;

namespace LaTeXSnipper.Word.Metadata
{
    /// <summary>
    /// Thin wrapper around FormulaDocumentManifest for Word.
    /// Keeps existing call sites unchanged while switching from
    /// per-formula CustomXMLParts to a single-document manifest.
    /// </summary>
    internal static class FormulaMetadata
    {
        public static void Write(Microsoft.Office.Interop.Word.Document doc, string formulaId, FormulaPayload payload)
        {
            payload.FormulaId = formulaId;
            payload.Revision++;
            FormulaDocumentManifest.Write(doc, payload);
        }

        /// <summary>
        /// Read formula metadata by ContentControl Tag (precise lookup).
        /// No longer reads "most recent" CustomXMLPart.
        /// </summary>
        public static FormulaPayload? Read(Microsoft.Office.Interop.Word.Range range)
        {
            try
            {
                var doc = range.Document;
                var formulaId = FindFormulaIdAtRange(range);
                if (string.IsNullOrEmpty(formulaId))
                {
                    // Fallback: try reading from the manifest by finding
                    // the nearest content control
                    var cc = range.ContentControls;
                    if (cc != null && cc.Count > 0)
                    {
                        var tag = cc[1].Tag as string;
                        formulaId = ExtractFormulaIdFromTag(tag);
                    }
                }

                if (string.IsNullOrEmpty(formulaId))
                    return null;

                return FormulaDocumentManifest.Read(doc, formulaId);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FormulaMetadata] Read failed: {ex.Message}");
                return null;
            }
        }

        public static void Update(Microsoft.Office.Interop.Word.Document doc, string formulaId, FormulaPayload payload)
        {
            payload.FormulaId = formulaId;
            payload.Revision++;
            FormulaDocumentManifest.Write(doc, payload);
        }

        public static void Remove(Microsoft.Office.Interop.Word.Document doc, string formulaId)
        {
            FormulaDocumentManifest.Remove(doc, formulaId);
        }

        /// <summary>
        /// Find the formulaId from a ContentControl tag at or near the range.
        /// </summary>
        internal static string FindFormulaIdAtRange(Microsoft.Office.Interop.Word.Range range)
        {
            try
            {
                var cc = range.ContentControls;
                if (cc != null && cc.Count > 0)
                {
                    var tag = cc[1].Tag as string;
                    var id = ExtractFormulaIdFromTag(tag);
                    if (!string.IsNullOrEmpty(id))
                        return id;
                }

                // Check parent content controls (cursor may be deep inside OMath)
                var parent = range.ParentContentControl;
                if (parent != null)
                {
                    var tag = parent.Tag as string;
                    return ExtractFormulaIdFromTag(tag) ?? "";
                }
            }
            catch (Exception ex) { OfficeOperationLog.Failure("read-formula-metadata", "word", null, ex); }
            return "";
        }

        internal static string? ExtractFormulaIdFromTag(string? tag)
        {
            if (string.IsNullOrEmpty(tag)) return null;
            const string prefix = "latexsnipper:formula:";
            if (tag.StartsWith(prefix))
                return tag.Substring(prefix.Length);
            return null;
        }
    }
}

#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;

namespace LaTeXSnipper.NativeOffice.Shared.Metadata;

/// <summary>Result of a ValidateAndRepair scan.</summary>
public class ManifestValidationReport
{
    public int TotalEntries { get; set; }
    public int ObjectsFound { get; set; }
    public int OrphanEntries { get; set; }
    public int MissingManifestEntries { get; set; }
    public int RepairedCount { get; set; }
    public List<string> Issues { get; set; } = new();
    public bool IsConsistent => OrphanEntries == 0 && MissingManifestEntries == 0;
}

/// <summary>
/// Diagnostic scanner that verifies manifest entries match actual document objects.
/// Supports Word (ContentControls), Excel (Shapes), and PowerPoint (Shapes).
/// </summary>
public static class ManifestDiagnostics
{
    /// <summary>
    /// Validate Word document: checks manifest entries against ContentControls with latexsnipper: tags.
    /// Optionally removes orphan manifest entries (entries with no matching ContentControl).
    /// </summary>
    public static ManifestValidationReport ValidateWord(
        Microsoft.Office.Interop.Word.Document doc,
        bool repairOrphans = true)
    {
        var report = new ManifestValidationReport();

        try
        {
            // Collect all manifest formula IDs
            var manifestEntries = FormulaDocumentManifest.ReadAll(doc);
            report.TotalEntries = manifestEntries.Count;

            // Collect all ContentControl formula IDs from the document
            var docFormulaIds = new HashSet<string>();
            foreach (Microsoft.Office.Interop.Word.ContentControl cc in doc.ContentControls)
            {
                var tag = cc.Tag as string;
                if (string.IsNullOrEmpty(tag)) continue;

                const string prefix = "latexsnipper:formula:";
                if (tag.StartsWith(prefix) && tag.Length > prefix.Length)
                {
                    docFormulaIds.Add(tag.Substring(prefix.Length));
                }
            }

            report.ObjectsFound = docFormulaIds.Count;

            // Find orphan entries (in manifest but not in document)
            var orphanIds = new List<string>();
            foreach (var id in manifestEntries.Keys)
            {
                if (!docFormulaIds.Contains(id))
                {
                    orphanIds.Add(id);
                    report.Issues.Add($"Orphan manifest entry: formulaId={id}");
                }
            }
            report.OrphanEntries = orphanIds.Count;

            // Find missing entries (in document but not in manifest)
            foreach (var id in docFormulaIds)
            {
                if (!manifestEntries.ContainsKey(id))
                {
                    report.Issues.Add($"Missing manifest entry: formulaId={id}");
                }
            }
            report.MissingManifestEntries = docFormulaIds.Count - manifestEntries.Keys.Intersect(docFormulaIds).Count();

            // Repair: remove orphan entries
            if (repairOrphans && orphanIds.Count > 0)
            {
                foreach (var id in orphanIds)
                {
                    FormulaDocumentManifest.Remove(doc, id);
                }
                report.RepairedCount = orphanIds.Count;
            }
        }
        catch (Exception ex)
        {
            report.Issues.Add($"Validation error: {ex.Message}");
        }

        return report;
    }

    /// <summary>
    /// Validate Excel workbook: checks manifest entries against shapes with LSNO_ prefix.
    /// </summary>
    public static ManifestValidationReport ValidateExcel(
        dynamic workbook,
        string host = "excel",
        bool repairOrphans = true)
    {
        var report = new ManifestValidationReport();

        try
        {
            var part = FormulaDocumentManifest.FindPartWorksheet(workbook);
            if (part == null)
            {
                report.Issues.Add("No manifest found in workbook");
                return report;
            }

            // Read manifest entries (use a simpler manual parse since ReadAll only supports Word)
            string? xml;
            try { xml = (string?)part.GetType().GetProperty("XML")?.GetValue(part); }
            catch { xml = null; }

            if (string.IsNullOrEmpty(xml))
            {
                report.Issues.Add("Manifest XML is empty");
                return report;
            }

            var xdoc = System.Xml.Linq.XDocument.Parse(xml);
            var manifestIds = new HashSet<string>();
            foreach (var entry in xdoc.Root?.Elements() ?? Enumerable.Empty<System.Xml.Linq.XElement>())
            {
                var id = (string?)entry.Attribute("id");
                if (!string.IsNullOrEmpty(id))
                    manifestIds.Add(id);
            }
            report.TotalEntries = manifestIds.Count;

            // Collect shape names with LSNO_ prefix across all worksheets
            var docFormulaIds = new HashSet<string>();
            try
            {
                foreach (var sheet in workbook.Sheets)
                {
                    try
                    {
                        var shapes = sheet.Shapes;
                        if (shapes == null) continue;
                        for (int i = 1; i <= shapes.Count; i++)
                        {
                            try
                            {
                                var shape = shapes[i];
                                string? name = shape.Name;
                                if (!string.IsNullOrEmpty(name) && name.StartsWith("LSNO_") && name.Length > 5)
                                {
                                    docFormulaIds.Add(name.Substring(5));
                                }
                            }
                            catch { }
                        }
                    }
                    catch { }
                }
            }
            catch { }

            report.ObjectsFound = docFormulaIds.Count;

            // Find orphans
            foreach (var id in manifestIds)
            {
                if (!docFormulaIds.Contains(id))
                {
                    report.Issues.Add($"Orphan manifest entry: formulaId={id}");
                }
            }
            report.OrphanEntries = manifestIds.Except(docFormulaIds).Count();
            report.MissingManifestEntries = docFormulaIds.Except(manifestIds).Count();

            // Repair
            if (repairOrphans)
            {
                foreach (var id in manifestIds.Except(docFormulaIds).ToList())
                {
                    FormulaDocumentManifest.RemoveEntry(workbook.CustomXMLParts, id);
                    report.RepairedCount++;
                }
            }
        }
        catch (Exception ex)
        {
            report.Issues.Add($"Validation error: {ex.Message}");
        }

        return report;
    }

    /// <summary>
    /// Validate PowerPoint presentation: checks manifest entries against shapes with LSNO_ prefix.
    /// </summary>
    public static ManifestValidationReport ValidatePowerPoint(
        dynamic presentation,
        string host = "powerpoint",
        bool repairOrphans = true)
    {
        return ValidateExcel(presentation, host, repairOrphans);
    }
}

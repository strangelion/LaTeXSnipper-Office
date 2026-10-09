#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using Office = Microsoft.Office.Core;
using Word = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.NativeOffice.Shared.Metadata;

public class ManifestValidationReport
{
    public int TotalEntries { get; set; }
    public int ObjectsFound { get; set; }
    public int OrphanEntries { get; set; }
    public int MissingManifestEntries { get; set; }
    public int RepairedCount { get; set; }
    public int DuplicateObjectIds { get; set; }
    public bool ScanComplete { get; set; }
    public bool HasErrors { get; set; }
    public List<string> Issues { get; set; } = new();
    public bool IsConsistent => ScanComplete && !HasErrors && DuplicateObjectIds == 0 && OrphanEntries == 0 && MissingManifestEntries == 0;
}

/// <summary>Read-only by default. Never repair from a partial or ambiguous object inventory.</summary>
public static class ManifestDiagnostics
{
    public static ManifestValidationReport ValidateWord(Word.Document doc, bool repairOrphans = false)
    {
        var report = new ManifestValidationReport();
        try
        {
            var entries = FormulaDocumentManifest.ReadAll(doc);
            var ids = new List<string>();
            var seenControls = new HashSet<string>(StringComparer.Ordinal);
            Word.StoryRanges? stories = null;
            try
            {
                stories = doc.StoryRanges;
                foreach (Word.Range first in stories)
                {
                    Word.Range? story = first;
                    try
                    {
                        while (story != null)
                        {
                            var controls = story.ContentControls;
                            try
                            {
                                for (int index = 1; index <= controls.Count; index++)
                                {
                                    var control = controls[index];
                                    try
                                    {
                                        if (!seenControls.Add(control.ID)) continue;
                                        string tag = control.Tag ?? "";
                                        const string prefix = "latexsnipper:formula:";
                                        if (tag.StartsWith(prefix, StringComparison.Ordinal)) ids.Add(tag.Substring(prefix.Length));
                                    }
                                    finally { Release(control); }
                                }
                            }
                            finally { Release(controls); }
                            var next = story.NextStoryRange; Release(story); story = next;
                        }
                    }
                    finally { Release(story); }
                }
            }
            finally { Release(stories); }
            Complete(report, entries, ids, repairOrphans, id => FormulaDocumentManifest.Remove(doc, id));
        }
        catch (Exception error) { Fail(report, error); }
        return report;
    }

    public static ManifestValidationReport ValidateExcel(dynamic workbook, string host = "excel", bool repairOrphans = false)
        => ValidateShapes(workbook, host, powerpoint: false, repairOrphans: repairOrphans);

    public static ManifestValidationReport ValidatePowerPoint(dynamic presentation, string host = "powerpoint", bool repairOrphans = false)
        => ValidateShapes(presentation, host, powerpoint: true, repairOrphans: repairOrphans);

    private static ManifestValidationReport ValidateShapes(dynamic document, string host, bool powerpoint, bool repairOrphans)
    {
        var report = new ManifestValidationReport();
        Office.CustomXMLParts? parts = null;
        try
        {
            if (host != (powerpoint ? "powerpoint" : "excel")) throw new InvalidOperationException("MANIFEST_HOST_INVALID");
            parts = document.CustomXMLParts;
            var entries = FormulaDocumentManifest.ReadAllEntries(parts);
            List<string> ids = ReadShapeInventory((object)document, powerpoint, entries);
            Complete(report, entries, ids, repairOrphans, id => FormulaDocumentManifest.RemoveEntry(parts, id, host));
        }
        catch (Exception error) { Fail(report, error); }
        finally { Release(parts); }
        return report;
    }

    public static List<string> ReadShapeInventory(dynamic document, bool powerpoint, Dictionary<string, FormulaPayload> entries)
    {
        object? containers = null;
        var ids = new List<string>();
        try
        {
            containers = powerpoint ? document.Slides : document.Sheets;
            dynamic collection = containers;
            for (int index = 1; index <= collection.Count; index++)
            {
                object container = collection.Item(index);
                object? shapes = null;
                try { shapes = ((dynamic)container).Shapes; CollectShapes(shapes, entries, ids, 0); }
                finally { Release(shapes); Release(container); }
            }
            return ids;
        }
        finally { Release(containers); }
    }

    private static void CollectShapes(object values, Dictionary<string, FormulaPayload> entries, List<string> ids, int depth)
    {
        if (depth > 64) throw new InvalidOperationException("MANIFEST_OBJECT_SCAN_DEPTH_EXCEEDED");
        dynamic shapes = values;
        for (int index = 1; index <= shapes.Count; index++)
        {
            object shape = shapes.Item(index);
            try
            {
                dynamic item = shape;
                string name = item.Name ?? "", text = item.AlternativeText ?? "";
                string? namedId = name.StartsWith("LSNO_", StringComparison.Ordinal) ? name.Substring(5) : null;
                FormulaPayload? metadata = text.StartsWith("{", StringComparison.Ordinal)
                    ? JsonSerializer.Deserialize<FormulaPayload>(text, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) : null;
                string? payloadId = metadata?.FormulaId;
                if (!string.IsNullOrEmpty(payloadId))
                {
                    if (FormulaIdHelper.IsCanonical(namedId ?? "") && namedId != payloadId)
                        throw new InvalidOperationException("MANIFEST_OBJECT_ID_CONFLICT");
                    ids.Add(payloadId!);
                }
                else if (!string.IsNullOrEmpty(namedId))
                {
                    if (!FormulaIdHelper.IsCanonical(namedId!) && !entries.ContainsKey(namedId!))
                        throw new InvalidOperationException("MANIFEST_OBJECT_ID_UNVERIFIED");
                    ids.Add(namedId!);
                }
                if ((int)item.Type == (int)Office.MsoShapeType.msoGroup)
                {
                    object group = item.GroupItems;
                    try { CollectShapes(group, entries, ids, depth + 1); }
                    finally { Release(group); }
                }
            }
            finally { Release(shape); }
        }
    }

    // Pure inventory boundary, also exercised with deliberately failing iterators.
    public static ManifestValidationReport ValidateInventory(Dictionary<string, FormulaPayload> entries, IEnumerable<string> ids,
        bool repairOrphans = false, Action<string>? remove = null)
    {
        var report = new ManifestValidationReport();
        try { Complete(report, entries, ids, repairOrphans, remove ?? (_ => throw new InvalidOperationException("MANIFEST_REPAIR_UNAVAILABLE"))); }
        catch (Exception error) { Fail(report, error); }
        return report;
    }

    private static void Complete(ManifestValidationReport report, Dictionary<string, FormulaPayload> entries,
        IEnumerable<string> inventory, bool repair, Action<string> remove)
    {
        report.TotalEntries = entries.Count;
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (string id in inventory)
        {
            if (string.IsNullOrWhiteSpace(id) || id.Length > 256) throw new InvalidOperationException("MANIFEST_OBJECT_ID_INVALID");
            counts[id] = counts.TryGetValue(id, out int count) ? count + 1 : 1;
        }
        report.ScanComplete = true;
        report.ObjectsFound = counts.Count;
        report.DuplicateObjectIds = counts.Count(pair => pair.Value > 1);
        var orphans = entries.Keys.Except(counts.Keys, StringComparer.Ordinal).ToList();
        report.OrphanEntries = orphans.Count;
        report.MissingManifestEntries = counts.Keys.Except(entries.Keys, StringComparer.Ordinal).Count();
        foreach (string id in orphans) report.Issues.Add("Orphan manifest entry: " + id);
        if (report.DuplicateObjectIds != 0)
        {
            report.HasErrors = true; report.Issues.Add("MANIFEST_OBJECT_ID_AMBIGUOUS: repair refused.");
            return;
        }
        if (repair)
            foreach (string id in orphans) { remove(id); report.RepairedCount++; report.OrphanEntries--; }
    }

    private static void Fail(ManifestValidationReport report, Exception error)
    {
        report.HasErrors = true; report.Issues.Add("Validation error: " + error.Message);
    }
    private static void Release(object? value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
}

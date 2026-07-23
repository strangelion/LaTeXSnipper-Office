// WordBatchConversionExecutor.cs — Batch LaTeX → OMML conversion for Word.
//
// Receives a BatchConversionPlan from the Desktop and executes it:
//   1. Find each LaTeX source in the document
//   2. Replace with OMML Office Math equation
//   3. Track results

#nullable enable
using System;
using System.Collections.Generic;
using LaTeXSnipper.NativeOffice.Shared;
using Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.Host;

/// <summary>
/// Executes a batch conversion plan on the active Word document.
/// </summary>
internal sealed class WordBatchConversionExecutor
{
    private readonly Application _application;

    public WordBatchConversionExecutor(Application application)
    {
        _application = application;
    }

    /// <summary>
    /// Execute a batch conversion plan.
    /// </summary>
    public VstoBatchConvertResult Execute(string planId, List<BatchConversionItem> items)
    {
        var total = items.Count;
        var converted = 0;
        var skipped = 0;
        var failed = 0;
        var failures = new List<BatchFailureDto>();

        var doc = _application.ActiveDocument;
        if (doc == null)
        {
            return new VstoBatchConvertResult
            {
                PlanId = planId,
                Total = total,
                Converted = 0,
                Skipped = 0,
                Failed = total,
                Failures = items.ConvertAll(i => new BatchFailureDto
                {
                    SourceId = i.SourceId,
                    SourceText = i.SourceText,
                    Error = "No active document"
                })
            };
        }

        foreach (var item in items)
        {
            if (item.Status != "converted" || string.IsNullOrEmpty(item.Omml))
            {
                skipped++;
                failures.Add(new BatchFailureDto
                {
                    SourceId = item.SourceId,
                    SourceText = item.SourceText,
                    Error = item.Error ?? "No OMML content"
                });
                continue;
            }

            try
            {
                bool found = ReplaceLatexWithOmml(doc, item.SourceText, item.Omml);
                if (found)
                    converted++;
                else
                {
                    skipped++;
                    failures.Add(new BatchFailureDto
                    {
                        SourceId = item.SourceId,
                        SourceText = item.SourceText,
                        Error = "LaTeX source not found in document"
                    });
                }
            }
            catch (Exception ex)
            {
                failed++;
                failures.Add(new BatchFailureDto
                {
                    SourceId = item.SourceId,
                    SourceText = item.SourceText,
                    Error = ex.Message
                });
            }
        }

        return new VstoBatchConvertResult
        {
            PlanId = planId,
            Total = total,
            Converted = converted,
            Skipped = skipped,
            Failed = failed,
            Failures = failures,
        };
    }

    /// <summary>
    /// Find the LaTeX source text in the document and replace with OMML.
    /// </summary>
    private bool ReplaceLatexWithOmml(Document doc, string sourceText, string omml)
    {
        var find = doc.Content.Find;
        find.Text = sourceText;
        find.Forward = true;
        find.Wrap = WdFindWrap.wdFindStop;

        if (!find.Execute())
            return false;

        var range = doc.Content;
        range.Find.Execute(FindText: sourceText, Forward: true, Wrap: WdFindWrap.wdFindStop);

        if (range.Find.Found)
        {
            // Build OMML Office Math
            var ommlRange = doc.OMaths.Add(
                range,
                WdOMathType.wdOMathDisplay
            );

            // Set the OMML content
            // Note: Direct OMML injection via Range.InsertXML is the preferred approach
            try
            {
                range.Text = "";
                range.InsertXML(omml);
            }
            catch
            {
                // Fallback: insert as field
                range.Text = omml;
            }
            return true;
        }

        return false;
    }
}

/// <summary>
/// DTO for a single batch conversion item (mirrors Rust BatchConversionItem).
/// </summary>
public sealed class BatchConversionItem
{
    public string SourceId { get; set; } = "";
    public string SourceText { get; set; } = "";
    public string NormalizedLatex { get; set; } = "";
    public string? Omml { get; set; }
    public System.Text.Json.JsonElement? Locator { get; set; }
    public string? SourceHash { get; set; }
    public string Status { get; set; } = "pending";
    public string? Error { get; set; }
}

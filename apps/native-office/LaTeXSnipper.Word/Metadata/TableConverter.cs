using System;
using System.Collections.Generic;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.Word.Metadata
{
    internal sealed class TableConverter
    {
        private readonly Microsoft.Office.Interop.Word.Application _app;

        public TableConverter(Microsoft.Office.Interop.Word.Application app)
        {
            _app = app;
        }

        public bool IsInTable()
        {
            try
            {
                return _app.Selection.Range.Tables.Count > 0;
            }
            catch
            {
                return false;
            }
        }

        public TablePayload? ReadSelection()
        {
            var range = _app.Selection.Range;
            if (range == null || range.Tables.Count == 0)
                return null;

            var wordTable = range.Tables[1];
            return ConvertFromWordTable(wordTable);
        }

        public TablePayload ConvertFromWordTable(Microsoft.Office.Interop.Word.Table wordTable)
        {
            var tableId = Guid.NewGuid().ToString("N");
            var rows = new List<TableRow>();
            var formulas = new Dictionary<string, FormulaPayload>();

            for (int r = 1; r <= wordTable.Rows.Count; r++)
            {
                var row = new TableRow();
                var cells = new List<TableCell>();

                for (int c = 1; c <= wordTable.Columns.Count; c++)
                {
                    try
                    {
                        var cell = wordTable.Cell(r, c);
                        var result = ConvertCell(cell);
                        cells.Add(result.Item1);
                        foreach (var kvp in result.Item2)
                        {
                            formulas[kvp.Key] = kvp.Value;
                        }
                    }
                    catch
                    {
                        cells.Add(new TableCell
                        {
                            Rowspan = 1, Colspan = 1,
                            Inlines = new List<InlineContent> { new InlineText { Text = "" } }
                        });
                    }
                }

                row.Cells = cells;
                rows.Add(row);
            }

            return new TablePayload
            {
                TableId = tableId,
                Table = new TableBlock
                {
                    Rows = rows,
                    Properties = new TableProperties { Layout = "autofit" }
                },
                Formulas = formulas.Count > 0 ? formulas : null
            };
        }

        private Tuple<TableCell, Dictionary<string, FormulaPayload>> ConvertCell(
            Microsoft.Office.Interop.Word.Cell cell)
        {
            var inlines = new List<InlineContent>();
            var formulas = new Dictionary<string, FormulaPayload>();
            var range = cell.Range;

            // Get cell properties
            uint rowspan = 1, colspan = 1;
            try
            {
                var xml = range.XML;
                int gs = xml.IndexOf("w:gridSpan");
                if (gs >= 0)
                {
                    var valStart = xml.IndexOf("w:val=\"", gs) + 7;
                    var valEnd = xml.IndexOf("\"", valStart);
                    if (valStart > 6 && valEnd > valStart)
                        colspan = uint.Parse(xml.Substring(valStart, valEnd - valStart));
                }
            }
            catch { }

            // Process each paragraph in the cell
            foreach (Microsoft.Office.Interop.Word.Paragraph para in range.Paragraphs)
            {
                var paraRange = para.Range;
                // Strip end-of-cell marker (\a = char 7) and trim whitespace
                var rawText = paraRange.Text ?? "";
                var cleanText = rawText.TrimEnd('\r', '\n', (char)7).Trim();
                if (string.IsNullOrEmpty(cleanText))
                    continue;

                // Check for OMath in this paragraph
                if (paraRange.OMaths.Count > 0)
                {
                    foreach (Microsoft.Office.Interop.Word.OMath oMath in paraRange.OMaths)
                    {
                        var text = oMath.Range.Text?.Trim();
                        if (!string.IsNullOrEmpty(text))
                        {
                            var formulaId = Guid.NewGuid().ToString("N").Substring(0, 12);
                            formulas[formulaId] = new FormulaPayload
                            {
                                FormulaId = formulaId,
                                Latex = text,
                                Omml = "",
                                Display = "inline"
                            };
                            inlines.Add(new InlineFormula
                            {
                                FormulaRef = formulaId
                            });
                        }
                    }
                }
                else
                {
                    inlines.Add(new InlineText { Text = cleanText });
                }
            }

            if (inlines.Count == 0)
                inlines.Add(new InlineText { Text = "" });

            return Tuple.Create(
                new TableCell { Rowspan = rowspan, Colspan = colspan, Inlines = inlines },
                formulas
            );
        }

        public bool InsertTable(TablePayload payload)
        {
            try
            {
                var range = _app.Selection.Range;
                if (payload.Table.Rows.Count == 0) return false;

                int rows = payload.Table.Rows.Count;
                int cols = 0;
                foreach (var r in payload.Table.Rows)
                {
                    if (r.Cells.Count > cols) cols = r.Cells.Count;
                }
                if (cols == 0) return false;

                var wordTable = range.Tables.Add(range, rows, cols);
                wordTable.Range.ParagraphFormat.SpaceBefore = 0;
                wordTable.Range.ParagraphFormat.SpaceAfter = 0;

                for (int r = 1; r <= rows && r <= payload.Table.Rows.Count; r++)
                {
                    var rowData = payload.Table.Rows[r - 1];
                    for (int c = 1; c <= cols && c <= rowData.Cells.Count; c++)
                    {
                        var cellData = rowData.Cells[c - 1];
                        var cell = wordTable.Cell(r, c);
                        var cellRange = cell.Range;
                        cellRange.Text = "";

                        foreach (var inline in cellData.Inlines)
                        {
                            if (inline is InlineText textInline)
                            {
                                cellRange.InsertAfter(textInline.Text);
                                cellRange.Collapse(
                                    Microsoft.Office.Interop.Word.WdCollapseDirection.wdCollapseEnd);
                            }
                            else if (inline is InlineFormula formulaInline)
                            {
                                string latex = "";
                                if (payload.Formulas != null &&
                                    payload.Formulas.TryGetValue(formulaInline.FormulaRef, out var fPayload))
                                {
                                    latex = fPayload.Latex ?? "";
                                }

                                if (!string.IsNullOrEmpty(latex))
                                {
                                    // Use OMaths.Add + TypeText + BuildUp like WordAdapter
                                    cellRange.Text = "";
                                    _app.Selection.SetRange(cellRange.Start, cellRange.End);
                                    _app.Selection.OMaths.Add(cellRange);
                                    _app.Selection.TypeText(latex);
                                    try { _app.Selection.OMaths.BuildUp(); } catch { }
                                }
                                else
                                {
                                    cellRange.InsertAfter("[Formula]");
                                }
                                cellRange.Collapse(
                                    Microsoft.Office.Interop.Word.WdCollapseDirection.wdCollapseEnd);
                            }
                        }
                    }
                }

                return true;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[TableConverter] Insert failed: {ex.Message}");
                return false;
            }
        }
    }
}

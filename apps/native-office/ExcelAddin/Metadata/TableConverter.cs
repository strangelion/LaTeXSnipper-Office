using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Office.Interop.Excel;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Excel.Metadata;

/// <summary>
/// Converts between Excel Tables (Range/ListObject) and LaTeXSnipper TableBlock structures.
/// 
/// Excel table model:
///   - Simple tables: native Range + ListObject
///   - Complex tables (merge cells): Range + MergeArea
///   - FormulaBlock in cells: anchored Shape
///   - WorksheetFormula (=SUM(...)): written to Range.Formula
/// </summary>
public class TableConverter
{
    private readonly Application _app;

    public TableConverter(Application app)
    {
        _app = app;
    }

    // ---------------------------------------------------------------------------
    // Read Excel Table → TableBlock
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Read the table at current selection and convert to TablePayload.
    /// </summary>
    public TablePayload? ReadSelection()
    {
        var range = _app.Selection as Range;
        if (range == null) return null;

        try
        {
            // Check if selection is part of a ListObject (table)
            if (range.ListObject != null)
            {
                return ConvertFromListObject(range.ListObject);
            }

            // Otherwise treat as a simple range
            if (range.Rows.Count > 1 || range.Columns.Count > 1)
            {
                return ConvertFromRange(range);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[TableConverter] ReadSelection failed: {ex.Message}");
        }

        return null;
    }

    /// <summary>
    /// Convert a ListObject to TablePayload.
    /// </summary>
    public TablePayload ConvertFromListObject(ListObject listObj)
    {
        var tableId = Guid.NewGuid().ToString("N");
        var rows = new List<TableRow>();

        for (int r = 1; r <= listObj.ListRows.Count; r++)
        {
            var row = new TableRow();
            var cells = new List<TableCell>();

            for (int c = 1; c <= listObj.ListColumns.Count; c++)
            {
                var cellRange = listObj.ListRows[r].Range.Columns[c] as Range;
                var cell = ConvertCell(cellRange);
                cells.Add(cell);
            }

            row.Cells = cells;
            rows.Add(row);
        }

        return new TablePayload
        {
            TableId = tableId,
            Table = new Shared.TableBlock
            {
                Rows = rows,
                Properties = new TableProperties { Layout = "autofit" }
            }
        };
    }

    /// <summary>
    /// Convert a Range to TablePayload.
    /// </summary>
    public TablePayload ConvertFromRange(Range range)
    {
        var tableId = Guid.NewGuid().ToString("N");
        var rows = new List<TableRow>();

        for (int r = 1; r <= range.Rows.Count; r++)
        {
            var row = new TableRow();
            var cells = new List<TableCell>();

            for (int c = 1; c <= range.Columns.Count; c++)
            {
                var cellRange = range.Cells[r, c] as Range;
                var cell = ConvertCell(cellRange);
                cells.Add(cell);
            }

            row.Cells = cells;
            rows.Add(row);
        }

        return new TablePayload
        {
            TableId = tableId,
            Table = new Shared.TableBlock
            {
                Rows = rows,
                Properties = new TableProperties { Layout = "autofit" }
            }
        };
    }

    private TableCell ConvertCell(Range? cellRange)
    {
        var inlines = new List<InlineContent>();

        if (cellRange != null)
        {
            var text = cellRange.Text?.ToString() ?? "";
            var formula = cellRange.Formula?.ToString() ?? "";

            // Check if cell has a formula shape
            var formulaId = FindFormulaShapeAtCell(cellRange);
            if (formulaId != null)
            {
                inlines.Add(new InlineFormula { FormulaRef = formulaId });
            }
            // Check if it's an Excel formula
            else if (formula.StartsWith("="))
            {
                inlines.Add(new InlineText { Text = formula });
            }
            // Plain text
            else if (!string.IsNullOrEmpty(text))
            {
                inlines.Add(new InlineText { Text = text });
            }
            else
            {
                inlines.Add(new InlineText { Text = "" });
            }
        }
        else
        {
            inlines.Add(new InlineText { Text = "" });
        }

        return new TableCell
        {
            Rowspan = 1,
            Colspan = 1,
            Inlines = inlines,
            Properties = new CellProperties
            {
                Background = GetCellBackground(cellRange),
                Alignment = GetCellAlignment(cellRange)
            }
        };
    }

    private string? FindFormulaShapeAtCell(Range cellRange)
    {
        try
        {
            var sheet = cellRange.Worksheet;
            var cellLeft = (double)cellRange.Left;
            var cellTop = (double)cellRange.Top;

            foreach (Shape shape in sheet.Shapes)
            {
                try
                {
                    var tagValue = shape.Tags.Item("LSNO_ID");
                    if (!string.IsNullOrEmpty(tagValue))
                    {
                        if (Math.Abs(shape.Left - cellLeft) < 50 &&
                            Math.Abs(shape.Top - cellTop) < 50)
                        {
                            return tagValue;
                        }
                    }
                }
                catch { }
            }
        }
        catch { }

        return null;
    }

    // ---------------------------------------------------------------------------
    // Write TableBlock → Excel Table
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Insert a table from TablePayload at current selection.
    /// </summary>
    public bool InsertTable(TablePayload payload)
    {
        var range = _app.Selection as Range;
        if (range == null) return false;

        try
        {
            var rows = payload.Table.Rows.Count;
            var cols = payload.Table.Rows.Max(r => r.Cells.Count);

            if (rows == 0 || cols == 0) return false;

            // Get target range
            var targetRange = range.Resize[rows, cols];

            // Check for merge cells
            bool hasMergeCells = payload.Table.Rows.Any(r =>
                r.Cells.Any(c => c.Colspan > 1 || c.Rowspan > 1));

            if (hasMergeCells)
            {
                InsertTableWithMerges(targetRange, payload);
            }
            else
            {
                InsertSimpleTable(targetRange, payload);
            }

            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[TableConverter] InsertTable failed: {ex.Message}");
            return false;
        }
    }

    private void InsertSimpleTable(Range targetRange, TablePayload payload)
    {
        // Fill cells
        for (int r = 0; r < payload.Table.Rows.Count; r++)
        {
            for (int c = 0; c < payload.Table.Rows[r].Cells.Count; c++)
            {
                var cell = payload.Table.Rows[r].Cells[c];
                var excelCell = targetRange.Cells[r + 1, c + 1] as Range;

                if (excelCell != null)
                {
                    WriteCellContent(excelCell, cell, payload);
                }
            }
        }

        // Create ListObject
        try
        {
            var listObj = targetRange.Worksheet.ListObjects.Add(
                XlSrcType.xlSrcRange,
                targetRange,
                Type.Missing,
                XlYesNoGuess.xlYes,
                Type.Missing
            );
            listObj.Name = $"LSNO_Table_{payload.TableId[..8]}";
        }
        catch
        {
            // ListObject creation may fail for some ranges
        }
    }

    private void InsertTableWithMerges(Range targetRange, TablePayload payload)
    {
        var sheet = targetRange.Worksheet;

        for (int r = 0; r < payload.Table.Rows.Count; r++)
        {
            for (int c = 0; c < payload.Table.Rows[r].Cells.Count; c++)
            {
                var cell = payload.Table.Rows[r].Cells[c];
                var excelCell = sheet.Cells[r + targetRange.Row, c + targetRange.Column] as Range;

                if (excelCell == null) continue;

                // Handle colspan
                if (cell.Colspan > 1)
                {
                    var mergeRange = sheet.Range[
                        excelCell,
                        sheet.Cells[r + targetRange.Row, c + targetRange.Column + cell.Colspan - 1]
                    ];
                    mergeRange.Merge();

                    // Apply vertical alignment
                    ApplyVerticalAlignment(excelCell, cell.Properties?.VerticalAlignment);

                    // Write content
                    WriteCellContent(excelCell, cell, payload);
                }
                else
                {
                    // Apply vertical alignment
                    ApplyVerticalAlignment(excelCell, cell.Properties?.VerticalAlignment);

                    // Write content
                    WriteCellContent(excelCell, cell, payload);
                }

                // Apply background color
                ApplyBackgroundColor(excelCell, cell.Properties?.Background);
            }
        }
    }

    private void WriteCellContent(Range cell, TableCell tableCell, TablePayload payload)
    {
        foreach (var inline in tableCell.Inlines)
        {
            switch (inline)
            {
                case InlineText text:
                    // Check if it's an Excel formula
                    if (text.Text.StartsWith("="))
                    {
                        cell.Formula = text.Text;
                    }
                    else
                    {
                        cell.Value2 = text.Text;
                    }
                    break;

                case InlineFormula formula:
                    // Try to get the actual FormulaPayload
                    FormulaPayload formulaPayload = null;
                    if (formula.Formula != null)
                    {
                        formulaPayload = formula.Formula;
                    }
                    else if (payload.Formulas != null && payload.Formulas.ContainsKey(formula.FormulaRef))
                    {
                        formulaPayload = payload.Formulas[formula.FormulaRef];
                    }

                    if (formulaPayload != null && formulaPayload.Render?.Svg != null)
                    {
                        // Save SVG to temp file and insert as picture
                        var tempPath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"lsno_table_{formulaPayload.FormulaId}.svg");
                        System.IO.File.WriteAllText(tempPath, formulaPayload.Render.Svg);

                        var shape = cell.Worksheet.Shapes.AddPicture(
                            tempPath,
                            Microsoft.Office.Core.MsoTriState.msoFalse,
                            Microsoft.Office.Core.MsoTriState.msoTrue,
                            (float)cell.Left,
                            (float)cell.Top,
                            formulaPayload.Render.WidthPt > 0 ? formulaPayload.Render.WidthPt : 100f,
                            formulaPayload.Render.HeightPt > 0 ? formulaPayload.Render.HeightPt : 30f
                        );
                        shape.Name = $"LSNO_FORMULA_{formulaPayload.FormulaId}";
                        shape.Tags.Add("LSNO_ID", formulaPayload.FormulaId);
                        shape.Placement = Microsoft.Office.Interop.Excel.XlPlacement.xlMoveAndSize;
                    }
                    else
                    {
                        // Fallback to placeholder
                        cell.Value2 = $"[{formula.FormulaRef}]";
                    }
                    break;
            }
        }
    }

    private void ApplyVerticalAlignment(Range cell, string? alignment)
    {
        if (alignment == null) return;

        cell.VerticalAlignment = alignment switch
        {
            "top" => XlVAlign.xlVAlignTop,
            "middle" => XlVAlign.xlVAlignCenter,
            "bottom" => XlVAlign.xlVAlignBottom,
            _ => XlVAlign.xlVAlignTop
        };
    }

    private void ApplyBackgroundColor(Range cell, string? background)
    {
        if (background == null || !background.StartsWith("#")) return;

        try
        {
            int r = Convert.ToInt32(background[1..3], 16);
            int g = Convert.ToInt32(background[3..5], 16);
            int b = Convert.ToInt32(background[5..7], 16);
            cell.Interior.Color = r + (g << 8) + (b << 16);
        }
        catch { }
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    private string GetCellBackground(Range? cell)
    {
        try
        {
            if (cell?.Interior?.Color != null)
            {
                int color = (int)cell.Interior.Color;
                int r = color & 0xFF;
                int g = (color >> 8) & 0xFF;
                int b = (color >> 16) & 0xFF;
                return $"#{r:X2}{g:X2}{b:X2}";
            }
        }
        catch { }
        return "#FFFFFF";
    }

    private string GetCellAlignment(Range? cell)
    {
        try
        {
            if (cell != null)
            {
                return cell.HorizontalAlignment switch
                {
                    XlHAlign.xlHAlignCenter => "center",
                    XlHAlign.xlHAlignRight => "right",
                    _ => "left"
                };
            }
        }
        catch { }
        return "left";
    }

    /// <summary>
    /// Check if the current selection is part of a table.
    /// </summary>
    public bool IsInTable()
    {
        var range = _app.Selection as Range;
        if (range == null) return false;

        try
        {
            return range.ListObject != null ||
                   range.Rows.Count > 1 ||
                   range.Columns.Count > 1;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Format a table range with borders and alignment.
    /// </summary>
    public void FormatTable(Range range)
    {
        try
        {
            range.Borders.LineStyle = XlLineStyle.xlContinuous;
            range.Borders.Weight = XlBorderWeight.xlThin;
            range.HorizontalAlignment = XlHAlign.xlHAlignCenter;
            range.VerticalAlignment = XlVAlign.xlVAlignCenter;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[TableConverter] FormatTable failed: {ex.Message}");
        }
    }
}

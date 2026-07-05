using System;
using System.Collections.Generic;
using System.IO;
using Microsoft.Office.Interop.Excel;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Excel;

/// <summary>
/// Core Excel operations for formula and table handling.
/// 
/// Formula model:
///   - Formula as Vector Shape anchored to cells
///   - Shape Tags store LSNO_ID for correlation
///   - Full data stored in Workbook.CustomXMLParts
/// 
/// Table model:
///   - Simple tables: native Range + ListObject
///   - Complex tables (merge cells): Range + MergeArea
///   - FormulaBlock in cells: anchored Shape
///   - WorksheetFormula (=SUM(...)): written to Range.Formula
/// </summary>
public class ExcelAdapter
{
    private readonly Application _app;

    public ExcelAdapter(Application app)
    {
        _app = app;
    }

    // ---------------------------------------------------------------------------
    // Insert Formula as Shape
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Insert a formula as a vector shape anchored to a cell.
    /// </summary>
    public InsertResult InsertFormula(FormulaPayload payload, Range? anchorCell = null)
    {
        var workbook = _app.ActiveWorkbook;
        if (workbook == null)
            return new InsertResult { Success = false, Error = "No active workbook" };

        var sheet = _app.ActiveSheet as Worksheet;
        if (sheet == null)
            return new InsertResult { Success = false, Error = "No active worksheet" };

        var cell = anchorCell ?? _app.Selection as Range;
        if (cell == null)
            return new InsertResult { Success = false, Error = "No selection" };

        try
        {
            // Create shape for the formula
            Shape shape;
            if (payload.Render?.Svg != null && !string.IsNullOrEmpty(payload.Render.Svg))
            {
                // If SVG is available, save to temp file and add as picture
                var tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}.svg");
                File.WriteAllText(tempPath, payload.Render.Svg);

                shape = sheet.Shapes.AddPicture(
                    tempPath,
                    Microsoft.Office.Core.MsoTriState.msoFalse,
                    Microsoft.Office.Core.MsoTriState.msoTrue,
                    (float)cell.Left,
                    (float)cell.Top,
                    payload.Render.WidthPt > 0 ? payload.Render.WidthPt : 100f,
                    payload.Render.HeightPt > 0 ? payload.Render.HeightPt : 30f
                );
            }
            else
            {
                // Fallback: create a text box with LaTeX
                shape = sheet.Shapes.AddTextbox(
                    Microsoft.Office.Core.MsoTextOrientation.msoTextOrientationHorizontal,
                    (float)cell.Left,
                    (float)cell.Top,
                    150f,
                    30f
                );
                shape.TextFrame2.TextRange.Text = $"${payload.Latex}$";
            }

            // Name and tag the shape
            shape.Name = $"LSNO_FORMULA_{payload.FormulaId}";
            shape.Tags.Add("LSNO_ID", payload.FormulaId);

            // Anchor to cell
            shape.Placement = XlPlacement.xlMoveAndSize;

            // Store metadata in CustomXMLParts
            FormulaMetadata.Write(workbook, payload);

            return new InsertResult
            {
                Success = true,
                FormulaId = payload.FormulaId
            };
        }
        catch (Exception ex)
        {
            return new InsertResult
            {
                Success = false,
                Error = $"Insert failed: {ex.Message}"
            };
        }
    }

    // ---------------------------------------------------------------------------
    // Read Selection
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Read formula from current selection.
    /// Checks: 1) Shape with LSNO_ID tag 2) Cell text with $...$
    /// </summary>
    public FormulaPayload? ReadSelection()
    {
        var workbook = _app.ActiveWorkbook;
        if (workbook == null) return null;

        var sheet = _app.ActiveSheet as Worksheet;
        if (sheet == null) return null;

        // Check if selection contains a shape
        try
        {
            foreach (Shape shape in sheet.Shapes)
            {
                try
                {
                    var tagValue = shape.Tags.Item("LSNO_ID");
                    if (!string.IsNullOrEmpty(tagValue))
                    {
                        return FormulaMetadata.Read(workbook, tagValue);
                    }
                }
                catch
                {
                    // Tags.Item throws if tag doesn't exist
                }
            }
        }
        catch { }

        // Check for cell text containing LaTeX
        var range = _app.Selection as Range;
        if (range != null)
        {
            var text = range.Text?.ToString() ?? "";
            if (text.StartsWith("$") && text.EndsWith("$") && text.Length > 2)
            {
                var latex = text[1..^1];
                return new FormulaPayload
                {
                    FormulaId = Guid.NewGuid().ToString("N"),
                    Latex = latex,
                    Omml = "",
                    Display = "block"
                };
            }
        }

        return null;
    }

    // ---------------------------------------------------------------------------
    // Replace Formula
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Replace a formula shape by ID.
    /// </summary>
    public bool ReplaceFormula(string formulaId, FormulaPayload newPayload)
    {
        var workbook = _app.ActiveWorkbook;
        if (workbook == null) return false;

        var sheet = _app.ActiveSheet as Worksheet;
        if (sheet == null) return false;

        try
        {
            // Find and delete old shape
            foreach (Shape shape in sheet.Shapes)
            {
                try
                {
                    var tagValue = shape.Tags.Item("LSNO_ID");
                    if (tagValue == formulaId)
                    {
                        shape.Delete();
                        break;
                    }
                }
                catch { }
            }

            // Insert new formula
            var result = InsertFormula(newPayload);
            return result.Success;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ExcelAdapter] Replace failed: {ex.Message}");
            return false;
        }
    }

    // ---------------------------------------------------------------------------
    // Delete Current
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Delete the formula shape at current selection.
    /// </summary>
    public bool DeleteCurrent()
    {
        var sheet = _app.ActiveSheet as Worksheet;
        if (sheet == null) return false;

        try
        {
            foreach (Shape shape in sheet.Shapes)
            {
                try
                {
                    var tagValue = shape.Tags.Item("LSNO_ID");
                    if (!string.IsNullOrEmpty(tagValue))
                    {
                        // Check if shape is near selection
                        var range = _app.Selection as Range;
                        if (range != null)
                        {
                            var shapeLeft = shape.Left;
                            var shapeTop = shape.Top;
                            var cellLeft = (double)range.Left;
                            var cellTop = (double)range.Top;

                            if (Math.Abs(shapeLeft - cellLeft) < 50 && Math.Abs(shapeTop - cellTop) < 50)
                            {
                                shape.Delete();
                                return true;
                            }
                        }
                    }
                }
                catch { }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ExcelAdapter] Delete failed: {ex.Message}");
        }

        return false;
    }

    // ---------------------------------------------------------------------------
    // Table Operations
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Read the table (Range) at current selection.
    /// </summary>
    public TablePayload? ReadTable()
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
            System.Diagnostics.Debug.WriteLine($"[ExcelAdapter] ReadTable failed: {ex.Message}");
        }

        return null;
    }

    /// <summary>
    /// Insert a table from TablePayload.
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
                // Use Range with MergeArea
                InsertTableWithMerges(targetRange, payload);
            }
            else
            {
                // Simple table - use ListObject
                InsertSimpleTable(targetRange, payload);
            }

            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ExcelAdapter] InsertTable failed: {ex.Message}");
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
                    WriteCellContent(excelCell, cell);
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
                    if (cell.Properties?.VerticalAlignment == "middle")
                        mergeRange.VerticalAlignment = XlVAlign.xlVAlignCenter;
                    else if (cell.Properties?.VerticalAlignment == "bottom")
                        mergeRange.VerticalAlignment = XlVAlign.xlVAlignBottom;

                    // Write content
                    WriteCellContent(excelCell, cell);
                }
                else
                {
                    // Apply vertical alignment
                    if (cell.Properties?.VerticalAlignment == "middle")
                        excelCell.VerticalAlignment = XlVAlign.xlVAlignCenter;
                    else if (cell.Properties?.VerticalAlignment == "bottom")
                        excelCell.VerticalAlignment = XlVAlign.xlVAlignBottom;

                    // Write content
                    WriteCellContent(excelCell, cell);
                }

                // Apply background color
                if (cell.Properties?.Background != null && cell.Properties.Background.StartsWith("#"))
                {
                    try
                    {
                        int red = Convert.ToInt32(cell.Properties.Background[1..3], 16);
                        int green = Convert.ToInt32(cell.Properties.Background[3..5], 16);
                        int blue = Convert.ToInt32(cell.Properties.Background[5..7], 16);
                        excelCell.Interior.Color = red + (green << 8) + (blue << 16);
                    }
                    catch { }
                }
            }
        }
    }

    private void WriteCellContent(Range cell, TableCell tableCell)
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
                    // Insert placeholder - Desktop will handle formula shape
                    cell.Value2 = $"[{formula.FormulaRef}]";
                    break;
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    private TablePayload ConvertFromListObject(ListObject listObj)
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
                var text = cellRange?.Text?.ToString() ?? "";

                var inlines = new List<InlineContent>();
                if (!string.IsNullOrEmpty(text))
                {
                    inlines.Add(new InlineText { Text = text });
                }
                else
                {
                    inlines.Add(new InlineText { Text = "" });
                }

                cells.Add(new TableCell
                {
                    Rowspan = 1,
                    Colspan = 1,
                    Inlines = inlines,
                    Properties = new CellProperties
                    {
                        Background = GetCellBackground(cellRange)
                    }
                });
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

    private TablePayload ConvertFromRange(Range range)
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
                var text = cellRange?.Text?.ToString() ?? "";

                var inlines = new List<InlineContent>();
                if (!string.IsNullOrEmpty(text))
                {
                    inlines.Add(new InlineText { Text = text });
                }
                else
                {
                    inlines.Add(new InlineText { Text = "" });
                }

                cells.Add(new TableCell
                {
                    Rowspan = 1,
                    Colspan = 1,
                    Inlines = inlines,
                    Properties = new CellProperties
                    {
                        Background = GetCellBackground(cellRange)
                    }
                });
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

    /// <summary>
    /// Check if current selection is near a formula shape.
    /// </summary>
    public bool HasFormulaAtSelection()
    {
        var sheet = _app.ActiveSheet as Worksheet;
        if (sheet == null) return false;

        var range = _app.Selection as Range;
        if (range == null) return false;

        foreach (Shape shape in sheet.Shapes)
        {
            try
            {
                var tagValue = shape.Tags.Item("LSNO_ID");
                if (!string.IsNullOrEmpty(tagValue))
                {
                    var shapeLeft = shape.Left;
                    var shapeTop = shape.Top;
                    var cellLeft = (double)range.Left;
                    var cellTop = (double)range.Top;

                    if (Math.Abs(shapeLeft - cellLeft) < 50 && Math.Abs(shapeTop - cellTop) < 50)
                        return true;
                }
            }
            catch { }
        }

        return false;
    }

    /// <summary>
    /// Get all formula shapes in the current worksheet.
    /// </summary>
    public List<FormulaShapeInfo> GetFormulaShapes()
    {
        var sheet = _app.ActiveSheet as Worksheet;
        if (sheet == null) return new List<FormulaShapeInfo>();

        var result = new List<FormulaShapeInfo>();
        foreach (Shape shape in sheet.Shapes)
        {
            try
            {
                var tagValue = shape.Tags.Item("LSNO_ID");
                if (!string.IsNullOrEmpty(tagValue))
                {
                    result.Add(new FormulaShapeInfo
                    {
                        FormulaId = tagValue,
                        ShapeName = shape.Name,
                        Left = shape.Left,
                        Top = shape.Top,
                        Width = shape.Width,
                        Height = shape.Height
                    });
                }
            }
            catch { }
        }

        return result;
    }
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

public class InsertResult
{
    public bool Success { get; set; }
    public string? FormulaId { get; set; }
    public string? Error { get; set; }
}

public class FormulaShapeInfo
{
    public string FormulaId { get; set; } = "";
    public string ShapeName { get; set; } = "";
    public double Left { get; set; }
    public double Top { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }
}

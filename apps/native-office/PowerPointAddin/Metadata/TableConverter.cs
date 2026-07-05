using Microsoft.Office.Interop.PowerPoint;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.PowerPoint.Metadata;

/// <summary>
/// Converts between PowerPoint Tables and LaTeXSnipper TableBlock structures.
/// 
/// PowerPoint table model:
///   - Simple tables: native PowerPoint Table Shape
///   - Complex tables (merge/formula): LaTeXSnipperTableCanvas (Shape Group)
///   - Canvas is NOT an image table - each cell/formula is individually editable
///   - Table data stored in Presentation.CustomXMLParts
/// </summary>
public class TableConverter
{
    private readonly Application _app;

    public TableConverter(Application app)
    {
        _app = app;
    }

    // ---------------------------------------------------------------------------
    // Read PowerPoint Table → TableBlock
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Read the table at current selection and convert to TablePayload.
    /// </summary>
    public TablePayload? ReadSelection()
    {
        var slide = GetActiveSlide();
        if (slide == null) return null;

        try
        {
            if (_app.Selection.Type == PpSelectionType.ppSelectionShapes)
            {
                var selectedShape = _app.Selection.ShapeRange[1];

                // Check if it's a table
                if (selectedShape.HasTable == Microsoft.Office.Core.MsoTriState.msoTrue)
                {
                    return ConvertFromTable(selectedShape.Table);
                }

                // Check if it's a group (canvas)
                if (selectedShape.Type == Microsoft.Office.Core.MsoShapeType.msoGroup)
                {
                    return ConvertFromGroup(selectedShape);
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[TableConverter] ReadSelection failed: {ex.Message}");
        }

        return null;
    }

    /// <summary>
    /// Convert a PowerPoint Table to TablePayload.
    /// </summary>
    public TablePayload ConvertFromTable(Microsoft.Office.Interop.PowerPoint.Table table)
    {
        var tableId = Guid.NewGuid().ToString("N");
        var rows = new List<TableRow>();

        for (int r = 1; r <= table.Rows.Count; r++)
        {
            var row = new TableRow();
            var cells = new List<TableCell>();

            for (int c = 1; c <= table.Columns.Count; c++)
            {
                try
                {
                    var cell = table.Cell(r, c);
                    var text = cell.Shape.TextFrame2?.TextRange?.Text ?? "";

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
                            Background = GetCellBackground(cell.Shape)
                        }
                    });
                }
                catch
                {
                    cells.Add(new TableCell
                    {
                        Rowspan = 1,
                        Colspan = 1,
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
            Table = new Shared.TableBlock
            {
                Rows = rows,
                Properties = new TableProperties { Layout = "autofit" }
            }
        };
    }

    /// <summary>
    /// Convert a Group Shape (canvas) to TablePayload.
    /// </summary>
    public TablePayload ConvertFromGroup(Shape groupShape)
    {
        var tableId = "";
        try { tableId = groupShape.Tags.Item("LSNO_ID"); } catch { }
        if (string.IsNullOrEmpty(tableId))
            tableId = Guid.NewGuid().ToString("N");

        var rows = new List<TableRow>();

        // Group shapes are arranged in grid layout
        var shapes = new List<Shape>();
        foreach (Shape s in groupShape.GroupItems)
        {
            shapes.Add(s);
        }

        // Sort by position (top to bottom, left to right)
        shapes.Sort((a, b) =>
        {
            int cmp = a.Top.CompareTo(b.Top);
            return cmp != 0 ? cmp : a.Left.CompareTo(b.Left);
        });

        // Group by rows (shapes with similar top position)
        var currentRow = new List<Shape>();
        double lastTop = -1;

        foreach (var shape in shapes)
        {
            if (lastTop < 0 || Math.Abs(shape.Top - lastTop) < 10)
            {
                currentRow.Add(shape);
            }
            else
            {
                if (currentRow.Count > 0)
                {
                    rows.Add(ConvertShapesToRow(currentRow));
                }
                currentRow = new List<Shape> { shape };
            }
            lastTop = shape.Top;
        }

        if (currentRow.Count > 0)
        {
            rows.Add(ConvertShapesToRow(currentRow));
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

    private TableRow ConvertShapesToRow(List<Shape> shapes)
    {
        var cells = new List<TableCell>();

        foreach (var shape in shapes)
        {
            var text = shape.TextFrame2?.TextRange?.Text ?? "";
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
                    Background = GetCellBackground(shape)
                }
            });
        }

        return new TableRow { Cells = cells };
    }

    // ---------------------------------------------------------------------------
    // Write TableBlock → PowerPoint Table
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Insert a table from TablePayload.
    /// </summary>
    public bool InsertTable(TablePayload payload)
    {
        var slide = GetActiveSlide();
        if (slide == null) return false;

        try
        {
            var rows = payload.Table.Rows.Count;
            var cols = payload.Table.Rows.Max(r => r.Cells.Count);

            if (rows == 0 || cols == 0) return false;

            // Check for complex table (merge cells or formulas)
            bool hasComplexity = payload.Table.Rows.Any(r =>
                r.Cells.Any(c => c.Colspan > 1 || c.Rowspan > 1 ||
                    c.Inlines.Any(i => i is InlineFormula)));

            if (hasComplexity)
            {
                return InsertCanvasTable(slide, payload);
            }
            else
            {
                return InsertNativeTable(slide, payload);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[TableConverter] InsertTable failed: {ex.Message}");
            return false;
        }
    }

    private bool InsertNativeTable(Slide slide, TablePayload payload)
    {
        var rows = payload.Table.Rows.Count;
        var cols = payload.Table.Rows.Max(r => r.Cells.Count);

        // Add table shape
        var tableShape = slide.Shapes.AddTable(rows, cols, 50, 50, 600, 300);
        var table = tableShape.Table;

        // Fill cells
        for (int r = 0; r < rows; r++)
        {
            for (int c = 0; c < cols; c++)
            {
                if (r < payload.Table.Rows.Count && c < payload.Table.Rows[r].Cells.Count)
                {
                    var cell = payload.Table.Rows[r].Cells[c];
                    var pptCell = table.Cell(r + 1, c + 1);

                    WriteCellContent(pptCell, cell);

                    // Apply alignment
                    if (cell.Properties?.Alignment == "center")
                        pptCell.Shape.TextFrame2.TextRange.ParagraphFormat.Alignment =
                            Microsoft.Office.Core.MsoParagraphAlignment.msoAlignCenter;
                    else if (cell.Properties?.Alignment == "right")
                        pptCell.Shape.TextFrame2.TextRange.ParagraphFormat.Alignment =
                            Microsoft.Office.Core.MsoParagraphAlignment.msoAlignRight;

                    // Apply background
                    if (cell.Properties?.Background != null && cell.Properties.Background.StartsWith("#"))
                    {
                        try
                        {
                            int red = Convert.ToInt32(cell.Properties.Background[1..3], 16);
                            int green = Convert.ToInt32(cell.Properties.Background[3..5], 16);
                            int blue = Convert.ToInt32(cell.Properties.Background[5..7], 16);
                            pptCell.Shape.Fill.ForeColor.RGB = red + (green << 8) + (blue << 16);
                        }
                        catch { }
                    }
                }
            }
        }

        // Tag the table
        tableShape.Name = $"LSNO_TABLE_{payload.TableId[..8]}";
        tableShape.Tags.Add("LSNO_ID", payload.TableId);

        return true;
    }

    private bool InsertCanvasTable(Slide slide, TablePayload payload)
    {
        var rows = payload.Table.Rows.Count;
        var cols = payload.Table.Rows.Max(r => r.Cells.Count);

        var cellWidth = 100f;
        var cellHeight = 30f;

        var shapes = new System.Collections.ArrayList();

        for (int r = 0; r < rows; r++)
        {
            for (int c = 0; c < cols; c++)
            {
                if (r < payload.Table.Rows.Count && c < payload.Table.Rows[r].Cells.Count)
                {
                    var cell = payload.Table.Rows[r].Cells[c];
                    var left = 50 + c * cellWidth;
                    var top = 50 + r * cellHeight;

                    // Create cell shape
                    var cellShape = slide.Shapes.AddTextbox(
                        Microsoft.Office.Core.MsoTextOrientation.msoTextOrientationHorizontal,
                        left,
                        top,
                        cellWidth,
                        cellHeight
                    );

                    // Set border
                    cellShape.Line.Visible = Microsoft.Office.Core.MsoTriState.msoTrue;
                    cellShape.Line.Weight = 1;

                    // Write content
                    foreach (var inline in cell.Inlines)
                    {
                        switch (inline)
                        {
                            case InlineText text:
                                cellShape.TextFrame2.TextRange.Text = text.Text;
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

                                    var formulaShape = slide.Shapes.AddPicture(
                                        tempPath,
                                        Microsoft.Office.Core.MsoTriState.msoFalse,
                                        Microsoft.Office.Core.MsoTriState.msoTrue,
                                        cellShape.Left,
                                        cellShape.Top,
                                        formulaPayload.Render.WidthPt > 0 ? formulaPayload.Render.WidthPt : 100f,
                                        formulaPayload.Render.HeightPt > 0 ? formulaPayload.Render.HeightPt : 30f
                                    );
                                    formulaShape.Name = $"LSNO_FORMULA_{formulaPayload.FormulaId}";
                                    formulaShape.Tags.Add("LSNO_ID", formulaPayload.FormulaId);
                                }
                                else
                                {
                                    // Fallback to placeholder
                                    cellShape.TextFrame2.TextRange.Text = $"[{formula.FormulaRef}]";
                                }
                                break;
                        }
                    }

                    // Apply background
                    if (cell.Properties?.Background != null && cell.Properties.Background.StartsWith("#"))
                    {
                        try
                        {
                            int red = Convert.ToInt32(cell.Properties.Background[1..3], 16);
                            int green = Convert.ToInt32(cell.Properties.Background[3..5], 16);
                            int blue = Convert.ToInt32(cell.Properties.Background[5..7], 16);
                            cellShape.Fill.ForeColor.RGB = red + (green << 8) + (blue << 16);
                        }
                        catch { }
                    }

                    shapes.Add(cellShape);
                }
            }
        }

        // Group shapes into canvas
        if (shapes.Count > 0)
        {
            var shapeIds = shapes.Cast<Shape>().Select(s => s.Id).ToArray();
            var shapeRange = slide.Shapes.Range(shapeIds);
            var group = shapeRange.Group();
            group.Name = $"LSNO_CANVAS_{payload.TableId[..8]}";
            group.Tags.Add("LSNO_ID", payload.TableId);
            group.AlternativeText = "LaTeXSnipper table canvas";
        }

        return true;
    }

    private void WriteCellContent(Microsoft.Office.Interop.PowerPoint.Cell cell, TableCell tableCell)
    {
        var textFrame = cell.Shape.TextFrame2;
        textFrame.TextRange.Text = "";

        foreach (var inline in tableCell.Inlines)
        {
            switch (inline)
            {
                case InlineText text:
                    textFrame.TextRange.Text += text.Text;
                    break;
                case InlineFormula formula:
                    textFrame.TextRange.Text += $"[{formula.FormulaRef}]";
                    break;
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    private Slide? GetActiveSlide()
    {
        try
        {
            if (_app.ActiveWindow?.Selection?.SlideRange?.Count > 0)
            {
                return _app.ActiveWindow.Selection.SlideRange[1];
            }
        }
        catch { }
        return null;
    }

    private string GetCellBackground(Shape cellShape)
    {
        try
        {
            if (cellShape.Fill.Visible == Microsoft.Office.Core.MsoTriState.msoTrue)
            {
                int color = cellShape.Fill.ForeColor.RGB;
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
    /// Check if the current selection contains a table.
    /// </summary>
    public bool IsInTable()
    {
        try
        {
            if (_app.Selection.Type == PpSelectionType.ppSelectionShapes)
            {
                var selectedShape = _app.Selection.ShapeRange[1];
                return selectedShape.HasTable == Microsoft.Office.Core.MsoTriState.msoTrue ||
                       selectedShape.Type == Microsoft.Office.Core.MsoShapeType.msoGroup;
            }
        }
        catch { }
        return false;
    }

    /// <summary>
    /// Format a table with consistent styling.
    /// </summary>
    public void FormatTable(Microsoft.Office.Interop.PowerPoint.Table table)
    {
        try
        {
            // Set table style
            table.ApplyStyle(1); // Default style

            // Center all cells
            for (int r = 1; r <= table.Rows.Count; r++)
            {
                for (int c = 1; c <= table.Columns.Count; c++)
                {
                    try
                    {
                        var cell = table.Cell(r, c);
                        cell.Shape.TextFrame2.TextRange.ParagraphFormat.Alignment =
                            Microsoft.Office.Core.MsoParagraphAlignment.msoAlignCenter;
                    }
                    catch { }
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[TableConverter] FormatTable failed: {ex.Message}");
        }
    }
}

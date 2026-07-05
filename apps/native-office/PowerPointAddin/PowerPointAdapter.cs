using Microsoft.Office.Interop.PowerPoint;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.PowerPoint;

/// <summary>
/// Core PowerPoint operations for formula and table handling.
/// 
/// Formula model:
///   - Formula as Vector Shape on slide
///   - Shape Tags store LSNO_ID
///   - Full data stored in Presentation.CustomXMLParts
///   - Alt Text saves short accessible text (not full XML)
/// 
/// Table model:
///   - Simple tables: native PowerPoint Table Shape
///   - Complex tables (merge/formula): LaTeXSnipperTableCanvas (Shape Group)
///   - Canvas is NOT an image table - each cell/formula is individually editable
/// </summary>
public class PowerPointAdapter
{
    private readonly Application _app;

    public PowerPointAdapter(Application app)
    {
        _app = app;
    }

    // ---------------------------------------------------------------------------
    // Insert Formula as Shape
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Insert a formula as a vector shape on the current slide.
    /// </summary>
    public InsertResult InsertFormula(FormulaPayload payload, Slide? targetSlide = null)
    {
        var presentation = _app.ActivePresentation;
        if (presentation == null)
            return new InsertResult { Success = false, Error = "No active presentation" };

        var slide = targetSlide ?? GetActiveSlide();
        if (slide == null)
            return new InsertResult { Success = false, Error = "No active slide" };

        try
        {
            // Get slide dimensions for positioning
            var slideWidth = presentation.PageSetup.SlideWidth;
            var slideHeight = presentation.PageSetup.SlideHeight;

            // Create shape for the formula
            Shape shape;
            if (payload.Render?.Svg != null && !string.IsNullOrEmpty(payload.Render.Svg))
            {
                // Save SVG to temp file and add as picture
                var tempPath = Path.Combine(Path.GetTempPath(), $"lsno_{payload.FormulaId}.svg");
                File.WriteAllText(tempPath, payload.Render.Svg);

                // Position at center of slide
                var left = (slideWidth - (payload.Render.WidthPt > 0 ? payload.Render.WidthPt : 100f)) / 2;
                var top = slideHeight / 3; // Upper third

                shape = slide.Shapes.AddPicture(
                    tempPath,
                    Microsoft.Office.Core.MsoTriState.msoFalse,
                    Microsoft.Office.Core.MsoTriState.msoTrue,
                    left,
                    top,
                    payload.Render.WidthPt > 0 ? payload.Render.WidthPt : 100f,
                    payload.Render.HeightPt > 0 ? payload.Render.HeightPt : 30f
                );
            }
            else
            {
                // Fallback: create a text box with LaTeX
                var left = slideWidth / 4;
                var top = slideHeight / 3;

                shape = slide.Shapes.AddTextbox(
                    Microsoft.Office.Core.MsoTextOrientation.msoTextOrientationHorizontal,
                    left,
                    top,
                    slideWidth / 2,
                    40f
                );
                shape.TextFrame2.TextRange.Text = $"${payload.Latex}$";
            }

            // Name and tag the shape
            shape.Name = $"LSNO_FORMULA_{payload.FormulaId}";
            shape.Tags.Add("LSNO_ID", payload.FormulaId);

            // Set Alt Text for accessibility (short description, not full XML)
            shape.AlternativeText = $"LaTeXSnipper formula: {payload.Latex}";

            // Store metadata in CustomXMLParts
            FormulaMetadata.Write(presentation, payload);

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
    /// </summary>
    public FormulaPayload? ReadSelection()
    {
        var presentation = _app.ActivePresentation;
        if (presentation == null) return null;

        var slide = GetActiveSlide();
        if (slide == null) return null;

        // Check if selection contains a shape
        try
        {
            if (_app.Selection.Type == PpSelectionType.ppSelectionShapes)
            {
                var selectedShape = _app.Selection.ShapeRange[1];
                try
                {
                    var tagValue = selectedShape.Tags.Item("LSNO_ID");
                    if (!string.IsNullOrEmpty(tagValue))
                    {
                        return FormulaMetadata.Read(presentation, tagValue);
                    }
                }
                catch { }
            }
        }
        catch { }

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
        var presentation = _app.ActivePresentation;
        if (presentation == null) return false;

        var slide = GetActiveSlide();
        if (slide == null) return false;

        try
        {
            // Find and delete old shape
            foreach (Shape shape in slide.Shapes)
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
            var result = InsertFormula(newPayload, slide);
            return result.Success;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[PowerPointAdapter] Replace failed: {ex.Message}");
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
        var slide = GetActiveSlide();
        if (slide == null) return false;

        try
        {
            if (_app.Selection.Type == PpSelectionType.ppSelectionShapes)
            {
                var selectedShape = _app.Selection.ShapeRange[1];
                try
                {
                    var tagValue = selectedShape.Tags.Item("LSNO_ID");
                    if (!string.IsNullOrEmpty(tagValue))
                    {
                        selectedShape.Delete();
                        return true;
                    }
                }
                catch { }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[PowerPointAdapter] Delete failed: {ex.Message}");
        }

        return false;
    }

    // ---------------------------------------------------------------------------
    // Table Operations
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Read the table at current selection.
    /// </summary>
    public TablePayload? ReadTable()
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
            System.Diagnostics.Debug.WriteLine($"[PowerPointAdapter] ReadTable failed: {ex.Message}");
        }

        return null;
    }

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
                // Use Canvas (Shape Group)
                return InsertCanvasTable(slide, payload);
            }
            else
            {
                // Use native PowerPoint table
                return InsertNativeTable(slide, payload);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[PowerPointAdapter] InsertTable failed: {ex.Message}");
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
        var tableWidth = cols * cellWidth;
        var tableHeight = rows * cellHeight;

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
                                cellShape.TextFrame2.TextRange.Text = $"[{formula.FormulaRef}]";
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
            var shapeRange = slide.Shapes.Range(
                shapes.Cast<Shape>().Select(s => s.Id).ToArray()
            );
            var group = shapeRange.Group();
            group.Name = $"LSNO_CANVAS_{payload.TableId[..8]}";
            group.Tags.Add("LSNO_ID", payload.TableId);
            group.AlternativeText = $"LaTeXSnipper table canvas";
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

    private TablePayload ConvertFromTable(Microsoft.Office.Interop.PowerPoint.Table table)
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
                    var text = cell.Shape.TextFrame2.TextRange.Text ?? "";

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
                        Inlines = inlines
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

    private TablePayload ConvertFromGroup(Shape groupShape)
    {
        var tableId = groupShape.Tags.Item("LSNO_ID") ?? Guid.NewGuid().ToString("N");
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
                    var row = ConvertShapesToRow(currentRow);
                    rows.Add(row);
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
                Inlines = inlines
            });
        }

        return new TableRow { Cells = cells };
    }

    /// <summary>
    /// Get all formula shapes on the current slide.
    /// </summary>
    public List<FormulaShapeInfo> GetFormulaShapes()
    {
        var slide = GetActiveSlide();
        if (slide == null) return new List<FormulaShapeInfo>();

        var result = new List<FormulaShapeInfo>();
        foreach (Shape shape in slide.Shapes)
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
    public float Left { get; set; }
    public float Top { get; set; }
    public float Width { get; set; }
    public float Height { get; set; }
}

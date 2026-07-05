using Microsoft.Office.Interop.Word;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Word.Metadata;

/// <summary>
/// Converts between Word Tables and LaTeXSnipper TableBlock structures.
/// 
/// Word Table OOXML mapping:
///   gridSpan     → <w:gridSpan w:val="N"/>
///   vMerge       → <w:vMerge w:val="restart"/> / <w:vMerge/>
///   borders      → <w:tcBorders>
///   alignment    → <w:jc w:val="center"/>
///   cell.text    → <w:t> content
///   cell.formula → <w:hyperlink> + Bookmark
/// </summary>
public class TableConverter
{
    private readonly Application _app;

    public TableConverter(Application app)
    {
        _app = app;
    }

    // ---------------------------------------------------------------------------
    // Read Word Table → TableBlock
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Read the table at current selection and convert to TableBlock.
    /// </summary>
    public TablePayload? ReadSelection()
    {
        var range = _app.Selection.Range;
        if (range == null) return null;

        // Check if selection is inside a table
        if (range.Tables.Count == 0)
            return null;

        var table = range.Tables[1];
        return ConvertFromWordTable(table);
    }

    /// <summary>
    /// Convert a Word Table to a TablePayload.
    /// </summary>
    public TablePayload ConvertFromWordTable(Microsoft.Office.Interop.Word.Table wordTable)
    {
        var tableId = Guid.NewGuid().ToString("N");
        var rows = new List<TableRow>();

        for (int r = 1; r <= wordTable.Rows.Count; r++)
        {
            var row = new TableRow();
            var cells = new List<TableCell>();

            for (int c = 1; c <= wordTable.Columns.Count; c++)
            {
                try
                {
                    var cell = wordTable.Cell(r, c);
                    var tableCell = ConvertCell(cell, tableId);
                    cells.Add(tableCell);
                }
                catch
                {
                    // Cell may be merged
                    cells.Add(new TableCell
                    {
                        Rowspan = 1,
                        Colspan = 1,
                        Inlines = new List<InlineContent>
                        {
                            new InlineText { Text = "" }
                        }
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

    private TableCell ConvertCell(Microsoft.Office.Interop.Word.Cell cell, string tableId)
    {
        var inlines = new List<InlineContent>();

        // Extract text and formulas from cell
        foreach (Paragraph para in cell.Range.Paragraphs)
        {
            foreach (Range runRange in para.Ranges)
            {
                // Check for OMath (formula)
                if (runRange.OMaths.Count > 0)
                {
                    foreach (Microsoft.Office.Interop.Word.OMath omath in runRange.OMaths)
                    {
                        var omml = omath.Range.get_XML();
                        if (!string.IsNullOrEmpty(omml))
                        {
                            var formulaId = ExtractFormulaIdFromCell(cell, tableId);
                            inlines.Add(new InlineFormula { FormulaRef = formulaId });
                        }
                    }
                }
                else
                {
                    // Plain text
                    var text = runRange.Text?.Trim();
                    if (!string.IsNullOrEmpty(text))
                    {
                        inlines.Add(new InlineText { Text = text });
                    }
                }
            }
        }

        if (inlines.Count == 0)
        {
            inlines.Add(new InlineText { Text = "" });
        }

        // Get cell properties
        var properties = new CellProperties
        {
            VerticalAlignment = GetVerticalAlignment(cell.VerticalAlignment),
            Background = GetCellShading(cell)
        };

        return new TableCell
        {
            Rowspan = 1, // Word handles merge differently
            Colspan = 1,
            Inlines = inlines,
            Properties = properties
        };
    }

    private string ExtractFormulaIdFromCell(Microsoft.Office.Interop.Word.Cell cell, string tableId)
    {
        // Check for LSNO bookmark in cell
        foreach (Bookmark bookmark in _app.ActiveDocument.Bookmarks)
        {
            if (bookmark.Name.StartsWith("LSNO:formula:"))
            {
                var range = bookmark.Range;
                if (range.Start >= cell.Range.Start && range.End <= cell.Range.End)
                {
                    return bookmark.Name.Replace("LSNO:formula:", "");
                }
            }
        }

        // Generate new ID if not found
        return Guid.NewGuid().ToString("N");
    }

    // ---------------------------------------------------------------------------
    // Write TableBlock → Word Table
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Insert a table from TablePayload at current selection.
    /// </summary>
    public bool InsertTable(TablePayload payload)
    {
        var range = _app.Selection.Range;
        if (range == null) return false;

        try
        {
            var rows = payload.Table.Rows.Count;
            var cols = payload.Table.Rows.Max(r => r.Cells.Count);

            if (rows == 0 || cols == 0) return false;

            // Add table
            var wordTable = range.Tables.Add(range, rows, cols);

            // Set basic table properties
            wordTable.Borders.Enable = 1;
            wordTable.AutoFitBehavior(WdAutoFitBehavior.wdAutoFitContent);

            // Fill cells
            for (int r = 0; r < rows; r++)
            {
                for (int c = 0; c < cols; c++)
                {
                    if (r < payload.Table.Rows.Count && c < payload.Table.Rows[r].Cells.Count)
                    {
                    var cell = payload.Table.Rows[r].Cells[c];
                    var wordCell = wordTable.Cell(r + 1, c + 1);

                    WriteCellContent(wordCell, cell, payload.TableId, payload);
                    ApplyCellProperties(wordCell, cell.Properties);
                    }
                }
            }

            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[TableConverter] InsertTable failed: {ex.Message}");
            return false;
        }
    }

    private void WriteCellContent(Microsoft.Office.Interop.Word.Cell cell, TableCell tableCell, string tableId, TablePayload payload)
    {
        var range = cell.Range;
        range.Delete(); // Clear existing content

        foreach (var inline in tableCell.Inlines)
        {
            switch (inline)
            {
                case InlineText text:
                    range.InsertAfter(text.Text);
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

                    if (formulaPayload != null && !string.IsNullOrEmpty(formulaPayload.Omml))
                    {
                        // Insert actual OMML
                        range.InsertXML(formulaPayload.Omml);
                    }
                    else
                    {
                        // Fallback to placeholder
                        range.InsertAfter($"[{formula.FormulaRef}]");
                    }
                    break;
            }
        }
    }

    private void ApplyCellProperties(Microsoft.Office.Interop.Word.Cell cell, CellProperties? properties)
    {
        if (properties == null) return;

        // Vertical alignment
        if (properties.VerticalAlignment != null)
        {
            cell.VerticalAlignment = properties.VerticalAlignment switch
            {
                "top" => WdCellVerticalAlignment.wdCellAlignVerticalTop,
                "middle" => WdCellVerticalAlignment.wdCellAlignVerticalCenter,
                "bottom" => WdCellVerticalAlignment.wdCellAlignVerticalBottom,
                _ => WdCellVerticalAlignment.wdCellAlignVerticalTop
            };
        }

        // Background color
        if (properties.Background != null && properties.Background.StartsWith("#"))
        {
            try
            {
                int r = Convert.ToInt32(properties.Background[1..3], 16);
                int g = Convert.ToInt32(properties.Background[3..5], 16);
                int b = Convert.ToInt32(properties.Background[5..7], 16);
                cell.Shading.BackgroundPatternColor = (WdColor)(r + (g << 8) + (b << 16));
            }
            catch { }
        }
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    private string GetVerticalAlignment(WdCellVerticalAlignment alignment)
    {
        return alignment switch
        {
            WdCellVerticalAlignment.wdCellAlignVerticalTop => "top",
            WdCellVerticalAlignment.wdCellAlignVerticalCenter => "middle",
            WdCellVerticalAlignment.wdCellAlignVerticalBottom => "bottom",
            _ => "top"
        };
    }

    private string GetCellShading(Microsoft.Office.Interop.Word.Cell cell)
    {
        try
        {
            var color = cell.Shading.BackgroundPatternColor;
            if (color != WdColor.wdColorAutomatic)
            {
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
    /// Check if the current selection is inside a table.
    /// </summary>
    public bool IsInTable()
    {
        try
        {
            return _app.Selection.Tables.Count > 0;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Get the table at current selection.
    /// </summary>
    public Microsoft.Office.Interop.Word.Table? GetCurrentTable()
    {
        try
        {
            if (_app.Selection.Tables.Count > 0)
                return _app.Selection.Tables[1];
        }
        catch { }
        return null;
    }
}

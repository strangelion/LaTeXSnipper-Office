#nullable enable
using System;
using System.Globalization;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// Converts a rectangular spreadsheet Value2 result into the shared table
/// contract. Numeric cell results stay culture-invariant so PGFPlots can parse
/// them regardless of the Office display language.
/// </summary>
public static class SpreadsheetTablePayload
{
    public const int MaximumCells = 100_000;

    public static TablePayload FromValues(
        object? values,
        int rowCount,
        int columnCount,
        string tableId)
    {
        if (rowCount <= 0 || columnCount <= 0)
            throw new ArgumentOutOfRangeException(nameof(rowCount), "Spreadsheet selection is empty.");
        if ((long)rowCount * columnCount > MaximumCells)
            throw new InvalidOperationException(
                $"SPREADSHEET_SELECTION_TOO_LARGE: maximum {MaximumCells} cells are supported.");
        if (string.IsNullOrWhiteSpace(tableId))
            throw new ArgumentException("Table id must not be empty.", nameof(tableId));

        Array? matrix = values as Array;
        if (matrix != null && matrix.Rank != 2)
            throw new ArgumentException("Spreadsheet values must be a two-dimensional array.", nameof(values));
        if (matrix != null &&
            (matrix.GetLength(0) != rowCount || matrix.GetLength(1) != columnCount))
            throw new ArgumentException("Spreadsheet dimensions do not match the selected range.", nameof(values));
        if (matrix == null && (rowCount != 1 || columnCount != 1))
            throw new ArgumentException("A multi-cell range must provide a two-dimensional value array.", nameof(values));

        var payload = new TablePayload { TableId = tableId };
        int rowLowerBound = matrix?.GetLowerBound(0) ?? 0;
        int columnLowerBound = matrix?.GetLowerBound(1) ?? 0;
        for (int rowIndex = 0; rowIndex < rowCount; rowIndex++)
        {
            var row = new TableRow();
            for (int columnIndex = 0; columnIndex < columnCount; columnIndex++)
            {
                object? value = matrix == null
                    ? values
                    : matrix.GetValue(rowLowerBound + rowIndex, columnLowerBound + columnIndex);
                row.Cells.Add(new TableCell
                {
                    Inlines =
                    {
                        new InlineText { Text = CellText(value) }
                    }
                });
            }
            payload.Table.Rows.Add(row);
        }
        return payload;
    }

    private static string CellText(object? value)
    {
        if (value == null || value == DBNull.Value) return "";
        return value is IFormattable formattable
            ? formattable.ToString(null, CultureInfo.InvariantCulture) ?? ""
            : value.ToString() ?? "";
    }
}

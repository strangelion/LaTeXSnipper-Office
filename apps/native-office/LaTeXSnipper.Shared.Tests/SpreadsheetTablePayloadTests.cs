#nullable enable
using System;
using System.Globalization;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class SpreadsheetTablePayloadTests
    {
        public static int Run()
        {
            int failures = 0;
            failures += RunCase("converts one-based Excel arrays", ConvertsOneBasedExcelArrays);
            failures += RunCase("keeps numeric data culture-invariant", KeepsNumericDataCultureInvariant);
            failures += RunCase("rejects oversized selections", RejectsOversizedSelections);
            return failures;
        }

        private static int RunCase(string name, Action test)
        {
            try
            {
                test();
                Console.WriteLine("PASS SpreadsheetTablePayload " + name);
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("FAIL SpreadsheetTablePayload " + name + ": " + ex.Message);
                return 1;
            }
        }

        private static void ConvertsOneBasedExcelArrays()
        {
            Array values = Array.CreateInstance(typeof(object), new[] { 3, 2 }, new[] { 1, 1 });
            values.SetValue("x", 1, 1);
            values.SetValue("y", 1, 2);
            values.SetValue(0d, 2, 1);
            values.SetValue(1.25d, 2, 2);
            values.SetValue(2d, 3, 1);
            values.SetValue(null, 3, 2);

            TablePayload payload = SpreadsheetTablePayload.FromValues(values, 3, 2, "excel-table-1");
            Expect(payload.TableId == "excel-table-1", "table id was not preserved");
            Expect(payload.Table.Rows.Count == 3, "row count changed");
            Expect(Cell(payload, 0, 0) == "x" && Cell(payload, 0, 1) == "y", "header changed");
            Expect(Cell(payload, 1, 1) == "1.25", "numeric value changed");
            Expect(Cell(payload, 2, 1) == "", "empty cell was not preserved");
        }

        private static void KeepsNumericDataCultureInvariant()
        {
            CultureInfo previous = CultureInfo.CurrentCulture;
            try
            {
                CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("de-DE");
                TablePayload payload = SpreadsheetTablePayload.FromValues(3.5d, 1, 1, "single");
                Expect(Cell(payload, 0, 0) == "3.5", "numeric value used a locale decimal comma");
            }
            finally
            {
                CultureInfo.CurrentCulture = previous;
            }
        }

        private static void RejectsOversizedSelections()
        {
            try
            {
                SpreadsheetTablePayload.FromValues(null, 1001, 100, "too-large");
                throw new InvalidOperationException("oversized selection was accepted");
            }
            catch (InvalidOperationException ex) when (
                ex.Message.StartsWith("SPREADSHEET_SELECTION_TOO_LARGE", StringComparison.Ordinal))
            {
                // Expected.
            }
        }

        private static string Cell(TablePayload payload, int row, int column) =>
            ((InlineText)payload.Table.Rows[row].Cells[column].Inlines[0]).Text;

        private static void Expect(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}

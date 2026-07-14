using System;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    public static class OleExtentTests
    {
        internal static int Run()
        {
            int failures = 0;
            var payload = new FormulaPayload { FormulaId = "extent-test", Latex = "x", Display = "block" };
            var natural = new OleExtentPoints(100f, 40f, 100f, 40f);
            var powerpoint = OleFormulaInterop.GetInitialDisplayExtent(payload, natural, OleHostKind.PowerPoint);
            failures += Expect(powerpoint.DisplayWidthPt == 100f && powerpoint.DisplayHeightPt == 40f,
                "PowerPoint must start at the natural OLE extent");
            var word = OleFormulaInterop.GetInitialDisplayExtent(payload, natural, OleHostKind.Word);
            failures += Expect(word.DisplayWidthPt == 150f && word.DisplayHeightPt == 60f,
                "Word display scaling changed unexpectedly");
            var fitted = OleFormulaInterop.FitDisplayExtent(word, 75f, 100f);
            failures += Expect(fitted.DisplayWidthPt == 75f && fitted.DisplayHeightPt == 30f,
                "FitDisplayExtent did not preserve the aspect ratio");
            failures += Expect(OleFormulaInterop.DisplayExtentMatches(
                new OleExtentPoints(100f, 40f, 75f, 30f),
                new OleExtentPoints(100f, 40f, 75.5f, 29.5f)),
                "COM rounding tolerance was not accepted");

            var automation = new FakeAutomation();
            failures += Expect(OleFormulaInterop.TrySetDisplayExtent(automation, fitted),
                "Explicit display extent automation call failed");
            failures += Expect(OleFormulaInterop.TryGetExtentPoints(automation, out OleExtentPoints actual) &&
                OleFormulaInterop.DisplayExtentMatches(fitted, actual),
                "GetExtentJson did not report the synchronized display extent");
            return failures;
        }

        private static int Expect(bool condition, string message)
        {
            if (condition) return 0;
            Console.Error.WriteLine("FAIL: " + message);
            return 1;
        }

        public sealed class FakeAutomation
        {
            private int displayCx = 2540;
            private int displayCy = 2540;

            public void SetDisplayExtentHimetric(int cx, int cy)
            {
                if (cx <= 0 || cy <= 0) throw new ArgumentOutOfRangeException();
                displayCx = cx;
                displayCy = cy;
            }

            public string GetExtentJson()
            {
                return $"{{\"naturalCxHimetric\":2540,\"naturalCyHimetric\":1016,\"displayCxHimetric\":{displayCx},\"displayCyHimetric\":{displayCy}}}";
            }
        }
    }
}

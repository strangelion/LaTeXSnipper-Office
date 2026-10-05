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
                "Legacy payload display scaling changed unexpectedly");
            payload.Render = new RenderData { WidthPt = 97f, HeightPt = 38f };
            foreach (OleHostKind host in Enum.GetValues(typeof(OleHostKind)))
            {
                foreach (string mode in new[] { "inline", "block", "display" })
                {
                    payload.Display = mode;
                    var physical = OleFormulaInterop.GetInitialDisplayExtent(payload, natural, host);
                    failures += Expect(physical.DisplayWidthPt == 100f && physical.DisplayHeightPt == 40f,
                        "Physical renders must retain the natural frame without duplicate font scaling: " + host + "/" + mode);
                }
            }
            payload.Render.WidthPt = float.NaN;
            failures += Expect(OleFormulaInterop.GetInitialDisplayExtent(payload, natural).DisplayWidthPt == 150f,
                "Invalid physical dimensions must not bypass legacy scaling");
            var fitted = OleFormulaInterop.FitDisplayExtent(word, 75f, 100f);
            failures += Expect(fitted.DisplayWidthPt == 75f && fitted.DisplayHeightPt == 30f,
                "FitDisplayExtent did not preserve the aspect ratio");
            failures += Expect(OleFormulaInterop.DisplayExtentMatches(
                new OleExtentPoints(100f, 40f, 75f, 30f),
                new OleExtentPoints(100f, 40f, 75.5f, 29.5f)),
                "COM rounding tolerance was not accepted");
            var shortExtent = new OleExtentPoints(294.3f, 6.2f, 294.3f, 6.2f);
            failures += Expect(!OleFormulaInterop.HostGeometryMatches(shortExtent, 294f, 6f),
                "Default aspect guard unexpectedly permits short-frame distortion");
            failures += Expect(OleFormulaInterop.HostGeometryMatches(shortExtent, 294f, 6f, geometryQuantizationPt: 0.5f),
                "Word whole-point rounding was rejected for a short frame");
            failures += Expect(!OleFormulaInterop.HostGeometryMatches(shortExtent, 294f, 7f, geometryQuantizationPt: 0.5f),
                "Quantization must not bypass absolute geometry limits");

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

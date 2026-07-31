using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.NativeOffice.Shared.Omml;
using LaTeXSnipper.Word.Host;
using InteropWord = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.HostTests
{
    internal sealed class AcceptanceContract
    {
        public int SchemaVersion { get; set; }
        public List<string> Modes { get; set; }
        public List<AcceptanceCase> Cases { get; set; }
    }

    internal sealed class AcceptanceCase
    {
        public string Name { get; set; }
        public string Latex { get; set; }
        public string Operator { get; set; }
        public string OperandProbe { get; set; }
        public string Omml { get; set; }
        public string Svg { get; set; }
        public float RequestedWidthPt { get; set; }
        public float RequestedHeightPt { get; set; }
    }

    internal sealed class EvidenceRecord
    {
        public string Name { get; set; }
        public string Mode { get; set; }
        public string FormulaId { get; set; }
        public int ExpectedNaryCount { get; set; }
        public int ActualNaryCount { get; set; }
        public int MaximumBlankGapPixels { get; set; }
        public int RightBlankMarginPixels { get; set; }
        public string Screenshot { get; set; }
        public string StorageMode { get; set; }
        public bool OleInitialized { get; set; }
        public bool OleRoundTripVerified { get; set; }
        public float HostWidthPt { get; set; }
        public float HostHeightPt { get; set; }
        public string OleDiagnostics { get; set; }
        public string Status { get; set; }
    }

    internal static class Program
    {
        private const int MaximumBlankGapPixels = 1000;
        private const int MinimumRightBlankMarginPixels = 1;
        private static readonly JsonSerializerOptions JsonOptions =
            new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                WriteIndented = true
            };

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(
            IntPtr windowHandle,
            out uint processId);

        [STAThread]
        private static int Main(string[] args)
        {
            bool oleMode = args.Length == 4 &&
                string.Equals(args[2], "--ole", StringComparison.OrdinalIgnoreCase);
            if (args.Length < 2 || !File.Exists(args[0]) ||
                (args.Length > 2 && !oleMode) ||
                (oleMode && !Directory.Exists(args[3])))
            {
                Console.Error.WriteLine(
                    "Usage: LaTeXSnipper.Word.HostTests.exe <fixtures.json> <evidence-dir> " +
                    "[--ole <mathjax-svg-dir>]");
                return 2;
            }

            string evidenceDirectory = Path.GetFullPath(args[1]);
            string svgDirectory = oleMode ? Path.GetFullPath(args[3]) : null;
            Directory.CreateDirectory(evidenceDirectory);
            AcceptanceContract contract = JsonSerializer.Deserialize<AcceptanceContract>(
                File.ReadAllText(args[0]),
                JsonOptions);
            if (contract == null || contract.SchemaVersion != 1 ||
                contract.Cases == null || contract.Modes == null)
            {
                Console.Error.WriteLine("Acceptance fixture contract is invalid.");
                return 2;
            }

            var evidence = new List<EvidenceRecord>();
            InteropWord.Application application = null;
            InteropWord.Document document = null;
            try
            {
                application = new InteropWord.Application
                {
                    Visible = true,
                    DisplayAlerts = InteropWord.WdAlertLevel.wdAlertsNone
                };
                document = application.Documents.Add();
                int? oleServerProcessId = oleMode
                    ? GetOfficeProcessId(application)
                    : (int?)null;
                var adapter = new WordAdapter(application, oleServerProcessId);
                if (!oleMode)
                    ValidateNativeInlineRoundTrip(
                        document,
                        adapter,
                        contract.Cases.First());

                foreach (AcceptanceCase fixture in contract.Cases)
                {
                    foreach (string modeName in contract.Modes)
                    {
                        EvidenceRecord record = ExecuteCase(
                            application,
                            document,
                            adapter,
                            fixture,
                            modeName,
                            evidenceDirectory,
                            oleMode,
                            svgDirectory);
                        evidence.Add(record);
                        Console.WriteLine(
                            $"{record.Status} {record.Name}/{record.Mode} " +
                            $"nary={record.ActualNaryCount} blankGapPx={record.MaximumBlankGapPixels} " +
                            $"rightMarginPx={record.RightBlankMarginPixels}");
                        DrainReleasedComObjects();
                    }
                }

                document.Fields.Update();
                ValidateAutomaticNumberSequence(document, evidence);
                string documentPath = Path.Combine(
                    evidenceDirectory,
                    oleMode ? "word-ole-acceptance.docx" : "word-nary-acceptance.docx");
                document.SaveAs2(documentPath, InteropWord.WdSaveFormat.wdFormatXMLDocument);
                File.WriteAllText(
                    Path.Combine(evidenceDirectory, "evidence.json"),
                    JsonSerializer.Serialize(evidence, JsonOptions));
                return evidence.All(item => item.Status == "passed") ? 0 : 1;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error);
                return 1;
            }
            finally
            {
                if (document != null)
                    document.Close(InteropWord.WdSaveOptions.wdDoNotSaveChanges);
                if (application != null)
                    application.Quit(InteropWord.WdSaveOptions.wdDoNotSaveChanges);
            }
        }

        private static void ValidateAutomaticNumberSequence(
            InteropWord.Document document,
            IReadOnlyList<EvidenceRecord> evidence)
        {
            int expectedCount = evidence.Count(item =>
                string.Equals(
                    item.Mode,
                    "displayNumbered",
                    StringComparison.OrdinalIgnoreCase));
            var sequenceFields = new List<InteropWord.Field>();
            foreach (InteropWord.Field field in document.Fields)
            {
                string code = field.Code?.Text ?? string.Empty;
                if (code.IndexOf(
                        "SEQ LaTeXSnipperEquation",
                        StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    sequenceFields.Add(field);
                }
            }
            if (sequenceFields.Count != expectedCount)
            {
                throw new InvalidOperationException(
                    $"Numbered formula field count changed: expected {expectedCount}, " +
                    $"observed {sequenceFields.Count}.");
            }

            for (int index = 0; index < sequenceFields.Count; index++)
            {
                string observed = (sequenceFields[index].Result?.Text ?? string.Empty)
                    .Trim('\r', '\a', ' ', '\t');
                string expected = (index + 1).ToString(
                    System.Globalization.CultureInfo.InvariantCulture);
                if (!string.Equals(observed, expected, StringComparison.Ordinal))
                {
                    throw new InvalidOperationException(
                        $"Numbered formula sequence did not advance at index {index}: " +
                        $"expected {expected}, observed '{observed}'.");
                }
            }
        }

        private static int GetOfficeProcessId(InteropWord.Application application)
        {
            IntPtr windowHandle = new IntPtr(application.ActiveWindow.Hwnd);
            if (GetWindowThreadProcessId(windowHandle, out uint processId) == 0 ||
                processId == 0 ||
                processId > int.MaxValue)
            {
                throw new InvalidOperationException(
                    "Could not resolve the Word process for OLE payload transport.");
            }
            return (int)processId;
        }

        private static void ValidateNativeInlineRoundTrip(
            InteropWord.Document document,
            WordAdapter adapter,
            AcceptanceCase fixture)
        {
            const string left = "INLINE-LEFT";
            const string right = "INLINE-RIGHT";
            InteropWord.Range paragraph =
                document.Range(document.Content.End - 1, document.Content.End - 1);
            paragraph.InsertParagraphAfter();
            paragraph.Collapse(InteropWord.WdCollapseDirection.wdCollapseEnd);
            int paragraphStart = paragraph.Start;
            paragraph.Text = left + right;
            document.Range(
                paragraphStart + left.Length,
                paragraphStart + left.Length).Select();

            string formulaId = FormulaIdHelper.NewId();
            InsertResult inserted = adapter.InsertFormula(
                new FormulaPayload
                {
                    FormulaId = formulaId,
                    Latex = fixture.Latex,
                    Omml = fixture.Omml,
                    Display = "inline",
                    StorageMode = "native-omml"
                },
                InsertMode.Inline);
            if (!inserted.Success)
                throw new InvalidOperationException(
                    $"inline anchor regression insert failed: {inserted.ErrorCode} {inserted.Error}");

            InteropWord.ContentControl candidate = FindCandidate(document, formulaId);
            if (candidate == null)
                throw new InvalidOperationException("inline anchor content control missing.");
            if (candidate.Range.Paragraphs.Count != 1 ||
                candidate.Range.Text.Contains(left) ||
                candidate.Range.Text.Contains(right))
                throw new InvalidOperationException(
                    "inline content control captured a paragraph or adjacent text.");

            string withFormula = document
                .Range(paragraphStart, document.Content.End - 1)
                .Paragraphs[1]
                .Range.Text;
            if (!withFormula.Contains(left) || !withFormula.Contains(right))
                throw new InvalidOperationException(
                    "inline insertion split or removed adjacent runs.");

            candidate.LockContents = false;
            candidate.LockContentControl = false;
            candidate.Delete(true);
            string afterDelete = document
                .Range(paragraphStart, document.Content.End - 1)
                .Paragraphs[1]
                .Range.Text.TrimEnd('\r', '\a');
            if (!string.Equals(afterDelete, left + right, StringComparison.Ordinal))
                throw new InvalidOperationException(
                    $"inline deletion did not preserve one paragraph of adjacent text: '{afterDelete}'");
        }

        private static EvidenceRecord ExecuteCase(
            InteropWord.Application application,
            InteropWord.Document document,
            WordAdapter adapter,
            AcceptanceCase fixture,
            string modeName,
            string evidenceDirectory,
            bool oleMode,
            string svgDirectory)
        {
            var mode = ParseMode(modeName);
            string formulaId = FormulaIdHelper.NewId();
            InteropWord.Range insertionPoint = document.Range(document.Content.End - 1, document.Content.End - 1);
            insertionPoint.InsertParagraphAfter();
            insertionPoint.Collapse(InteropWord.WdCollapseDirection.wdCollapseEnd);
            insertionPoint.Select();

            var payload = new FormulaPayload
            {
                FormulaId = formulaId,
                Latex = fixture.Latex,
                Omml = fixture.Omml,
                Display = oleMode && mode == InsertMode.Inline ? "inline" :
                    oleMode ? "block" : modeName,
                StorageMode = oleMode ? "ole" : "native-omml",
                Render = oleMode
                    ? CreateOleRenderData(
                        Path.Combine(svgDirectory, fixture.Svg),
                        mode,
                        fixture.RequestedWidthPt,
                        fixture.RequestedHeightPt)
                    : null
            };
            InsertResult inserted = adapter.InsertFormula(payload, mode);
            if (!inserted.Success)
                throw new InvalidOperationException(
                    $"{fixture.Name}/{modeName} insert failed: {inserted.ErrorCode} {inserted.Error}");

            InteropWord.ContentControl candidate = FindCandidate(document, formulaId);
            if (candidate == null)
                throw new InvalidOperationException($"{fixture.Name}/{modeName} content control missing.");

            int expectedNaryCount = 0;
            int actualNaryCount = 0;
            bool oleInitialized = false;
            bool oleRoundTripVerified = false;
            float hostWidthPt = 0;
            float hostHeightPt = 0;
            string oleDiagnostics = null;
            if (oleMode)
            {
                ValidateOleCandidate(
                    adapter,
                    candidate,
                    payload,
                    mode,
                    out oleInitialized,
                    out oleRoundTripVerified,
                    out hostWidthPt,
                    out hostHeightPt,
                    out oleDiagnostics);
            }
            else
            {
                OmmlValidationResult expected = OmmlValidator.Validate(fixture.Omml);
                OmmlValidationResult actual =
                    OmmlValidator.ValidateHostReadBack(fixture.Omml, candidate.Range.WordOpenXML);
                if (!actual.IsValid)
                    throw new InvalidOperationException(
                        $"{fixture.Name}/{modeName} read-back invalid: {actual.Issues[0].Code}");
                expectedNaryCount = expected.Naries.Count;
                actualNaryCount = actual.Naries.Count;
                ValidateModeLayout(candidate, mode);
            }

            string screenshotName = Sanitize(fixture.Name + "-" + modeName) + ".png";
            InteropWord.Range visualRange = !oleMode && mode == InsertMode.DisplayNumbered
                ? candidate.Range.Tables[1].Cell(1, 2).Range
                : candidate.Range;
            int rightBlankMargin;
            int maximumBlankGap = SaveRangeScreenshot(
                visualRange,
                Path.Combine(evidenceDirectory, screenshotName),
                out rightBlankMargin);
            if (maximumBlankGap >= MaximumBlankGapPixels)
                throw new InvalidOperationException(
                    $"{fixture.Name}/{modeName} screenshot contains a {maximumBlankGap}px " +
                    "internal blank gap.");
            if (string.Equals(
                    fixture.Name,
                    "extreme-wide-32-terms",
                    StringComparison.Ordinal) &&
                rightBlankMargin < MinimumRightBlankMarginPixels)
                throw new InvalidOperationException(
                    $"{fixture.Name}/{modeName} screenshot ink reaches the right edge " +
                    $"(blank margin {rightBlankMargin}px, host width {hostWidthPt:F2}pt).");
            return new EvidenceRecord
            {
                Name = fixture.Name,
                Mode = modeName,
                FormulaId = formulaId,
                ExpectedNaryCount = expectedNaryCount,
                ActualNaryCount = actualNaryCount,
                MaximumBlankGapPixels = maximumBlankGap,
                RightBlankMarginPixels = rightBlankMargin,
                Screenshot = screenshotName,
                StorageMode = inserted.StorageMode,
                OleInitialized = oleInitialized,
                OleRoundTripVerified = oleRoundTripVerified,
                HostWidthPt = hostWidthPt,
                HostHeightPt = hostHeightPt,
                OleDiagnostics = oleDiagnostics,
                Status = "passed"
            };
        }

        private static RenderData CreateOleRenderData(
            string svgPath,
            InsertMode mode,
            float requestedWidthPt,
            float requestedHeightPt)
        {
            string svg = File.ReadAllText(svgPath);
            Match viewBox = Regex.Match(
                svg,
                "\\bviewBox\\s*=\\s*[\"']\\s*" +
                "[-+0-9.eE]+[\\s,]+[-+0-9.eE]+[\\s,]+" +
                "([-+0-9.eE]+)[\\s,]+([-+0-9.eE]+)\\s*[\"']",
                RegexOptions.CultureInvariant);
            if (!viewBox.Success ||
                !double.TryParse(
                    viewBox.Groups[1].Value,
                    System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out double width) ||
                !double.TryParse(
                    viewBox.Groups[2].Value,
                    System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out double height) ||
                width <= 0 ||
                height <= 0)
            {
                throw new InvalidOperationException(
                    $"SVG fixture has no positive viewBox: {svgPath}");
            }
            double targetWidth;
            double targetHeight;
            if (requestedWidthPt > 0)
            {
                targetWidth = requestedWidthPt;
                targetHeight = requestedHeightPt > 0
                    ? requestedHeightPt
                    : requestedWidthPt * height / width;
            }
            else if (requestedHeightPt > 0)
            {
                targetHeight = requestedHeightPt;
                targetWidth = requestedHeightPt * width / height;
            }
            else
            {
                targetHeight = mode == InsertMode.Inline ? 14.0 : 28.0;
                targetWidth = Math.Min(420.0, targetHeight * width / height);
            }
            return new RenderData
            {
                Svg = svg,
                WidthPt = (float)targetWidth,
                HeightPt = (float)targetHeight
            };
        }

        private static void ValidateOleCandidate(
            WordAdapter adapter,
            InteropWord.ContentControl candidate,
            FormulaPayload payload,
            InsertMode mode,
            out bool initialized,
            out bool roundTripVerified,
            out float hostWidthPt,
            out float hostHeightPt,
            out string diagnostics)
        {
            if (candidate.Range.InlineShapes.Count != 1)
                throw new InvalidOperationException(
                    $"OLE content control owns {candidate.Range.InlineShapes.Count} inline shapes.");

            InteropWord.InlineShape shape = candidate.Range.InlineShapes[1];
            object automation = null;
            try
            {
                automation = shape.OLEFormat?.Object;
                if (automation == null)
                    throw new InvalidOperationException("Word returned no OLE automation object.");

                initialized = OleFormulaInterop.IsInitialized(automation);
                roundTripVerified = OleFormulaInterop.VerifyRoundTrip(automation, payload);
                if (!initialized || !roundTripVerified)
                    throw new InvalidOperationException(
                        $"OLE automation contract failed: initialized={initialized}, " +
                        $"roundTrip={roundTripVerified}.");

                if (!OleFormulaInterop.TryGetExtentPoints(automation, out OleExtentPoints extent))
                    throw new InvalidOperationException("OLE object returned no valid extent.");
                hostWidthPt = shape.Width;
                hostHeightPt = shape.Height;
                if (!OleFormulaInterop.HostGeometryMatches(extent, hostWidthPt, hostHeightPt))
                    throw new InvalidOperationException(
                        $"Word/OLE extent mismatch: host={hostWidthPt:F2}x{hostHeightPt:F2}pt, " +
                        $"ole={extent.DisplayWidthPt:F2}x{extent.DisplayHeightPt:F2}pt.");
                float availableWidthPt = GetAvailableWidthPt(shape.Range);
                if (hostWidthPt > availableWidthPt + 0.75f)
                    throw new InvalidOperationException(
                        $"OLE formula exceeds its Word container: host={hostWidthPt:F2}pt, " +
                        $"available={availableWidthPt:F2}pt.");

                diagnostics = OleFormulaInterop.TryGetDiagnosticsJson(automation, out string value)
                    ? value
                    : null;
                if (string.IsNullOrWhiteSpace(diagnostics))
                    throw new InvalidOperationException("OLE object returned no diagnostics JSON.");
            }
            finally
            {
                if (automation != null && Marshal.IsComObject(automation))
                {
                    try { Marshal.FinalReleaseComObject(automation); }
                    catch (InvalidComObjectException ex)
                    {
                        System.Diagnostics.Debug.WriteLine(
                            "OLE automation object was already released: " + ex.Message);
                    }
                }
            }

            FormulaPayload readBack = adapter.ReadFormulaById(payload.FormulaId);
            if (readBack == null ||
                !string.Equals(readBack.StorageMode, "ole", StringComparison.Ordinal) ||
                !string.Equals(readBack.Latex, payload.Latex, StringComparison.Ordinal) ||
                string.IsNullOrWhiteSpace(readBack.Render?.Svg))
            {
                throw new InvalidOperationException("Word manifest OLE round-trip is incomplete.");
            }

            if (mode == InsertMode.Display && candidate.Range.Paragraphs[1].Alignment !=
                InteropWord.WdParagraphAlignment.wdAlignParagraphCenter)
            {
                throw new InvalidOperationException("Display OLE formula is not center aligned.");
            }
            if (mode == InsertMode.DisplayNumbered)
            {
                if (candidate.Range.Fields.Count < 1)
                    throw new InvalidOperationException("Numbered OLE formula has no SEQ field.");
                candidate.Range.Fields.Update();
                if (!Regex.IsMatch(candidate.Range.Text ?? "", @"\(\s*\d+\s*\)"))
                {
                    throw new InvalidOperationException(
                        $"Numbered OLE formula has incomplete delimiters after field update: " +
                        $"[{candidate.Range.Text}]");
                }
            }
            ReleaseComObject(shape);
        }

        private static void DrainReleasedComObjects()
        {
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();
            GC.WaitForPendingFinalizers();
        }

        private static void ReleaseComObject(object value)
        {
            if (value == null || !Marshal.IsComObject(value))
                return;
            try { Marshal.FinalReleaseComObject(value); }
            catch (InvalidComObjectException ex)
            {
                System.Diagnostics.Debug.WriteLine(
                    "COM test object was already released: " + ex.Message);
            }
        }

        private static float GetAvailableWidthPt(InteropWord.Range range)
        {
            var paragraphFormat = range.ParagraphFormat;
            float width;
            if (Convert.ToBoolean(
                range.get_Information(InteropWord.WdInformation.wdWithInTable)))
            {
                var cell = range.Cells[1];
                width = cell.Width - cell.LeftPadding - cell.RightPadding;
            }
            else
            {
                var pageSetup = range.Sections[1].PageSetup;
                width = pageSetup.PageWidth -
                    pageSetup.LeftMargin -
                    pageSetup.RightMargin;
            }
            return Math.Max(
                36.0f,
                width -
                    Math.Max(0.0f, paragraphFormat.LeftIndent) -
                    Math.Max(0.0f, paragraphFormat.RightIndent) -
                    4.0f);
        }

        private static InsertMode ParseMode(string mode)
        {
            if (string.Equals(mode, "inline", StringComparison.OrdinalIgnoreCase))
                return InsertMode.Inline;
            if (string.Equals(mode, "displayNumbered", StringComparison.OrdinalIgnoreCase))
                return InsertMode.DisplayNumbered;
            return InsertMode.Display;
        }

        private static InteropWord.ContentControl FindCandidate(InteropWord.Document document, string formulaId)
        {
            string tag = "latexsnipper:formula:" + formulaId;
            foreach (InteropWord.ContentControl control in document.ContentControls)
                if (string.Equals(control.Tag as string, tag, StringComparison.Ordinal))
                    return control;
            return null;
        }

        private static void ValidateModeLayout(
            InteropWord.ContentControl candidate,
            InsertMode mode)
        {
            if (mode == InsertMode.DisplayNumbered)
            {
                if (candidate.Range.Tables.Count != 1)
                    throw new InvalidOperationException("DisplayNumbered candidate has no layout table.");
                if (candidate.Range.Tables[1].Columns.Count != 3)
                    throw new InvalidOperationException("DisplayNumbered layout must have three columns.");
                return;
            }
            if (candidate.Range.Tables.Count != 0)
                throw new InvalidOperationException("Inline/Display unexpectedly contains a layout table.");
            if (mode == InsertMode.Display)
            {
                bool centered = false;
                foreach (InteropWord.Paragraph paragraph in candidate.Range.Paragraphs)
                    centered |= paragraph.Alignment == InteropWord.WdParagraphAlignment.wdAlignParagraphCenter;
                if (!centered)
                    throw new InvalidOperationException("Display formula is not center aligned.");
            }
        }

        private static int SaveRangeScreenshot(
            InteropWord.Range range,
            string path,
            out int rightBlankMargin)
        {
            range.Select();
            range.Application.Activate();
            Application.DoEvents();
            byte[] metafileBytes = range.EnhMetaFileBits as byte[];
            if (metafileBytes == null || metafileBytes.Length == 0)
                throw new InvalidOperationException("Word returned no enhanced metafile for the formula range.");
            int gap;
            int margin;
            using (var stream = new MemoryStream(metafileBytes))
            using (var metafile = new System.Drawing.Imaging.Metafile(stream))
            using (var bitmap = new Bitmap(
                Math.Max(1, metafile.Width),
                Math.Max(1, metafile.Height),
                System.Drawing.Imaging.PixelFormat.Format32bppArgb))
            {
                using (Graphics graphics = Graphics.FromImage(bitmap))
                {
                    graphics.Clear(Color.White);
                    graphics.DrawImage(metafile, 0, 0, bitmap.Width, bitmap.Height);
                }
                bitmap.Save(path, System.Drawing.Imaging.ImageFormat.Png);
                AnalyzeHorizontalInk(bitmap, out gap, out margin);
            }
            rightBlankMargin = margin;
            return gap;
        }

        private static void AnalyzeHorizontalInk(
            Bitmap bitmap,
            out int maximumInternalBlankColumnRun,
            out int rightBlankMargin)
        {
            var ink = new bool[bitmap.Width];
            for (int x = 0; x < bitmap.Width; x++)
            {
                for (int y = 0; y < bitmap.Height; y++)
                {
                    Color pixel = bitmap.GetPixel(x, y);
                    if (pixel.A > 16 && (pixel.R < 245 || pixel.G < 245 || pixel.B < 245))
                    {
                        ink[x] = true;
                        break;
                    }
                }
            }
            int first = Array.FindIndex(ink, value => value);
            int last = Array.FindLastIndex(ink, value => value);
            if (first < 0 || last <= first)
                throw new InvalidOperationException("Word screenshot contains no measurable formula ink.");
            rightBlankMargin = bitmap.Width - 1 - last;
            int maximum = 0;
            int current = 0;
            for (int x = first; x <= last; x++)
            {
                if (ink[x])
                {
                    maximum = Math.Max(maximum, current);
                    current = 0;
                }
                else
                {
                    current++;
                }
            }
            maximumInternalBlankColumnRun = Math.Max(maximum, current);
        }

        private static string Sanitize(string value)
        {
            foreach (char invalid in Path.GetInvalidFileNameChars())
                value = value.Replace(invalid, '_');
            return value;
        }
    }
}

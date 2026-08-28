using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Windows.Forms;
using LaTeXSnipper.Excel.Host;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.PowerPoint.Host;
using OfficeCore = Microsoft.Office.Core;
using InteropExcel = Microsoft.Office.Interop.Excel;
using InteropPowerPoint = Microsoft.Office.Interop.PowerPoint;

namespace LaTeXSnipper.Office.SampleHostTests
{
    internal sealed class HostEvidence
    {
        public string Host { get; set; }
        public string File { get; set; }
        public int ImageCount { get; set; }
        public int OleCount { get; set; }
        public List<string> ImageNames { get; set; } = new List<string>();
        public List<string> OleNames { get; set; } = new List<string>();
        public List<string> EditableKinds { get; set; } = new List<string>();
        public string Screenshot { get; set; }
        public string Status { get; set; }
    }

    internal static class Program
    {
        private const int ExpectedImages = 4;
        private const int ExpectedOleObjects = 4;
        private static readonly ManualResetEventSlim OfficeUiDelay = new ManualResetEventSlim(false);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(
            IntPtr windowHandle,
            out uint processId);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetWindowRect(IntPtr windowHandle, out WindowRect rect);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetForegroundWindow(IntPtr windowHandle);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ShowWindow(IntPtr windowHandle, int command);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool PrintWindow(IntPtr windowHandle, IntPtr deviceContext, uint flags);

        [StructLayout(LayoutKind.Sequential)]
        private struct WindowRect
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [STAThread]
        private static int Main(string[] args)
        {
            bool editableMediaMode = args.Length == 3 &&
                string.Equals(args[2], "--editable-media", StringComparison.OrdinalIgnoreCase);
            if ((args.Length != 2 && !editableMediaMode) || !Directory.Exists(args[0]))
            {
                Console.Error.WriteLine(
                    "Usage: LaTeXSnipper.Office.SampleHostTests.exe <samples-dir> <evidence.json> " +
                    "[--editable-media]");
                return 2;
            }

            string samples = Path.GetFullPath(args[0]);
            string evidencePath = Path.GetFullPath(args[1]);
            Directory.CreateDirectory(Path.GetDirectoryName(evidencePath));
            try
            {
                var evidence = new List<HostEvidence>
                {
                    ValidatePowerPoint(Path.Combine(
                        samples,
                        "LaTeXSnipper-PowerPoint-VSTO-Image-OLE.pptx")),
                    ValidateExcel(Path.Combine(
                        samples,
                        "LaTeXSnipper-Excel-VSTO-Image-OLE.xlsx"))
                };
                if (editableMediaMode)
                {
                    string evidenceDirectory = Path.GetDirectoryName(evidencePath);
                    evidence.Add(ValidateEditablePowerPoint(evidenceDirectory));
                    evidence.Add(ValidateEditableExcel(evidenceDirectory));
                }
                File.WriteAllText(
                    evidencePath,
                    JsonSerializer.Serialize(
                        evidence,
                        new JsonSerializerOptions { WriteIndented = true }));
                foreach (HostEvidence item in evidence)
                    Console.WriteLine(
                        $"passed {item.Host} images={item.ImageCount} ole={item.OleCount}");
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error);
                return 1;
            }
        }

        private static HostEvidence ValidateEditablePowerPoint(string evidenceDirectory)
        {
            string output = Path.Combine(evidenceDirectory, "editable-media-powerpoint.pptx");
            string screenshot = Path.Combine(evidenceDirectory, "editable-media-powerpoint.png");
            InteropPowerPoint.Application application = null;
            InteropPowerPoint.Presentations presentations = null;
            InteropPowerPoint.Presentation presentation = null;
            InteropPowerPoint.Slides slides = null;
            InteropPowerPoint.Slide slide = null;
            try
            {
                application = new InteropPowerPoint.Application();
                presentations = application.Presentations;
                presentation = presentations.Add(OfficeCore.MsoTriState.msoTrue);
                slides = presentation.Slides;
                slide = slides.Add(1, InteropPowerPoint.PpSlideLayout.ppLayoutBlank);
                var adapter = new PowerPointAdapter(
                    application,
                    GetOfficeProcessId(new IntPtr(application.HWND), "PowerPoint"));
                var imageNames = new List<string>();
                var oleNames = new List<string>();
                var kinds = new List<string>();
                var specifications = EditableMediaSpecifications();
                for (int index = 0; index < specifications.Count; index++)
                {
                    EditableMediaSpecification specification = specifications[index];
                    FormulaPayload payload = CreateEditablePayload(specification, index);
                    LaTeXSnipper.PowerPoint.Host.InsertResult inserted =
                        adapter.InsertFormula(payload, InsertMode.Inline);
                    if (!inserted.Success)
                        throw new InvalidOperationException(
                            $"PowerPoint {specification.Kind}/{specification.StorageMode} failed: " +
                            $"{inserted.ErrorCode} {inserted.Error}");
                    InteropPowerPoint.Shape shape = slide.Shapes[$"LSNO_{payload.FormulaId}"];
                    try
                    {
                        shape.Left = index % 2 == 0 ? 34f : 372f;
                        shape.Top = index < 2 ? 70f : 255f;
                        if (specification.StorageMode == "ole")
                        {
                            application.ActiveWindow.Activate();
                            shape.Select(OfficeCore.MsoTriState.msoTrue);
                            PumpOfficeMessages(100);
                            FormulaPayload readBack = adapter.ReadSelection();
                            VerifyEditableReadBack("PowerPoint", payload, readBack);
                            oleNames.Add(shape.Name);
                            kinds.Add(payload.ContentKind);
                        }
                        else
                        {
                            imageNames.Add(shape.Name);
                        }
                    }
                    finally
                    {
                        Release(shape);
                    }
                }
                presentation.SaveAs(output, InteropPowerPoint.PpSaveAsFileType.ppSaveAsOpenXMLPresentation);
                slide.Export(screenshot, "PNG", 1600, 900);
                return new HostEvidence
                {
                    Host = "PowerPoint-editable-media",
                    File = output,
                    ImageCount = imageNames.Count,
                    OleCount = oleNames.Count,
                    ImageNames = imageNames,
                    OleNames = oleNames,
                    EditableKinds = kinds,
                    Screenshot = screenshot,
                    Status = "passed"
                };
            }
            finally
            {
                if (presentation != null) presentation.Close();
                if (application != null) application.Quit();
                Release(slide);
                Release(slides);
                Release(presentation);
                Release(presentations);
                Release(application);
            }
        }

        private static HostEvidence ValidateEditableExcel(string evidenceDirectory)
        {
            string output = Path.Combine(evidenceDirectory, "editable-media-excel.xlsx");
            string screenshot = Path.Combine(evidenceDirectory, "editable-media-excel.png");
            InteropExcel.Application application = null;
            InteropExcel.Workbooks workbooks = null;
            InteropExcel.Workbook workbook = null;
            InteropExcel.Worksheet sheet = null;
            try
            {
                application = new InteropExcel.Application { Visible = true, DisplayAlerts = false };
                workbooks = application.Workbooks;
                workbook = workbooks.Add();
                sheet = workbook.ActiveSheet as InteropExcel.Worksheet;
                if (sheet == null) throw new InvalidOperationException("Excel created no active sheet.");
                sheet.Name = "Editable media";
                var adapter = new ExcelAdapter(
                    application,
                    GetOfficeProcessId(new IntPtr(application.Hwnd), "Excel"));
                var imageNames = new List<string>();
                var oleNames = new List<string>();
                var kinds = new List<string>();
                var specifications = EditableMediaSpecifications();
                string[] anchors = { "A1", "G1", "A13", "G13" };
                for (int index = 0; index < specifications.Count; index++)
                {
                    InteropExcel.Range cell = sheet.Range[anchors[index]];
                    try { cell.Select(); }
                    finally { Release(cell); }
                    EditableMediaSpecification specification = specifications[index];
                    FormulaPayload payload = CreateEditablePayload(specification, index);
                    LaTeXSnipper.Excel.Host.InsertResult inserted =
                        adapter.InsertFormula(payload, InsertMode.Inline);
                    if (!inserted.Success)
                        throw new InvalidOperationException(
                            $"Excel {specification.Kind}/{specification.StorageMode} failed: " +
                            $"{inserted.ErrorCode} {inserted.Error}");
                    InteropExcel.Shape shape = FindExcelShape(sheet, payload.FormulaId);
                    try
                    {
                        if (specification.StorageMode == "ole")
                        {
                            shape.Select(OfficeCore.MsoTriState.msoTrue);
                            FormulaPayload readBack = adapter.ReadSelection();
                            VerifyEditableReadBack("Excel", payload, readBack);
                            oleNames.Add(shape.Name);
                            kinds.Add(payload.ContentKind);
                        }
                        else
                        {
                            imageNames.Add(shape.Name);
                        }
                    }
                    finally
                    {
                        Release(shape);
                    }
                }
                workbook.SaveAs(output, InteropExcel.XlFileFormat.xlOpenXMLWorkbook);
                SaveExcelScreenshot(application, sheet, screenshot);
                return new HostEvidence
                {
                    Host = "Excel-editable-media",
                    File = output,
                    ImageCount = imageNames.Count,
                    OleCount = oleNames.Count,
                    ImageNames = imageNames,
                    OleNames = oleNames,
                    EditableKinds = kinds,
                    Screenshot = screenshot,
                    Status = "passed"
                };
            }
            finally
            {
                if (workbook != null) workbook.Close(false);
                if (application != null) application.Quit();
                Release(sheet);
                Release(workbook);
                Release(workbooks);
                Release(application);
            }
        }

        private static List<EditableMediaSpecification> EditableMediaSpecifications()
        {
            return new List<EditableMediaSpecification>
            {
                new EditableMediaSpecification("drawing", "ole"),
                new EditableMediaSpecification("customSymbol", "ole"),
                new EditableMediaSpecification("drawing", "image"),
                new EditableMediaSpecification("customSymbol", "image")
            };
        }

        private static int GetOfficeProcessId(IntPtr windowHandle, string host)
        {
            if (windowHandle == IntPtr.Zero ||
                GetWindowThreadProcessId(windowHandle, out uint processId) == 0 ||
                processId == 0 ||
                processId > int.MaxValue)
            {
                throw new InvalidOperationException(
                    $"Could not resolve the {host} process for OLE payload transport.");
            }
            return (int)processId;
        }

        private static InteropExcel.Shape FindExcelShape(
            InteropExcel.Worksheet sheet,
            string formulaId)
        {
            string expectedName = $"LSNO_{formulaId}";
            for (int index = 1; index <= sheet.Shapes.Count; index++)
            {
                InteropExcel.Shape shape = sheet.Shapes.Item(index);
                bool matches = string.Equals(shape.Name, expectedName, StringComparison.Ordinal);
                if (!matches)
                {
                    try
                    {
                        FormulaPayload metadata = JsonSerializer.Deserialize<FormulaPayload>(
                            shape.AlternativeText ?? string.Empty,
                            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                        matches = metadata != null &&
                            string.Equals(metadata.FormulaId, formulaId, StringComparison.Ordinal);
                    }
                    catch (JsonException)
                    {
                        matches = false;
                    }
                }
                if (matches) return shape;
                Release(shape);
            }
            throw new InvalidOperationException(
                $"Excel inserted no shape carrying formula identity {formulaId}.");
        }

        private static FormulaPayload CreateEditablePayload(
            EditableMediaSpecification specification,
            int index)
        {
            string formulaId = Guid.NewGuid().ToString("N");
            string svg = CreateFixtureSvg(specification.Kind);
            string stateJson = specification.Kind == "drawing"
                ? "{\"schemaVersion\":1,\"kind\":\"drawing\",\"language\":\"tikz\",\"packageProfiles\":[],\"source\":\"\\\\node {中文 TikZ：输入 → 处理 → Office};\"}"
                : "{\"schemaVersion\":1,\"kind\":\"customSymbol\",\"bundle\":{\"schemaVersion\":1,\"symbol\":{\"name\":\"Vector Star\",\"composition\":{\"layers\":[{\"id\":\"star\",\"kind\":\"shape\",\"shape\":\"star\",\"x\":40,\"y\":48,\"width\":58,\"height\":58,\"color\":\"#2563EB\"},{\"id\":\"arrow\",\"kind\":\"shape\",\"shape\":\"arrow\",\"x\":120,\"y\":48,\"width\":104,\"height\":28,\"color\":\"#7C3AED\"}]}}}}";
            using JsonDocument document = JsonDocument.Parse(stateJson);
            return new FormulaPayload
            {
                FormulaId = formulaId,
                Latex = specification.Kind == "drawing" ? "drawing:tikz-cjk" : "custom-symbol:vector-star",
                Display = "block",
                StorageMode = specification.StorageMode,
                ContentKind = specification.Kind,
                EditorState = document.RootElement.Clone(),
                Render = new RenderData
                {
                    Svg = svg,
                    Png = CreateFixturePng(specification.Kind),
                    WidthPt = 260f,
                    HeightPt = 95f
                }
            };
        }

        private static void VerifyEditableReadBack(
            string host,
            FormulaPayload expected,
            FormulaPayload actual)
        {
            if (actual == null ||
                !string.Equals(actual.FormulaId, expected.FormulaId, StringComparison.Ordinal) ||
                !string.Equals(actual.StorageMode, "ole", StringComparison.Ordinal) ||
                !string.Equals(actual.ContentKind, expected.ContentKind, StringComparison.Ordinal) ||
                !actual.EditorState.HasValue ||
                !expected.EditorState.HasValue ||
                !JsonStateEquals(actual.EditorState.Value, expected.EditorState.Value))
            {
                throw new InvalidOperationException(
                    $"{host} did not preserve editable {expected.ContentKind} OLE state. " +
                    $"expectedId={expected.FormulaId} actualId={actual?.FormulaId ?? "<null>"}; " +
                    $"expectedKind={expected.ContentKind} actualKind={actual?.ContentKind ?? "<null>"}; " +
                    $"storage={actual?.StorageMode ?? "<null>"}; editorState={actual?.EditorState.HasValue == true}");
            }
        }

        private static string CreateFixtureSvg(string kind)
        {
            if (kind == "drawing")
            {
                return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 520 190\">" +
                    "<rect x=\"20\" y=\"55\" width=\"140\" height=\"80\" fill=\"#eff6ff\" stroke=\"#2563eb\" stroke-width=\"6\"/>" +
                    "<path d=\"M260 25L350 95L260 165L170 95Z\" fill=\"#faf5ff\" stroke=\"#7c3aed\" stroke-width=\"6\"/>" +
                    "<rect x=\"360\" y=\"55\" width=\"140\" height=\"80\" fill=\"#ecfdf5\" stroke=\"#059669\" stroke-width=\"6\"/>" +
                    "<path d=\"M160 90H174V80L188 95L174 110V100H160ZM350 90H364V80L378 95L364 110V100H350Z\" fill=\"#2563eb\"/>" +
                    "<circle cx=\"90\" cy=\"95\" r=\"17\" fill=\"#2563eb\"/><circle cx=\"260\" cy=\"95\" r=\"17\" fill=\"#7c3aed\"/><circle cx=\"430\" cy=\"95\" r=\"17\" fill=\"#059669\"/>" +
                    "<text x=\"260\" y=\"28\" text-anchor=\"middle\" font-family=\"Microsoft YaHei,Segoe UI,sans-serif\" font-size=\"20\" fill=\"#172033\">中文 TikZ：输入 → 处理 → Office</text></svg>";
            }
            return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 460 190\">" +
                "<path d=\"M95 18L114 69L168 71L126 105L141 157L95 127L49 157L64 105L22 71L76 69Z\" fill=\"#2563eb\"/>" +
                "<path d=\"M174 89H398V68L438 95L398 122V101H174Z\" fill=\"#7c3aed\"/></svg>";
        }

        private static string CreateFixturePng(string kind)
        {
            using var bitmap = new Bitmap(780, 285, PixelFormat.Format32bppArgb);
            using Graphics graphics = Graphics.FromImage(bitmap);
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.Clear(Color.White);
            using var blue = new SolidBrush(Color.FromArgb(37, 99, 235));
            using var violet = new Pen(Color.FromArgb(124, 58, 237), 16f)
            {
                StartCap = LineCap.Round,
                EndCap = LineCap.ArrowAnchor
            };
            if (kind == "drawing")
            {
                using var outline = new Pen(Color.FromArgb(37, 99, 235), 8f);
                graphics.DrawRectangle(outline, new Rectangle(30, 80, 210, 120));
                graphics.DrawLine(violet, 250, 140, 500, 140);
                graphics.DrawRectangle(outline, new Rectangle(520, 80, 220, 120));
                using var font = new Font("Microsoft YaHei", 25f, FontStyle.Bold);
                using var titleFont = new Font("Microsoft YaHei", 20f, FontStyle.Bold);
                using var ink = new SolidBrush(Color.FromArgb(23, 32, 51));
                graphics.DrawString("中文 TikZ：输入 → 处理 → Office", titleFont, ink, 180, 24);
                graphics.DrawString("输入", font, ink, 94, 120);
                graphics.DrawString("处理", font, ink, 364, 120);
                graphics.DrawString("Office", font, ink, 575, 120);
            }
            else
            {
                PointF[] star = Enumerable.Range(0, 10).Select(point =>
                {
                    double angle = -Math.PI / 2 + point * Math.PI / 5;
                    double radius = point % 2 == 0 ? 100 : 42;
                    return new PointF(
                        150 + (float)(Math.Cos(angle) * radius),
                        142 + (float)(Math.Sin(angle) * radius));
                }).ToArray();
                graphics.FillPolygon(blue, star);
                graphics.DrawLine(violet, 280, 142, 700, 142);
            }
            using var stream = new MemoryStream();
            bitmap.Save(stream, ImageFormat.Png);
            return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
        }

        private static void SaveExcelScreenshot(
            InteropExcel.Application application,
            InteropExcel.Worksheet sheet,
            string path)
        {
            InteropExcel.Range range = sheet.Range["A1", "L26"];
            try
            {
                IntPtr windowHandle = new IntPtr(application.Hwnd);
                application.Visible = true;
                application.WindowState = InteropExcel.XlWindowState.xlMaximized;
                ShowWindow(windowHandle, 3);
                SetForegroundWindow(windowHandle);
                sheet.Activate();
                range.Select();
                application.Goto(range, true);
                Application.DoEvents();
                PumpOfficeMessages(800);
                for (int copyAttempt = 0; copyAttempt < 4; copyAttempt++)
                {
                    try
                    {
                        range.CopyPicture(
                            InteropExcel.XlPictureAppearance.xlScreen,
                            InteropExcel.XlCopyPictureFormat.xlBitmap);
                        for (int clipboardAttempt = 0; clipboardAttempt < 15; clipboardAttempt++)
                        {
                            Application.DoEvents();
                            PumpOfficeMessages(100);
                            if (!Clipboard.ContainsImage()) continue;
                            using Image image = Clipboard.GetImage();
                            image.Save(path, ImageFormat.Png);
                            return;
                        }
                    }
                    catch (COMException)
                    {
                        Application.DoEvents();
                        PumpOfficeMessages(250);
                    }
                }

                // Some Excel builds reject CopyPicture immediately after an embedded
                // OLE activation. Preserve real visual evidence by capturing the live
                // host window instead of treating clipboard timing as insertion failure.
                SaveWindowScreenshot(windowHandle, path);
            }
            finally
            {
                application.CutCopyMode = 0;
                Release(range);
            }
        }

        private static void SaveWindowScreenshot(IntPtr windowHandle, string path)
        {
            if (windowHandle == IntPtr.Zero || !GetWindowRect(windowHandle, out WindowRect rect))
                throw new InvalidOperationException("Could not resolve the Office window bounds for evidence capture.");
            int width = rect.Right - rect.Left;
            int height = rect.Bottom - rect.Top;
            if (width <= 0 || height <= 0)
                throw new InvalidOperationException("Office returned invalid window bounds for evidence capture.");
            using var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            using (Graphics graphics = Graphics.FromImage(bitmap))
            {
                IntPtr deviceContext = graphics.GetHdc();
                try
                {
                    if (!PrintWindow(windowHandle, deviceContext, 2))
                        graphics.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(width, height));
                }
                finally
                {
                    graphics.ReleaseHdc(deviceContext);
                }
            }
            if (IsNearlyBlack(bitmap))
                throw new InvalidOperationException("Office evidence capture returned a blank frame.");
            bitmap.Save(path, ImageFormat.Png);
        }

        private static bool IsNearlyBlack(Bitmap bitmap)
        {
            int litSamples = 0;
            int samples = 0;
            int stepX = Math.Max(1, bitmap.Width / 40);
            int stepY = Math.Max(1, bitmap.Height / 30);
            for (int y = 0; y < bitmap.Height; y += stepY)
            {
                for (int x = 0; x < bitmap.Width; x += stepX)
                {
                    Color color = bitmap.GetPixel(x, y);
                    samples++;
                    if (color.R + color.G + color.B > 45) litSamples++;
                }
            }
            return samples == 0 || litSamples < samples / 100;
        }

        private static bool JsonStateEquals(JsonElement left, JsonElement right)
        {
            return string.Equals(
                JsonSerializer.Serialize(left),
                JsonSerializer.Serialize(right),
                StringComparison.Ordinal);
        }

        private sealed class EditableMediaSpecification
        {
            public EditableMediaSpecification(string kind, string storageMode)
            {
                Kind = kind;
                StorageMode = storageMode;
            }

            public string Kind { get; }
            public string StorageMode { get; }
        }

        private static HostEvidence ValidatePowerPoint(string path)
        {
            RequireFile(path);
            InteropPowerPoint.Application application = null;
            InteropPowerPoint.Presentations presentations = null;
            InteropPowerPoint.Presentation presentation = null;
            InteropPowerPoint.Slides slides = null;
            var imageNames = new List<string>();
            var oleNames = new List<string>();
            try
            {
                application = new InteropPowerPoint.Application();
                presentations = application.Presentations;
                presentation = presentations.Open(
                    path,
                    OfficeCore.MsoTriState.msoTrue,
                    OfficeCore.MsoTriState.msoFalse,
                    OfficeCore.MsoTriState.msoTrue);
                slides = presentation.Slides;
                for (int slideIndex = 1; slideIndex <= slides.Count; slideIndex++)
                {
                    InteropPowerPoint.Slide slide = slides[slideIndex];
                    InteropPowerPoint.Shapes shapes = null;
                    try
                    {
                        shapes = slide.Shapes;
                        for (int shapeIndex = 1; shapeIndex <= shapes.Count; shapeIndex++)
                        {
                            InteropPowerPoint.Shape shape = shapes[shapeIndex];
                            try
                            {
                                ClassifyShape(shape.Name, shape.Type, imageNames, oleNames);
                            }
                            finally
                            {
                                Release(shape);
                            }
                        }
                    }
                    finally
                    {
                        Release(shapes);
                        Release(slide);
                    }
                }
                return Complete("PowerPoint", path, imageNames, oleNames);
            }
            finally
            {
                if (presentation != null)
                    presentation.Close();
                if (application != null)
                    application.Quit();
                Release(slides);
                Release(presentation);
                Release(presentations);
                Release(application);
            }
        }

        private static HostEvidence ValidateExcel(string path)
        {
            RequireFile(path);
            InteropExcel.Application application = null;
            InteropExcel.Workbooks workbooks = null;
            InteropExcel.Workbook workbook = null;
            InteropExcel.Sheets worksheets = null;
            var imageNames = new List<string>();
            var oleNames = new List<string>();
            try
            {
                application = new InteropExcel.Application
                {
                    Visible = true,
                    DisplayAlerts = false
                };
                workbooks = application.Workbooks;
                workbook = workbooks.Open(path, ReadOnly: true);
                worksheets = workbook.Worksheets;
                for (int sheetIndex = 1; sheetIndex <= worksheets.Count; sheetIndex++)
                {
                    InteropExcel.Worksheet worksheet = worksheets[sheetIndex] as InteropExcel.Worksheet;
                    InteropExcel.Shapes shapes = null;
                    try
                    {
                        shapes = worksheet.Shapes;
                        for (int shapeIndex = 1; shapeIndex <= shapes.Count; shapeIndex++)
                        {
                            InteropExcel.Shape shape = shapes.Item(shapeIndex);
                            try
                            {
                                ClassifyShape(shape.Name, shape.Type, imageNames, oleNames);
                            }
                            finally
                            {
                                Release(shape);
                            }
                        }
                    }
                    finally
                    {
                        Release(shapes);
                        Release(worksheet);
                    }
                }
                return Complete("Excel", path, imageNames, oleNames);
            }
            finally
            {
                if (workbook != null)
                    workbook.Close(false);
                if (application != null)
                    application.Quit();
                Release(worksheets);
                Release(workbook);
                Release(workbooks);
                Release(application);
            }
        }

        private static void ClassifyShape(
            string name,
            OfficeCore.MsoShapeType type,
            ICollection<string> imageNames,
            ICollection<string> oleNames)
        {
            if (name.StartsWith("LSNO_PERSISTED_", StringComparison.Ordinal))
            {
                if (type != OfficeCore.MsoShapeType.msoEmbeddedOLEObject)
                    throw new InvalidOperationException(
                        $"{name} is not an embedded OLE object (type={type}).");
                oleNames.Add(name);
            }
            else if (name.StartsWith("LSNO_", StringComparison.Ordinal))
            {
                if (type != OfficeCore.MsoShapeType.msoPicture)
                    throw new InvalidOperationException(
                        $"{name} is not a persisted picture (type={type}).");
                imageNames.Add(name);
            }
        }

        private static HostEvidence Complete(
            string host,
            string path,
            List<string> imageNames,
            List<string> oleNames)
        {
            if (imageNames.Count != ExpectedImages || oleNames.Count != ExpectedOleObjects)
                throw new InvalidOperationException(
                    $"{host} persisted object count changed: " +
                    $"images={imageNames.Count}/{ExpectedImages}, " +
                    $"ole={oleNames.Count}/{ExpectedOleObjects}.");
            if (imageNames.Distinct(StringComparer.Ordinal).Count() != imageNames.Count ||
                oleNames.Distinct(StringComparer.Ordinal).Count() != oleNames.Count)
                throw new InvalidOperationException($"{host} contains duplicate formula object names.");
            return new HostEvidence
            {
                Host = host,
                File = path,
                ImageCount = imageNames.Count,
                OleCount = oleNames.Count,
                ImageNames = imageNames,
                OleNames = oleNames,
                Status = "passed"
            };
        }

        private static void RequireFile(string path)
        {
            if (!System.IO.File.Exists(path))
                throw new FileNotFoundException("Office sample is missing.", path);
        }

        private static void PumpOfficeMessages(int milliseconds)
        {
            int duration = Math.Max(0, milliseconds);
            var stopwatch = System.Diagnostics.Stopwatch.StartNew();
            while (stopwatch.ElapsedMilliseconds < duration)
            {
                Application.DoEvents();
                long remaining = duration - stopwatch.ElapsedMilliseconds;
                OfficeUiDelay.Wait((int)Math.Min(remaining, 15));
            }
        }

        private static void Release(object value)
        {
            if (value == null || !Marshal.IsComObject(value))
                return;
            try { Marshal.FinalReleaseComObject(value); }
            catch (InvalidComObjectException) { return; }
        }
    }
}

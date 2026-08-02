using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
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
        public string Status { get; set; }
    }

    internal static class Program
    {
        private const int ExpectedImages = 4;
        private const int ExpectedOleObjects = 4;

        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length != 2 || !Directory.Exists(args[0]))
            {
                Console.Error.WriteLine(
                    "Usage: LaTeXSnipper.Office.SampleHostTests.exe <samples-dir> <evidence.json>");
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

        private static void Release(object value)
        {
            if (value == null || !Marshal.IsComObject(value))
                return;
            try { Marshal.FinalReleaseComObject(value); }
            catch (InvalidComObjectException) { return; }
        }
    }
}

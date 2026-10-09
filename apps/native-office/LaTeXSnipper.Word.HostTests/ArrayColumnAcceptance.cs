using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Xml.Linq;
using LaTeXSnipper.NativeOffice.Shared;
using LaTeXSnipper.Word.Host;
using W = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.HostTests
{
    internal static class ArrayColumnAcceptance
    {
        private static readonly XNamespace Math = "http://schemas.openxmlformats.org/officeDocument/2006/math";
        private static void Check(bool value, string error) { if (!value) throw new InvalidOperationException(error); }
        private static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }

        private static void ValidateFingerprintBoundaries()
        {
            const string xml = "<pkg:package xmlns:pkg='http://schemas.microsoft.com/office/2006/xmlPackage' xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main' xmlns:m='http://schemas.openxmlformats.org/officeDocument/2006/math'><pkg:part pkg:name='/word/document.xml'><pkg:xmlData><w:document><w:body><w:tbl><w:tblGrid><w:gridCol w:w='800'/></w:tblGrid><w:tr w:rsidTr='00112233'><w:tc><w:p><m:oMath><m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:mcJc m:val='left'/></m:mcPr></m:mc></m:mcs></m:mPr><m:mr><m:e><m:r><m:t>a</m:t></m:r></m:e></m:mr></m:m></m:oMath></w:p></w:tc></w:tr></w:tbl></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>";
            string fingerprint = WordAdapter.DeleteSourceFingerprint(xml);
            Check(fingerprint == WordAdapter.DeleteSourceFingerprint(xml.Replace("00112233", "44556677")), "Generated row revision stamp changed identity.");
            foreach (string changed in new[] { xml.Replace("w:w='800'", "w:w='801'"), xml.Replace("m:val='left'", "m:val='right'"), xml.Replace("<m:t>a", "<m:t>b"), xml.Replace("w:rsidTr=", "w:customIdentity=") })
                Check(fingerprint != WordAdapter.DeleteSourceFingerprint(changed), "Real geometry, column layout, content or unknown identity disappeared from fingerprint.");
            const string prefix = "<m:oMath xmlns:m='http://schemas.openxmlformats.org/officeDocument/2006/math'>";
            const string suffix = "</m:oMath>";
            const string alpha = "<m:r><m:t>α</m:t></m:r>", x = "<m:r><m:t>x</m:t></m:r>";
            string separate = prefix + alpha + x + suffix;
            string merged = prefix + "<m:r><m:t>αx</m:t></m:r>" + suffix;
            Check(WordAdapter.MathText(separate) == WordAdapter.MathText(merged), "Equal-property run coalescing changed text identity.");
            foreach (string changed in new[] {
                merged.Replace("αx", "αy"),
                prefix + alpha + "<m:r><m:rPr><m:nor/></m:rPr><m:t>x</m:t></m:r>" + suffix,
                prefix + "<m:f><m:num>" + alpha + "</m:num><m:den>" + x + "</m:den></m:f>" + suffix
            }) Check(WordAdapter.MathText(separate) != WordAdapter.MathText(changed), "Content, math style or operand ownership disappeared from text identity.");
            string fraction = prefix + "<m:f><m:num>" + alpha + "</m:num><m:den>" + x + "</m:den></m:f>" + suffix;
            string moved = prefix + "<m:f><m:num>" + alpha + x + "</m:num><m:den/></m:f>" + suffix;
            Check(WordAdapter.MathText(fraction) != WordAdapter.MathText(moved), "Moving text between fraction operands was accepted.");
            string cells = prefix + "<m:m><m:mr><m:e>" + alpha + "</m:e><m:e>" + x + "</m:e></m:mr></m:m>" + suffix;
            string movedCell = prefix + "<m:m><m:mr><m:e>" + alpha + x + "</m:e><m:e/></m:mr></m:m>" + suffix;
            Check(WordAdapter.MathText(cells) != WordAdapter.MathText(movedCell), "Moving text between array cells was accepted.");
            Check(WordAdapter.MathText(separate) != WordAdapter.MathText("<root>" + prefix + alpha + suffix + prefix + x + suffix + "</root>"), "Moving text between math objects was accepted.");
        }

        // Word may coalesce adjacent columns with equal justification. Compare expanded groups.
        private static string Layout(string xml)
        {
            var matrices = XDocument.Parse(xml).Descendants(Math + "m").ToList();
            Check(matrices.Count != 0, "No mathematical array was found in host XML.");
            return string.Join("|", matrices.Select(matrix => {
                var columns = new List<string>();
                var groups = matrix.Element(Math + "mPr")?.Element(Math + "mcs")?.Elements(Math + "mc");
                if (groups != null) foreach (var group in groups)
                {
                    var properties = group.Element(Math + "mcPr");
                    string rawCount = (string)properties?.Element(Math + "count")?.Attribute(Math + "val");
                    int count = rawCount == null ? 1 : int.Parse(rawCount);
                    Check(count > 0 && count <= 128 && columns.Count + count <= 128, "Invalid host column group.");
                    string alignment = (string)properties?.Element(Math + "mcJc")?.Attribute(Math + "val") ?? "center";
                    Check(new[] { "left", "center", "right" }.Contains(alignment), "Invalid host column alignment.");
                    columns.AddRange(Enumerable.Repeat(alignment, count));
                }
                var rows = matrix.Elements(Math + "mr").Select(row => row.Elements(Math + "e").Count()).ToArray();
                Check(columns.Count != 0 && rows.Length != 0 && rows.All(width => width == columns.Count), "Column declarations and row widths disagree.");
                return string.Join(",", columns) + ":" + string.Join(",", rows);
            }));
        }

        private static string ReadLayout(W.Document document, WordAdapter adapter, string id, string source, string expectedOmml, string directory)
        {
            var controls = document.SelectContentControlsByTag("latexsnipper:formula:" + id);
            W.ContentControl control = null; W.Range range = null;
            try
            {
                Check(controls.Count == 1, "Managed array identity is missing or ambiguous.");
                control = controls[1]; range = control.Range;
                FormulaPayload payload;
                try { payload = adapter.ReadFormulaById(id); }
                catch
                {
                    File.WriteAllText(Path.Combine(directory, "native-source-expected.xml"), expectedOmml);
                    File.WriteAllText(Path.Combine(directory, "native-source-observed.xml"), range.WordOpenXML);
                    throw;
                }
                Check(payload != null && payload.Latex == source && payload.StorageMode == "native-omml", "Array source or storage identity changed.");
                string expectedText = string.Concat(XDocument.Parse(expectedOmml).Descendants(Math + "t").Select(text => text.Value));
                string actualText = string.Concat(XDocument.Parse(range.WordOpenXML).Descendants(Math + "t").Select(text => text.Value));
                Check(actualText == expectedText, "Host mathematical text differs from the retained Core payload.");
                return Layout(range.WordOpenXML);
            }
            finally { Release(range); Release(control); Release(controls); }
        }

        public static int Run(W.Application application, ref W.Document document, IReadOnlyList<AcceptanceCase> fixtures, string directory, string coreCommit)
        {
            var records = new List<object>(); var inserted = new List<Tuple<AcceptanceCase, string, string, string>>();
            string error = null;
            try
            {
                ValidateFingerprintBoundaries();
                Program.RequireHiddenWord(application);
                document.Content.Text = "Array acceptance boundary before\rArray acceptance boundary after\r";
                var adapter = new WordAdapter(application);
                adapter.CopiedIdentityFingerprintMismatchForTest = (expected, observed) => {
                    File.WriteAllText(Path.Combine(directory, "identity-expected.txt"), expected);
                    File.WriteAllText(Path.Combine(directory, "identity-observed.txt"), observed);
                };
                foreach (var fixture in fixtures)
                foreach (var mode in new[] { InsertMode.Inline, InsertMode.Display, InsertMode.DisplayNumbered })
                {
                    string expected = Layout(fixture.Omml), id = FormulaIdHelper.NewId();
                    var payload = new FormulaPayload { FormulaId = id, Latex = fixture.Latex, Omml = fixture.Omml,
                        Display = mode == InsertMode.Inline ? "inline" : "block", StorageMode = "native-omml" };
                    W.Range end = null; W.Range content = null;
                    try
                    {
                        content = document.Content; end = document.Range(content.End - 1, content.End - 1);
                        end.InsertParagraphAfter(); end.Collapse(W.WdCollapseDirection.wdCollapseEnd); end.Select();
                        var result = adapter.InsertFormula(payload, mode);
                        Check(result.Success, "Array insertion failed: " + result.ErrorCode + ": " + result.Error);
                    }
                    finally { Release(end); Release(content); }
                    Program.RequireHiddenWord(application);
                    string actual = ReadLayout(document, adapter, id, fixture.Latex, fixture.Omml, directory);
                    Check(actual == expected, "Inserted array column layout differs from Core output: " + fixture.Name + "/" + mode);
                    inserted.Add(Tuple.Create(fixture, id, mode.ToString(), expected));
                }
                string path = Path.Combine(directory, "arrays.docx");
                Check(!File.Exists(path), "Array evidence document already exists.");
                document.SaveAs2(path, W.WdSaveFormat.wdFormatXMLDocument);
                document.Close(W.WdSaveOptions.wdDoNotSaveChanges); Release(document); document = null;
                document = application.Documents.Open(path, ReadOnly: true, AddToRecentFiles: false, Visible: true);
                Program.RequireHiddenWord(application);
                adapter = new WordAdapter(application);
                foreach (var item in inserted)
                {
                    string actual = ReadLayout(document, adapter, item.Item2, item.Item1.Latex, item.Item1.Omml, directory);
                    Check(actual == item.Item4, "Saved array layout differs: " + item.Item1.Name + "/" + item.Item3);
                    records.Add(new { name = item.Item1.Name, mode = item.Item3, expected = item.Item4, observed = actual,
                        sourcePreserved = true, mathematicalTextPreserved = true, savedReadonlyReopen = true });
                }
                W.Range boundary = document.Content;
                try { Check(boundary.Text.Contains("Array acceptance boundary before") && boundary.Text.Contains("Array acceptance boundary after"), "Surrounding text changed."); }
                finally { Release(boundary); }
            }
            catch (Exception exception) { error = exception.ToString(); Console.Error.WriteLine(error); }
            File.WriteAllText(Path.Combine(directory, "array-column-evidence.json"), JsonSerializer.Serialize(new {
                schemaVersion = 1, status = error == null ? "passed" : "failed", officeVersion = application.Version, generatedByCoreCommit = coreCommit,
                expectedCount = fixtures.Count * 3, completedCount = records.Count, records, error
            }, new JsonSerializerOptions { WriteIndented = true }));
            return error == null ? 0 : 1;
        }
    }
}

using System;
using LaTeXSnipper.NativeOffice.Shared.Omml;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class WordNaryFixtureTests
    {
        private const string M =
            "http://schemas.openxmlformats.org/officeDocument/2006/math";
        private const string W =
            "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

        internal static int Run()
        {
            int failures = 0;
            foreach (string op in new[] { "∫", "∬", "∮", "∑", "∏" })
            {
                string math = Math(op);
                failures += ExpectValid("Inline/" + op, Inline(math));
                failures += ExpectValid("Display/" + op, Display(math));
                failures += ExpectValid("DisplayNumbered/" + op, Numbered(math));
            }

            string detached = "<m:oMath xmlns:m=\"" + M + "\">" +
                "<m:nary><m:naryPr><m:chr m:val=\"∫\"/></m:naryPr>" +
                "<m:sub>" + Run("0") + "</m:sub><m:sup>" + Run("1") +
                "</m:sup><m:e/></m:nary>" + Run("x dx") + "</m:oMath>";
            OmmlValidationResult result = OmmlValidator.Validate(Numbered(detached));
            failures += Expect(
                !result.IsValid && result.HasIssue("OMML_NARY_OPERAND_DETACHED"),
                "numbered table wrapper hid a detached n-ary operand");
            return failures;
        }

        private static string Math(string op)
        {
            return "<m:oMath xmlns:m=\"" + M + "\">" +
                "<m:nary><m:naryPr><m:chr m:val=\"" + op +
                "\"/><m:limLoc m:val=\"subSup\"/><m:grow m:val=\"1\"/></m:naryPr>" +
                "<m:sub>" + Run("0") + "</m:sub><m:sup>" + Run("1") +
                "</m:sup><m:e>" + Run("x dx") + "</m:e></m:nary></m:oMath>";
        }

        private static string Run(string text) =>
            "<m:r><m:t>" + text + "</m:t></m:r>";

        private static string Inline(string math) =>
            "<w:p xmlns:w=\"" + W + "\" xmlns:m=\"" + M +
            "\"><w:r><w:t>A</w:t></w:r><w:sdt><w:sdtContent>" + math +
            "</w:sdtContent></w:sdt><w:r><w:t>B</w:t></w:r></w:p>";

        private static string Display(string math) =>
            "<w:sdt xmlns:w=\"" + W + "\" xmlns:m=\"" + M +
            "\"><w:sdtContent><w:p><w:pPr><w:jc w:val=\"center\"/></w:pPr>" +
            math + "</w:p></w:sdtContent></w:sdt>";

        private static string Numbered(string math) =>
            "<w:sdt xmlns:w=\"" + W + "\" xmlns:m=\"" + M +
            "\"><w:sdtContent><w:tbl><w:tr><w:tc><w:p/></w:tc><w:tc><w:p>" +
            math + "</w:p></w:tc><w:tc><w:p><w:r><w:t>(1)</w:t></w:r></w:p>" +
            "</w:tc></w:tr></w:tbl></w:sdtContent></w:sdt>";

        private static int ExpectValid(string name, string xml)
        {
            OmmlValidationResult result = OmmlValidator.Validate(xml);
            return Expect(result.IsValid, name + " failed structural validation");
        }

        private static int Expect(bool condition, string message)
        {
            if (condition) return 0;
            Console.Error.WriteLine("FAIL: " + message);
            return 1;
        }
    }
}

using System;
using LaTeXSnipper.NativeOffice.Shared.Omml;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class OmmlValidatorTests
    {
        private const string M =
            "http://schemas.openxmlformats.org/officeDocument/2006/math";

        internal static int Run()
        {
            int failures = 0;
            failures += ExpectValid("integral", Nary("∫", "0", "1", RunText("f(x)dx")));
            failures += ExpectValid("sum", Nary("∑", "i=0", "n", RunText("a_i")));
            failures += ExpectValid("product", Nary("∏", "i=1", "n", RunText("x_i")));
            failures += ExpectValid(
                "double integral",
                Nary("∬", "D", "", RunText("f(x,y)dA")));
            failures += ExpectValid(
                "nested n-ary",
                Nary("∫", "0", "1", NaryFragment("∑", "i=0", "n", RunText("a_i"))));

            string detached = Wrap(
                "<m:nary><m:naryPr><m:chr m:val=\"∫\"/></m:naryPr>" +
                "<m:sub>" + RunText("0") + "</m:sub>" +
                "<m:sup>" + RunText("1") + "</m:sup><m:e/>" +
                "</m:nary>" + RunText("f(x)dx"));
            OmmlValidationResult detachedResult = OmmlValidator.Validate(detached);
            failures += Expect(
                !detachedResult.IsValid &&
                detachedResult.HasIssue("OMML_NARY_OPERAND_DETACHED"),
                "detached operand was accepted");

            string relationAfter = Wrap(
                NaryFragment("∫", "0", "1", RunText("f(x)dx")) + RunText("="));
            failures += Expect(
                OmmlValidator.Validate(relationAfter).IsValid,
                "relation following a complete n-ary operator was rejected");

            string readBackMoved = Wrap(
                "<m:nary><m:naryPr><m:chr m:val=\"∫\"/></m:naryPr>" +
                "<m:sub>" + RunText("0") + "</m:sub>" +
                "<m:sup>" + RunText("1") + "</m:sup><m:e/>" +
                "</m:nary>" + RunText("f(x)dx"));
            OmmlValidationResult readBack =
                OmmlValidator.ValidateHostReadBack(Nary("∫", "0", "1", RunText("f(x)dx")), readBackMoved);
            failures += Expect(
                !readBack.IsValid && readBack.HasIssue("OMML_NARY_OPERAND_DETACHED"),
                "host read-back detached operand was accepted");

            string protectedExpected = Wrap(
                "<m:f><m:fPr><m:type m:val=\"lin\"/></m:fPr>" +
                "<m:num>" + RunText("a") + "</m:num><m:den>" + RunText("b") +
                "</m:den></m:f>" +
                "<m:rad><m:radPr><m:degHide m:val=\"0\"/></m:radPr>" +
                "<m:deg>" + RunText("3") + "</m:deg><m:e>" + RunText("x") +
                "</m:e></m:rad>" +
                "<m:d><m:dPr><m:begChr m:val=\"[\"/><m:endChr m:val=\"]\"/></m:dPr>" +
                "<m:e>" + RunText("y") + "</m:e></m:d>");
            string missingFraction = protectedExpected.Replace("<m:f>", "<m:r>")
                .Replace("</m:f>", "</m:r>");
            OmmlValidationResult missingFractionResult =
                OmmlValidator.ValidateHostReadBack(protectedExpected, missingFraction);
            failures += Expect(
                !missingFractionResult.IsValid &&
                missingFractionResult.HasIssue("OMML_HOST_STRUCTURE_COUNT_CHANGED"),
                "host read-back fraction loss was accepted");

            string changedDelimiter =
                protectedExpected.Replace("m:val=\"[\"", "m:val=\"(\"");
            OmmlValidationResult changedDelimiterResult =
                OmmlValidator.ValidateHostReadBack(protectedExpected, changedDelimiter);
            failures += Expect(
                !changedDelimiterResult.IsValid &&
                changedDelimiterResult.HasIssue("OMML_HOST_STRUCTURE_PROPERTY_CHANGED"),
                "host read-back delimiter change was accepted");
            return failures;
        }

        private static int ExpectValid(string name, string xml)
        {
            OmmlValidationResult result = OmmlValidator.Validate(xml);
            return Expect(result.IsValid, name + " fixture failed: " +
                (result.Issues.Count == 0 ? "unknown" : result.Issues[0].Code));
        }

        private static int Expect(bool condition, string message)
        {
            if (condition) return 0;
            Console.Error.WriteLine("FAIL: " + message);
            return 1;
        }

        private static string Nary(string character, string sub, string sup, string operand)
        {
            return Wrap(NaryFragment(character, sub, sup, operand));
        }

        private static string NaryFragment(string character, string sub, string sup, string operand)
        {
            return "<m:nary><m:naryPr><m:chr m:val=\"" + character + "\"/></m:naryPr>" +
                "<m:sub>" + RunText(sub) + "</m:sub>" +
                "<m:sup>" + RunText(sup) + "</m:sup>" +
                "<m:e>" + operand + "</m:e></m:nary>";
        }

        private static string RunText(string text)
        {
            return "<m:r><m:t>" + System.Security.SecurityElement.Escape(text) +
                   "</m:t></m:r>";
        }

        private static string Wrap(string body)
        {
            if (body.StartsWith("<m:oMath", StringComparison.Ordinal)) return body;
            return "<m:oMath xmlns:m=\"" + M + "\">" + body + "</m:oMath>";
        }
    }
}

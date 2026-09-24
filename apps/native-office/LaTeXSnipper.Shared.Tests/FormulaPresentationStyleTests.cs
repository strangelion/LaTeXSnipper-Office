#nullable enable
using System;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class FormulaPresentationStyleTests
    {
        public static int Run()
        {
            int failures = 0;
            failures += RunCase("versioned profile maps supported fields", VersionedProfileMapsSupportedFields);
            failures += RunCase("invalid profile falls back safely", InvalidProfileFallsBackSafely);
            failures += RunCase("numeric fields are clamped", NumericFieldsAreClamped);
            return failures;
        }

        private static int RunCase(string name, Action test)
        {
            try
            {
                test();
                Console.WriteLine("PASS FormulaPresentationStyle " + name);
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(
                    "FAIL FormulaPresentationStyle " + name + ": " + error.Message);
                return 1;
            }
        }

        private static void VersionedProfileMapsSupportedFields()
        {
            FormulaPresentationStyle style = FormulaPresentationStyle.From(
                Presentation(
                    "{\"schemaVersion\":1," +
                    "\"math\":{\"officeFont\":\"Cambria Math\",\"textFont\":\"Aptos\"," +
                    "\"fontSizePt\":24,\"fontWeight\":\"bold\",\"mathVariant\":\"roman\"," +
                    "\"color\":\"#112233\"}," +
                    "\"layout\":{\"displayMode\":\"display\",\"alignment\":\"right\"," +
                    "\"paragraphBeforePt\":6,\"paragraphAfterPt\":8,\"baselineShiftPt\":2," +
                    "\"maxWidthPt\":360},\"output\":{\"strategy\":\"fixed\"}}",
                    "left",
                    "#ABCDEF"));

            Expect(style.HasVersionedProfile, "schema v1 profile was not accepted");
            Expect(style.OfficeFont == "Cambria Math", "Office math font was not mapped");
            Expect(style.TextFont == "Aptos", "text font was not mapped");
            Expect(style.FontSizePt == 24.0f, "font size was not mapped");
            Expect(style.Bold == true, "font weight was not mapped");
            Expect(style.MathVariant == "roman", "math variant was not mapped");
            Expect(style.Alignment == "right", "profile alignment did not override legacy alignment");
            Expect(style.DisplayMode == "display", "display mode was not mapped");
            Expect(style.ParagraphBeforePt == 6.0f && style.ParagraphAfterPt == 8.0f,
                "paragraph spacing was not mapped");
            Expect(style.BaselineShiftPt == 2.0f, "baseline shift was not mapped");
            Expect(style.MaxWidthPt == 360.0f, "maximum width was not mapped");
            Expect(style.OutputStrategy == "fixed", "output strategy was not mapped");
            Expect(style.ColorHex == "#112233", "profile colour was not mapped");
            Expect(style.TryGetOfficeColor(out int bgr) && bgr == 0x332211,
                "RGB colour was not converted to the Office BGR representation");
        }

        private static void InvalidProfileFallsBackSafely()
        {
            FormulaPresentationStyle style = FormulaPresentationStyle.From(
                Presentation(
                    "{\"schemaVersion\":99,\"math\":{\"fontSizePt\":40,\"color\":\"#000000\"}}",
                    "left",
                    "#abcdef"));

            Expect(!style.HasVersionedProfile, "unknown schema version was applied");
            Expect(style.FontSizePt == null, "unknown schema leaked a versioned font size");
            Expect(style.Alignment == "left", "valid legacy alignment was not retained");
            Expect(style.ColorHex == "#ABCDEF", "valid legacy colour was not normalized");

            FormulaPresentationStyle malformed = FormulaPresentationStyle.From(
                Presentation("{\"schemaVersion\":1,\"math\":{\"color\":\"red\"}}", "bad", "also-bad"));
            Expect(malformed.Alignment == "center", "invalid alignment did not fall back");
            Expect(malformed.ColorHex == "#000000", "invalid colour did not fall back");
        }

        private static void NumericFieldsAreClamped()
        {
            FormulaPresentationStyle style = FormulaPresentationStyle.From(
                Presentation(
                    "{\"schemaVersion\":1,\"math\":{\"fontSizePt\":500}," +
                    "\"layout\":{\"paragraphBeforePt\":-1,\"paragraphAfterPt\":999," +
                    "\"baselineShiftPt\":-200,\"maxWidthPt\":1}}",
                    "center",
                    "#000000"));

            Expect(style.FontSizePt == 72.0f, "font size upper bound was not enforced");
            Expect(style.ParagraphBeforePt == 0.0f, "paragraph-before lower bound was not enforced");
            Expect(style.ParagraphAfterPt == 144.0f, "paragraph-after upper bound was not enforced");
            Expect(style.BaselineShiftPt == -36.0f, "baseline lower bound was not enforced");
            Expect(style.MaxWidthPt == 72.0f, "maximum-width lower bound was not enforced");
        }

        private static PresentationData Presentation(string profileJson, string alignment, string color)
        {
            using JsonDocument document = JsonDocument.Parse(profileJson);
            return new PresentationData
            {
                Alignment = alignment,
                Color = color,
                StyleProfile = document.RootElement.Clone()
            };
        }

        private static void Expect(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}

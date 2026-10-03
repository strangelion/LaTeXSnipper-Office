using System;
using System.Linq;
using LaTeXSnipper.NativeOffice.Shared.Latex;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class LatexDelimiterScannerTests
    {
        internal static int Run()
        {
            int failures = 0;
            var basic = LatexDelimiterScanner.Scan(
                @"before $x$ \(\alpha\) $$y$$ \[\beta\] after");
            failures += Expect(
                basic.Select(match => match.Latex).SequenceEqual(
                    new[] { "x", @"\alpha", "y", @"\beta" }),
                "basic delimiter scan changed");
            failures += Expect(
                basic.Select(match => match.IsDisplay).SequenceEqual(
                    new[] { false, false, true, true }),
                "display modes changed");

            var escaped = LatexDelimiterScanner.Scan(
                @"price \$5 and $x+\$y$");
            failures += Expect(
                escaped.Count == 1 && escaped[0].Latex == @"x+\$y",
                "escaped dollar was treated as a delimiter");

            failures += Expect(
                LatexDelimiterScanner.Scan("$unclosed\r$valid$").Count == 1,
                "unclosed inline formula consumed the next paragraph");
            failures += Expect(
                LatexDelimiterScanner.Scan("$$unclosed\a$$valid$$").Count == 1,
                "unclosed display formula crossed a Word table-cell boundary");

            var comment = LatexDelimiterScanner.Scan("$$a % $$ ignored\r\n+b$$");
            failures += Expect(
                comment.Count == 1 && comment[0].Latex.Contains("+b"),
                "commented delimiter closed a display formula");

            var protectedOpening = LatexDelimiterScanner.Scan(
                @"broken $$a+\[b\] then $$valid$$");
            failures += Expect(
                protectedOpening.Any(match => match.Latex == "b"),
                "nested top-level opening was consumed by an earlier delimiter");

            foreach (string raw in new[] { @"\frac{a}{b}", "x^2+y_1=0", @"\begin{matrix}a&b\\c&d\end{matrix}",
                "a^2\r+b^2", @"\myunknownsymbol+1" })
            {
                var selected = LatexDelimiterScanner.ScanSelection("  " + raw + " \r");
                failures += Expect(selected.Count == 1 && selected[0].Offset == 2 &&
                    selected[0].OriginalText == raw && selected[0].Latex == raw,
                    "explicit raw selection lost source or offset: " + raw);
                failures += Expect(LatexDelimiterScanner.Scan(raw).Count == 0,
                    "default scan guessed an undelimited formula");
            }
            foreach (string wrappedSource in new[] { "$x^2$", "$$x^2$$", @"\(x^2\)", @"\[x^2\]" })
                failures += Expect(LatexDelimiterScanner.ScanSelection(wrappedSource)[0].Latex == "x^2",
                    "selection wrappers were not normalized");
            foreach (string rejected in new[] { "", "plain prose", @"C:\Users\x^2", "```x^2```", "$x^2", @"\frac{a}{b", "x^2\\", "x^2\ay^2", "before $x^2$ after", "x^2}\0" })
            {
                bool rejectedSafely = false;
                try { LatexDelimiterScanner.ScanSelection(rejected); }
                catch (FormatException) { rejectedSafely = true; }
                failures += Expect(rejectedSafely, "unsafe selection accepted: " + rejected);
            }
            return failures;
        }

        private static int Expect(bool condition, string message)
        {
            if (condition) return 0;
            Console.Error.WriteLine("FAIL: " + message);
            return 1;
        }
    }
}

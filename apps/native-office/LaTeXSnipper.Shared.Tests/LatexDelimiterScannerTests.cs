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

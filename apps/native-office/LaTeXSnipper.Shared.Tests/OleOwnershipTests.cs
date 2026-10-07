using System;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class OleOwnershipTests
    {
        internal static int Run()
        {
            int failures = 0;
            foreach (string progId in new[] { null, "", "Equation.3", "MathType.Equation.1",
                "Word.Document.12", "LaTeXSnipper.Formula.2", "LaTeXSnipper.Formula.1.foreign",
                " LaTeXSnipper.Formula.1", "LaTeXSnipper.Formula.1 " })
            {
                int acquired = 0;
                var result = OleFormulaInterop.AcquireOwnedAutomation(() => progId, () => null, () => { acquired++; return new object(); });
                if (result != null || acquired != 0) { Console.Error.WriteLine("FAIL: foreign OLE automation acquired"); failures++; }
            }
            foreach (string progId in new[] { null, "", "Unknown", "LaTeXSnipper.Formula", "LaTeXSnipper.Formula.1", "latexsnipper.formula.1" })
            {
                int acquired = 0;
                var automation = new object();
                var result = OleFormulaInterop.AcquireOwnedAutomation(() => progId, () => OleStorageIdentity.FormulaClassId, () => { acquired++; return automation; });
                if (!ReferenceEquals(result, automation) || acquired != 1) { Console.Error.WriteLine("FAIL: owned automation rejected"); failures++; }
            }
            int unsafeCalls = 0;
            try
            {
                OleFormulaInterop.AcquireOwnedAutomation(() => throw new InvalidOperationException("metadata unavailable"),
                    () => OleStorageIdentity.FormulaClassId, () => { unsafeCalls++; return new object(); });
                Console.Error.WriteLine("FAIL: metadata failure was not propagated"); failures++;
            }
            catch (InvalidOperationException exception)
            {
                if (exception.Message != "metadata unavailable") { Console.Error.WriteLine("FAIL: wrong metadata exception"); failures++; }
            }
            if (unsafeCalls != 0) { Console.Error.WriteLine("FAIL: metadata failure activated OLE"); failures++; }
            foreach (Guid? classId in new Guid?[] { null, Guid.Empty, new Guid("0003000C-0000-0000-C000-000000000046") })
            {
                int acquired = 0;
                OleFormulaInterop.AcquireOwnedAutomation(() => "LaTeXSnipper.Formula.1", () => classId,
                    () => { acquired++; return new object(); });
                if (acquired != 0) { Console.Error.WriteLine("FAIL: ProgID spoof bypassed storage identity"); failures++; }
            }
            int inspected = 0;
            var rejected = OleFormulaInterop.AcquireOwnedAutomation(() => "MathType.Equation.1",
                () => { inspected++; return OleStorageIdentity.FormulaClassId; }, () => new object());
            if (rejected != null || inspected != 0) { Console.Error.WriteLine("FAIL: explicit foreign class reached storage/acquisition"); failures++; }
            try
            {
                OleFormulaInterop.AcquireOwnedAutomation(() => "Unknown", () => throw new InvalidOperationException("storage unavailable"),
                    () => { unsafeCalls++; return new object(); });
                Console.Error.WriteLine("FAIL: storage failure was not propagated"); failures++;
            }
            catch (InvalidOperationException exception)
            {
                if (exception.Message != "storage unavailable") { Console.Error.WriteLine("FAIL: wrong storage exception"); failures++; }
            }
            if (unsafeCalls != 0) { Console.Error.WriteLine("FAIL: storage failure activated OLE"); failures++; }
            return failures;
        }
    }
}

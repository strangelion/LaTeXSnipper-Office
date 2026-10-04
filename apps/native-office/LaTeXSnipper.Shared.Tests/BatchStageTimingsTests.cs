using System;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class BatchStageTimingsTests
    {
        public static int Run()
        {
            try
            {
                var timings = new BatchStageTimings();
                int operations = 0;
                foreach (Action invalid in new Action[] {
                    () => timings.Measure(" ", () => ++operations),
                    () => timings.Measure("null-action", (Action)null),
                    () => timings.Measure("null-function", (Func<int>)null) })
                {
                    try { invalid(); throw new Exception("Invalid measurement input was accepted."); }
                    catch (ArgumentException rejected)
                    {
                        if (rejected.ParamName != "stage" && rejected.ParamName != "operation") throw;
                    }
                }
                if (operations != 0 || timings.Snapshot().Count != 0)
                    throw new InvalidOperationException("Invalid input invoked an operation or recorded a stage.");
                if (timings.Measure("insert", () => ++operations) != 1)
                    throw new InvalidOperationException("Measurement changed the return value.");
                var snapshot = timings.Snapshot();
                timings.Measure("insert", () => { operations++; });
                var expected = new InvalidOperationException("fixture failure");
                try
                {
                    timings.Measure("insert", () => { throw expected; });
                    throw new Exception("Failure was swallowed.");
                }
                catch (InvalidOperationException actual)
                {
                    if (!ReferenceEquals(expected, actual)) throw;
                }
                var current = timings.Snapshot();
                if (operations != 2 || snapshot["insert"].Calls != 1 || current["insert"].Calls != 3 ||
                    current["insert"].ElapsedMs < snapshot["insert"].ElapsedMs)
                    throw new InvalidOperationException("Counts, accumulation or detached snapshot failed.");
                timings.Measure("outer", () => timings.Measure("inner", () => 7));
                current = timings.Snapshot();
                if (current["outer"].Calls != 1 || current["inner"].Calls != 1 ||
                    current["outer"].ElapsedMs < current["inner"].ElapsedMs)
                    throw new InvalidOperationException("Inclusive nesting failed.");
                using (var json = JsonDocument.Parse(JsonSerializer.Serialize(current)))
                {
                    var insert = json.RootElement.GetProperty("insert");
                    if (insert.GetProperty("calls").GetInt32() != 3 ||
                        insert.GetProperty("elapsedMs").GetDouble() < 0)
                        throw new InvalidOperationException("Evidence wire shape failed.");
                }
                Console.WriteLine("PASS BatchStageTimings return, failure, counts, detached snapshot and inclusive evidence");
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("FAIL BatchStageTimings: " + error.Message);
                return 1;
            }
        }
    }
}

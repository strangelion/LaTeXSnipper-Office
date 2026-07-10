using System;
using System.Diagnostics;
using System.Threading;
using LaTeXSnipper.NativeOffice.Shared;
using Microsoft.Win32;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class PendingPayloadTests
    {
        private const string KeyPath = @"Software\LaTeXSnipper\OfficePlugin\OleFormulaObject";
        private static int failures;

        private static FormulaPayload Payload(string id) => new FormulaPayload
        {
            FormulaId = id,
            Latex = "x^2",
            Render = new RenderData
            {
                Svg = "<svg viewBox='0 0 10 10'><path d='M1 1L9 1L5 9Z'/></svg>",
                WidthPt = 72,
                HeightPt = 72
            }
        };

        private static void Expect(bool condition, string message)
        {
            if (condition) return;
            Console.Error.WriteLine("FAIL: " + message);
            failures++;
        }

        private static object ReadValue(int pid)
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(KeyPath))
                return key?.GetValue("PendingPayload." + pid);
        }

        private static void TestCrossThreadRead()
        {
            string json = null;
            using (OleFormulaPendingPayloadStore.Save(Payload("cross-thread")))
            {
                var thread = new Thread(() => json = OleFormulaPendingPayloadStore.Consume());
                thread.Start();
                Expect(thread.Join(TimeSpan.FromSeconds(5)), "cross-thread consume timed out");
            }
            Expect(json != null && json.Contains("cross-thread"), "same-PID different thread could not read the payload");
            Expect(ReadValue(Process.GetCurrentProcess().Id) == null, "cross-thread consume did not remove the payload");
        }

        private static void TestMutexSerialization()
        {
            var started = new ManualResetEventSlim(false);
            var acquired = new ManualResetEventSlim(false);
            var finished = new ManualResetEventSlim(false);
            PendingPayloadLease first = OleFormulaPendingPayloadStore.Save(Payload("mutex-first"));
            var thread = new Thread(() =>
            {
                started.Set();
                using (OleFormulaPendingPayloadStore.Save(Payload("mutex-second")))
                    acquired.Set();
                finished.Set();
            });
            thread.Start();
            Expect(started.Wait(TimeSpan.FromSeconds(2)), "mutex contender did not start");
            Expect(!acquired.Wait(TimeSpan.FromMilliseconds(250)), "second lease was not serialized");
            first.Dispose();
            Expect(acquired.Wait(TimeSpan.FromSeconds(5)), "second lease did not acquire after release");
            Expect(finished.Wait(TimeSpan.FromSeconds(5)), "second lease did not finish");
            thread.Join();
        }

        private static void TestExceptionCleanup()
        {
            try
            {
                using (OleFormulaPendingPayloadStore.Save(Payload("exception")))
                    throw new InvalidOperationException("test fixture");
            }
            catch (InvalidOperationException)
            {
            }

            int pid = Process.GetCurrentProcess().Id;
            Expect(ReadValue(pid) == null, "exception path left a pending payload value");
            using (OleFormulaPendingPayloadStore.Save(Payload("after-exception")))
                Expect(ReadValue(pid) != null, "mutex was not reusable after exception cleanup");
            Expect(ReadValue(pid) == null, "post-exception lease did not clean up");
        }

        private static void TestDifferentPidIsolation()
        {
            int parentPid = Process.GetCurrentProcess().Id;
            using (OleFormulaPendingPayloadStore.Save(Payload("parent")))
            using (var child = new Process())
            {
                child.StartInfo = new ProcessStartInfo
                {
                    FileName = Process.GetCurrentProcess().MainModule.FileName,
                    Arguments = "--child",
                    UseShellExecute = false,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true
                };
                Expect(child.Start(), "child process did not start");
                string ready = child.StandardOutput.ReadLine();
                int childPid;
                Expect(ready != null && ready.StartsWith("READY ", StringComparison.Ordinal), "child process did not report readiness");
                Expect(ready != null && int.TryParse(ready.Substring(6), out childPid), "child PID was invalid");
                if (ready == null || !int.TryParse(ready.Substring(6), out childPid)) childPid = -1;

                Expect(ReadValue(parentPid) != null, "parent payload was missing");
                Expect(childPid > 0 && ReadValue(childPid) != null, "child payload was missing");
                string parentJson = OleFormulaPendingPayloadStore.Consume();
                Expect(parentJson != null && parentJson.Contains("parent"), "parent consumed a different PID payload");
                Expect(childPid > 0 && ReadValue(childPid) != null, "parent consume removed the child payload");

                child.StandardInput.WriteLine();
                Expect(child.WaitForExit(5000), "child process did not exit");
                Expect(child.ExitCode == 0, "child process reported failure");
                Expect(childPid <= 0 || ReadValue(childPid) == null, "child lease did not clean up its payload");
            }
        }

        private static int ChildMain()
        {
            using (OleFormulaPendingPayloadStore.Save(Payload("child")))
            {
                Console.WriteLine("READY " + Process.GetCurrentProcess().Id);
                Console.Out.Flush();
                Console.ReadLine();
            }
            return 0;
        }

        private static int Main(string[] args)
        {
            if (args.Length == 1 && args[0] == "--child") return ChildMain();

            TestCrossThreadRead();
            TestMutexSerialization();
            TestExceptionCleanup();
            TestDifferentPidIsolation();

            if (failures == 0)
            {
                Console.WriteLine("All PendingPayloadTests passed.");
                return 0;
            }
            Console.Error.WriteLine(failures + " PendingPayloadTests failure(s).");
            return 1;
        }
    }
}

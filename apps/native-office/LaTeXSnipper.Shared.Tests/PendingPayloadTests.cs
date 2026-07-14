using System;
using System.Diagnostics;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.RegularExpressions;
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

        private static string ReadReference(int pid)
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(KeyPath))
                return key?.GetValue("PendingPayload." + pid) as string;
        }

        private static string TokenFromReference(string reference)
        {
            Match match = Regex.Match(reference ?? string.Empty, "\\\"token\\\":\\\"([0-9a-f]{64})\\\"");
            return match.Success ? match.Groups[1].Value : null;
        }

        private static string PayloadPath(string token)
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "LaTeXSnipper", "OfficePlugin", "PendingPayloads", token + ".json");
        }

        private static void ExpectCurrentUserOnlyAcl(string path)
        {
            FileSecurity security = File.GetAccessControl(path);
            SecurityIdentifier currentUser = WindowsIdentity.GetCurrent().User;
            Expect(security.AreAccessRulesProtected, "payload file inherits ACL entries");
            AuthorizationRuleCollection rules = security.GetAccessRules(true, false, typeof(SecurityIdentifier));
            bool currentUserAllowed = false;
            foreach (FileSystemAccessRule rule in rules)
            {
                if (rule.AccessControlType != AccessControlType.Allow) continue;
                SecurityIdentifier identity = (SecurityIdentifier)rule.IdentityReference;
                if (identity.Equals(currentUser)) currentUserAllowed = true;
                else Expect(false, "payload file grants access to a non-owner SID: " + identity.Value);
            }
            Expect(currentUserAllowed, "payload file does not grant access to the current user");
        }

        private static void TestCrossThreadRead()
        {
            string json = null;
            using (OleFormulaPendingPayloadStore.Save(Payload("cross-thread")))
            {
                string reference = ReadReference(Process.GetCurrentProcess().Id);
                string token = TokenFromReference(reference);
                Expect(reference != null && reference.Length < 1024, "registry reference is missing or too large");
                Expect(!reference.Contains("cross-thread") && !reference.Contains("<svg") && !reference.Contains("x^2"),
                    "registry reference contains formula payload data");
                Expect(token != null && File.Exists(PayloadPath(token)), "token payload file is missing");
                if (token != null && File.Exists(PayloadPath(token))) ExpectCurrentUserOnlyAcl(PayloadPath(token));
                var thread = new Thread(() => json = OleFormulaPendingPayloadStore.Consume());
                thread.Start();
                Expect(thread.Join(TimeSpan.FromSeconds(5)), "cross-thread consume timed out");
                Expect(token == null || !File.Exists(PayloadPath(token)), "consume did not delete the token payload file");
            }
            Expect(json != null && json.Contains("cross-thread"), "same-PID different thread could not read the payload");
            Expect(ReadReference(Process.GetCurrentProcess().Id) == null, "cross-thread consume did not remove the reference");
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
            catch (InvalidOperationException ex)
            {
                Expect(ex.Message == "test fixture", "unexpected exception was caught in cleanup test");
            }

            int pid = Process.GetCurrentProcess().Id;
            Expect(ReadReference(pid) == null, "exception path left a pending payload reference");
            using (OleFormulaPendingPayloadStore.Save(Payload("after-exception")))
                Expect(ReadReference(pid) != null, "mutex was not reusable after exception cleanup");
            Expect(ReadReference(pid) == null, "post-exception lease did not clean up");
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

                Expect(ReadReference(parentPid) != null, "parent payload reference was missing");
                Expect(childPid > 0 && ReadReference(childPid) != null, "child payload reference was missing");
                string parentJson = OleFormulaPendingPayloadStore.Consume();
                Expect(parentJson != null && parentJson.Contains("parent"), "parent consumed a different PID payload");
                Expect(childPid > 0 && ReadReference(childPid) != null, "parent consume removed the child payload reference");

                child.StandardInput.WriteLine();
                Expect(child.WaitForExit(5000), "child process did not exit");
                Expect(child.ExitCode == 0, "child process reported failure");
                Expect(childPid <= 0 || ReadReference(childPid) == null, "child lease did not clean up its payload reference");
            }
        }

        private static void TestIntegrityFailureCleanup()
        {
            int pid = Process.GetCurrentProcess().Id;
            using (OleFormulaPendingPayloadStore.Save(Payload("tampered")))
            {
                string token = TokenFromReference(ReadReference(pid));
                Expect(token != null, "tamper fixture token is missing");
                if (token == null) return;
                string path = PayloadPath(token);
                File.WriteAllText(path, "tampered");
                Expect(OleFormulaPendingPayloadStore.Consume() == null, "tampered payload was accepted");
                Expect(!File.Exists(path), "tampered payload file was not deleted");
                Expect(ReadReference(pid) == null, "tampered payload reference was not deleted");
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
            try
            {
                return Run(args);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("FATAL type=" + ex.GetType().FullName + " message=" + ex.Message);
                Console.Error.WriteLine(ex.StackTrace ?? "stack unavailable");
                return 2;
            }
        }

        private static int Run(string[] args)
        {
            if (args.Length == 1 && args[0] == "--child") return ChildMain();

            Console.WriteLine("RUN TestCrossThreadRead");
            TestCrossThreadRead();
            Console.WriteLine("RUN TestMutexSerialization");
            TestMutexSerialization();
            Console.WriteLine("RUN TestExceptionCleanup");
            TestExceptionCleanup();
            Console.WriteLine("RUN TestDifferentPidIsolation");
            TestDifferentPidIsolation();
            Console.WriteLine("RUN TestIntegrityFailureCleanup");
            TestIntegrityFailureCleanup();
            Console.WriteLine("RUN StrictBase64Tests");
            failures += StrictBase64Tests.Run();
            Console.WriteLine("RUN OleExtentTests");
            failures += OleExtentTests.Run();
            Console.WriteLine("RUN OfficeStaDispatcherTests");
            failures += OfficeStaDispatcherTests.Run();
            Console.WriteLine("RUN FormulaIdTests");
            string formulaId = FormulaIdHelper.NewId();
            Expect(FormulaIdHelper.IsCanonical(formulaId), "generated formulaId is not canonical");
            Expect(!FormulaIdHelper.IsCanonical(formulaId + " 2"), "copy-renamed formulaId was accepted");
            Expect(!FormulaIdHelper.IsCanonical(""), "empty formulaId was accepted");

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

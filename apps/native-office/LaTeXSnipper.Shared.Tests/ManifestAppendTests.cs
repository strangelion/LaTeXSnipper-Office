using System;
using System.Collections.Generic;
using System.Threading;
using System.Xml.Linq;
using LaTeXSnipper.NativeOffice.Shared.Metadata;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class ManifestAppendTests
    {
        private static int failures;
        private static FormulaPayload Payload() => new FormulaPayload {
            FormulaId = FormulaIdHelper.NewId(), Latex = "x^2", Omml = "<math>x</math>",
            Display = "inline", StorageMode = "native-omml", Revision = 0
        };
        private static void Expect(bool valid, string message)
        {
            if (!valid) { failures++; Console.Error.WriteLine("FAIL manifest append: " + message); }
        }
        private static bool Fails(Action action, string code)
        {
            try { action(); return false; }
            catch (InvalidOperationException error) { return error.Message == code; }
        }

        private sealed class Store : IFormulaManifestAppendStore
        {
            public readonly Dictionary<string, string> Entries = new Dictionary<string, string>();
            public int Appends;
            public bool ThrowAfterAppend, ThrowBeforeAppend, MismatchReply, ChangedStoredEntry, NamespaceReply, DtdReply;
            public bool Disposed;
            public bool Contains(string id) => Entries.ContainsKey(id);
            public string AppendAndRead(string formulaId, string xml)
            {
                Appends++;
                if (ThrowBeforeAppend) throw new InvalidOperationException("COM_BEFORE_APPEND");
                string id = (string)XElement.Parse(xml).Attribute("id");
                if (id != formulaId) throw new InvalidOperationException("Store ID does not match the entry.");
                Entries.Add(id, ChangedStoredEntry ? xml.Replace("x^2", "changed") : xml);
                if (ThrowAfterAppend) throw new InvalidOperationException("COM_AFTER_APPEND");
                if (MismatchReply) return xml.Replace("x^2", "changed");
                if (DtdReply) return "<!DOCTYPE formula [<!ENTITY x 'test'>]>" + xml;
                if (NamespaceReply) return xml.Replace("<formula ", "<formula xmlns:lsno='urn:latexsnipper:office:objects:v3' ");
                return Entries[id];
            }
            public bool RemoveIfMatches(string id, string xml)
            {
                if (!Entries.TryGetValue(id, out string actual)) return true;
                if (actual != xml) return false;
                Entries.Remove(id); return true;
            }
            public void Dispose() { Disposed = true; }
        }

        public static int Run()
        {
            failures = 0;
            var document = new object();
            var store = new Store { NamespaceReply = true };
            var first = Payload(); var second = Payload();
            using (var session = new FormulaManifestAppendSession(document, store))
            {
                store.Entries.Add("unrelated", "keep old bytes");
                session.WriteNew(document, first); session.WriteNew(document, second);
                Expect(store.Appends == 2 && store.Entries.Count == 3, "per-entry writes lost another object");
                Expect(Fails(() => session.WriteNew(document, first), "BATCH_MANIFEST_ID_EXISTS"), "duplicate ID overwritten");
                session.RemoveCreated(document, first.FormulaId);
                session.RemoveCreated(document, "unrelated");
                Expect(!store.Entries.ContainsKey(first.FormulaId) && store.Entries["unrelated"] == "keep old bytes", "rollback removed unowned data");
                store.Entries[second.FormulaId] = "subsequent edit";
                session.RemoveCreated(document, second.FormulaId);
                Expect(store.Entries[second.FormulaId] == "subsequent edit", "rollback removed a changed entry");
                Expect(Fails(() => session.WriteNew(new object(), Payload()), "BATCH_MANIFEST_CONTEXT_CHANGED"), "cross-document write accepted");
                bool threadRejected = false;
                var thread = new Thread(() => threadRejected = Fails(() => session.WriteNew(document, Payload()), "BATCH_MANIFEST_CONTEXT_CHANGED"));
                thread.Start(); thread.Join(); Expect(threadRejected, "cross-thread COM use accepted");
            }
            Expect(store.Disposed && store.Entries.ContainsKey(second.FormulaId), "dispose deleted committed entries");
            var disposed = new FormulaManifestAppendSession(document, new Store()); disposed.Dispose();
            try { disposed.WriteNew(document, Payload()); Expect(false, "disposed write accepted"); }
            catch (ObjectDisposedException) { }

            foreach (string fault in new[] { "before", "after", "mismatch", "dtd", "changed" })
            {
                store = new Store { ThrowBeforeAppend = fault == "before", ThrowAfterAppend = fault == "after",
                    MismatchReply = fault == "mismatch", DtdReply = fault == "dtd", ChangedStoredEntry = fault == "changed" };
                var payload = Payload();
                using (var session = new FormulaManifestAppendSession(document, store))
                {
                    string code = fault == "before" ? "COM_BEFORE_APPEND" : fault == "after" ? "COM_AFTER_APPEND" : "BATCH_MANIFEST_READBACK_MISMATCH";
                    Expect(Fails(() => session.WriteNew(document, payload), code), "failure not surfaced: " + fault);
                    Expect(store.Entries.Count == (fault == "changed" ? 1 : 0), "exact cleanup boundary failed: " + fault);
                    Expect(Fails(() => session.WriteNew(document, Payload()), "BATCH_MANIFEST_SESSION_FAULTED"), "uncertain append was retried");
                    Expect(store.Appends == 1, "faulted session appended again");
                }
            }
            store = new Store();
            using (var session = new FormulaManifestAppendSession(document, store))
            {
                var invalid = Payload(); invalid.FormulaId = "injection' or '1'='1";
                Expect(Fails(() => session.WriteNew(document, invalid), "BATCH_MANIFEST_PAYLOAD_INVALID"), "unsafe XPath ID accepted");
                invalid = Payload(); invalid.StorageMode = "ole";
                Expect(Fails(() => session.WriteNew(document, invalid), "BATCH_MANIFEST_PAYLOAD_INVALID"), "other storage mode accepted");
                invalid = Payload(); invalid.Revision = 1;
                Expect(Fails(() => session.WriteNew(document, invalid), "BATCH_MANIFEST_PAYLOAD_INVALID"), "update accepted as new");
                invalid = Payload(); invalid.Latex = new string('x', FormulaManifestAppendSession.MaximumEntryCharacters);
                Expect(Fails(() => session.WriteNew(document, invalid), "BATCH_MANIFEST_BUDGET_EXCEEDED"), "oversized entry accepted");
                Expect(store.Appends == 0, "invalid inputs touched storage");
                for (int index = 0; index < FormulaManifestAppendSession.MaximumEntries; index++) session.WriteNew(document, Payload());
                Expect(Fails(() => session.WriteNew(document, Payload()), "BATCH_MANIFEST_BUDGET_EXCEEDED"), "entry budget ignored");
            }
            store = new Store();
            using (var session = new FormulaManifestAppendSession(document, store))
            {
                int accepted = 0;
                while (accepted < 100)
                {
                    var payload = Payload(); payload.Latex = new string('x', 256 * 1024);
                    if (Fails(() => session.WriteNew(document, payload), "BATCH_MANIFEST_BUDGET_EXCEEDED")) break;
                    accepted++;
                }
                Expect(accepted > 1 && accepted < 100 && store.Appends == accepted, "aggregate byte budget ignored");
            }
            Console.WriteLine("Manifest append tests " + (failures == 0 ? "passed" : "failed"));
            return failures;
        }
    }
}

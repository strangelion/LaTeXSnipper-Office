using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared.Metadata;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class HostIdentityReconciliationTests
    {
        private sealed class Store : IFormulaManifestReplacementStore
        {
            public string Original, Added, Fault;
            public int Adds;
            public bool Committed, CommitStarted, RolledBack;
            public void Dispose() { }
            public string ReadOriginal() => Original;
            public bool IsOriginalUnchanged() => Fault != "original-changed";
            public bool IsPreparedUnchanged() => Fault != "prepared-changed";
            public void AddReplacement(string xml)
            {
                Adds++; if (Fault == "add-before") throw new InvalidOperationException("authored Add before");
                Added = xml;
                if (Fault == "unknown-add") throw new InvalidOperationException("authored unreturned Add");
            }
            public string ReadReplacement() => Fault == "readback" ? "<bad/>" : Added;
            public void CommitReplacement()
            {
                CommitStarted = true;
                if (Fault == "commit-before") throw new InvalidOperationException("authored commit before");
                Original = Added;
                if (Fault == "commit-after") throw new InvalidOperationException("authored commit after");
                Committed = true; Added = null;
            }
            public bool RollbackReplacement()
            {
                RolledBack = true;
                if (CommitStarted || Fault == "unknown-add" || Fault == "prepared-changed") return false;
                Added = null; return true;
            }
        }
        private static FormulaPayload Clone(FormulaPayload value) => JsonSerializer.Deserialize<FormulaPayload>(JsonSerializer.Serialize(value));
        public static int Run()
        {
            int failures = 0;
            Action<bool, string> expect = (ok, reason) => { if (!ok) { failures++; Console.Error.WriteLine("FAIL copied identity: " + reason); } };
            string oldId = FormulaIdHelper.NewId(), newId = FormulaIdHelper.NewId();
            var full = new FormulaPayload { FormulaId = oldId, Latex = "x^2", StorageMode = "image", Revision = 9,
                Render = new RenderData { Png = "authored PNG", WidthPt = 10, HeightPt = 5 } };
            string compact = OleFormulaInterop.CreateHostMetadataJson(full, "image");
            string originalXml = "<lsno:manifest xmlns:lsno='urn:latexsnipper:office:objects:v3'><formula id='" + oldId +
                "'><payload>" + Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(full))) + "</payload></formula></lsno:manifest>";
            foreach (string host in new[] { "excel", "powerpoint" })
            foreach (string fault in new[] { "none", "add-before", "unknown-add", "readback", "original-changed", "prepared-changed",
                "mutate-before", "mutate-after", "verify", "restore", "commit-before", "commit-after" })
            {
                var selected = JsonSerializer.Deserialize<FormulaPayload>(compact);
                var current = Clone(selected); var store = new Store { Original = originalXml, Fault = fault };
                bool wrote = false, restored = false; FormulaPayload result = null; string errorCode = null;
                try
                {
                    result = HostIdentityReconciliation.Reconcile(store, selected, host, "image", host + ":authored", false,
                        (entries, id) => (id == oldId ? 1 : 0) + (current.FormulaId == id ? 1 : 0),
                        () => current.FormulaId == oldId, metadata => {
                            wrote = true;
                            if (fault == "mutate-before") throw new InvalidOperationException("authored identity write before");
                            current = Clone(metadata);
                            if (fault == "mutate-after" || fault == "restore") throw new InvalidOperationException("authored identity write after");
                        }, metadata => fault != "verify" && current.FormulaId == metadata.FormulaId,
                        () => { if (fault == "restore") return false; current = Clone(selected); restored = true; return true; }, () => newId);
                }
                catch (HostIdentityReconciliationException error) { errorCode = error.ErrorCode; }
                if (fault == "none")
                {
                    var entries = FormulaManifestReader.ReadAll(store.Original);
                    expect(result.FormulaId == newId && result.Render.Png == "authored PNG" && result.Revision == 0 &&
                        entries.Count == 2 && entries[oldId].Revision == 9 && entries[oldId].Render.Png == "authored PNG" &&
                        result.DocumentContext == host + ":authored" && selected.FormulaId == oldId && selected.Render == null && store.Committed,
                        host + " source hydration, original preservation or caller isolation");
                }
                else
                {
                    bool uncertain = fault == "unknown-add" || fault == "prepared-changed" || fault == "restore" || fault.StartsWith("commit", StringComparison.Ordinal);
                    expect(errorCode == (uncertain ? "HOST_IDENTITY_STATE_UNCERTAIN" : "HOST_IDENTITY_RECONCILE_FAILED") && result == null,
                        host + " error state " + fault);
                    if (!uncertain && wrote) expect(restored && current.FormulaId == oldId && store.Added == null, host + " failed write not restored " + fault);
                    if (fault.StartsWith("commit", StringComparison.Ordinal)) expect(!restored && current.FormulaId == newId, host + " erased committed identity " + fault);
                }
            }
            foreach (bool missing in new[] { false, true })
            {
                var selected = JsonSerializer.Deserialize<FormulaPayload>(compact);
                var store = new Store { Original = missing ? null : originalXml };
                bool blocked = false;
                try
                {
                    var value = HostIdentityReconciliation.Reconcile(store, selected, "excel", "image", "excel:authored", true,
                        (entries, id) => id == oldId ? 1 : 0, () => true, _ => { throw new InvalidOperationException("unexpected write"); },
                        _ => true, () => true, () => newId);
                    expect(!missing && value.Render.Png == "authored PNG" && store.Adds == 0, "unique read-only source mutated");
                }
                catch (HostIdentityReconciliationException) { blocked = true; }
                expect(blocked == missing && store.Adds == 0, "read-only adoption changed metadata");
            }
            foreach (string host in new[] { "excel", "powerpoint" })
            foreach (string fault in new[] { "source-conflict", "new-id-conflict", "absent-target", "inventory-changed" })
            {
                var selected = JsonSerializer.Deserialize<FormulaPayload>(compact);
                if (fault == "source-conflict") selected.Latex = "y^2";
                var store = new Store { Original = originalXml };
                bool blocked = false, mutated = false;
                try
                {
                    HostIdentityReconciliation.Reconcile(store, selected, host, "image", host + ":authored", false,
                        (entries, id) => id == oldId ? (fault == "absent-target" ? 0 : fault == "source-conflict" ? 1 :
                            fault == "inventory-changed" && store.Adds > 0 ? 3 : 2) :
                            fault == "new-id-conflict" && id == newId ? 1 : 0,
                        () => true, _ => { mutated = true; }, _ => true, () => true, () => newId);
                }
                catch (HostIdentityReconciliationException error) { blocked = error.ErrorCode == "HOST_IDENTITY_RECONCILE_FAILED"; }
                expect(blocked && !mutated && store.Original == originalXml && store.Added == null &&
                    store.Adds == (fault == "inventory-changed" ? 1 : 0), host + " pre-mutation guard " + fault);
            }
            expect(HostIdentityReconciliation.ParseLegacyReferenceId("LSNO:v3:id=" + oldId + ";storage=image", oldId) == oldId,
                "valid legacy reference lost identity");
            foreach (string reference in new[] { "LSNO:v3:id=" + oldId + ";id=" + oldId,
                "LSNO:v3:id=" + oldId + ";id=" + newId, "LSNO:v3:storage=image", "wrong:id=" + oldId })
            {
                bool blocked = false;
                try { HostIdentityReconciliation.ParseLegacyReferenceId(reference, null); }
                catch (HostIdentityReconciliationException) { blocked = true; }
                expect(blocked, "ambiguous legacy reference accepted");
            }
            bool mismatchBlocked = false;
            try { HostIdentityReconciliation.ParseLegacyReferenceId("LSNO:v3:id=" + oldId, newId); }
            catch (HostIdentityReconciliationException) { mismatchBlocked = true; }
            expect(mismatchBlocked, "legacy name/reference conflict accepted");
            Console.WriteLine("Host identity reconciliation tests " + (failures == 0 ? "passed" : "failed"));
            return failures;
        }
    }
}

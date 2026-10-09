using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Xml.Linq;
using LaTeXSnipper.NativeOffice.Shared.Metadata;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class ManifestDeletionTests
    {
        private const string Prefix = "<lsno:manifest xmlns:lsno='urn:latexsnipper:office:objects:v3' xmlns:q='urn:extension'>";
        private const string Original = Prefix + "<!--keep--><foreign key='q:value'>keep</foreign><formula id='remove'><latex>x</latex></formula><formula id='keep'><latex>y</latex></formula></lsno:manifest>";
        private sealed class Store : IFormulaManifestReplacementStore
        {
            public string Xml = Original, Added, Fault;
            public int Adds;
            public bool CommitStarted, Committed, RolledBack;
            public void Dispose() { }
            public string ReadOriginal() => Xml;
            public void AddReplacement(string xml)
            {
                Adds++;
                if (Fault == "add-before") throw new InvalidOperationException("authored Add before");
                Added = xml;
                if (Fault == "add-after" || Fault == "unknown-add") throw new InvalidOperationException("authored Add after");
            }
            public string ReadReplacement() => Fault == "readback" ? Added.Replace("keep</foreign>", "changed</foreign>") : Added;
            public bool IsPreparedUnchanged() => Fault != "changed";
            public bool IsOriginalUnchanged() => Fault != "changed";
            public void CommitReplacement()
            {
                if (Fault == "changed") throw new InvalidOperationException("authored old part change");
                CommitStarted = true;
                if (Fault == "delete-before") throw new InvalidOperationException("authored old part Delete before");
                Xml = null;
                if (Fault == "delete-after") throw new InvalidOperationException("authored old part Delete after");
                Committed = true; Xml = Added; Added = null;
            }
            public bool RollbackReplacement()
            {
                RolledBack = true;
                if (CommitStarted || Fault == "changed" || Fault == "unknown-add") return false;
                Added = null; return true;
            }
        }
        private static IEnumerable<string> IncompleteInventory()
        { yield return "keep"; throw new InvalidOperationException("authored enumeration failure"); }
        public static int Run()
        {
            int failures = 0;
            Action<bool, string> expect = (ok, message) => { if (!ok) { failures++; Console.Error.WriteLine("FAIL manifest deletion: " + message); } };
            foreach (string host in new[] { "word", "excel", "powerpoint" })
            {
                var store = new Store(); FormulaManifestReplacement.Remove(store, "remove", host);
                var root = XElement.Parse(store.Xml);
                expect(store.Committed && root.Elements("formula").Count() == 1 && root.Element("formula").Attribute("id").Value == "keep" &&
                    root.Element("foreign").Value == "keep" && root.Nodes().OfType<XComment>().Count() == 1 && root.GetNamespaceOfPrefix("q") == "urn:extension", host + " unrelated data lost");
                foreach (string original in new[] { null, Original })
                { store = new Store { Xml = original }; FormulaManifestReplacement.Remove(store, "absent", host); expect(store.Adds == 0 && store.Xml == original, host + " absent entry mutated part"); }
                foreach (string xml in new[] { "<broken", Prefix.Replace("manifest", "wrong") + "</lsno:wrong>",
                    "<!DOCTYPE n [<!ENTITY x 'bad'>]>" + Original,
                    Prefix + "<formula id='remove'/><formula id='remove'/></lsno:manifest>",
                    Prefix + "<foreign id='remove'/></lsno:manifest>" })
                {
                    store = new Store { Xml = xml }; bool refused = false;
                    try { FormulaManifestReplacement.Remove(store, "remove", host); } catch (Exception) { refused = true; }
                    expect(refused && store.Adds == 0 && store.Xml == xml, host + " invalid original deleted");
                }
                foreach (string fault in new[] { "add-before", "add-after", "readback", "changed", "delete-before", "delete-after", "unknown-add" })
                {
                    store = new Store { Fault = fault }; bool failed = false;
                    try { FormulaManifestReplacement.Remove(store, "remove", host); } catch (Exception) { failed = true; }
                    expect(failed && !store.Committed && store.RolledBack, host + " metadata fault reported success " + fault);
                }
                foreach (string fault in new[] { "none", "add-before", "readback", "changed", "unknown-add", "object-delete-before", "object-delete-after", "delete-before", "delete-after" })
                {
                    store = new Store { Fault = fault }; bool objectExists = true; int deletes = 0;
                    var result = HostFormulaDeletion.Delete(store, "remove", host, () => true, () => {
                        deletes++;
                        if (fault == "object-delete-before") throw new InvalidOperationException("authored object Delete before");
                        objectExists = false;
                        if (fault == "object-delete-after") throw new InvalidOperationException("authored object Delete after");
                    });
                    expect(result.Success == (fault == "none") && deletes <= 1, host + " physical failure/success " + fault);
                    if (deletes == 0) expect(objectExists, host + " preflight erased object " + fault);
                    if (fault.StartsWith("object-delete", StringComparison.Ordinal) || fault.StartsWith("delete-", StringComparison.Ordinal))
                        expect(result.ErrorCode == "HOST_DELETE_STATE_UNCERTAIN", host + " irreversible failure erased state " + fault);
                }
            }
            expect(FormulaManifestReader.Read(Original, "keep").Latex == "y" && FormulaManifestReader.ReadAll(Original).Count == 2,
                "legacy read/foreign extension projection");
            foreach (string data in new[] { "", "not-base64", Convert.ToBase64String(Encoding.UTF8.GetBytes("{\"formulaId\":\"other\"}")),
                Convert.ToBase64String(Encoding.UTF8.GetBytes("{\"formulaId\":\"remove\",\"FormulaId\":\"other\"}")),
                Convert.ToBase64String(new byte[] { 0xff, 0xfe }) })
            {
                string xml = Prefix + "<formula id='remove'><latex>fake fallback</latex><payload>" + data + "</payload></formula></lsno:manifest>";
                bool rejected = false;
                try { FormulaManifestReader.Read(xml, "remove"); } catch (Exception) { rejected = true; }
                expect(rejected, "bad payload fabricated a legacy formula");
            }
            var entries = FormulaManifestReader.ReadAll(Original); int repairs = 0;
            var report = ManifestDiagnostics.ValidateInventory(entries, new[] { "keep" });
            expect(report.ScanComplete && !report.IsConsistent && report.OrphanEntries == 1 && report.RepairedCount == 0, "default diagnostic mutated or falsely passed");
            report = ManifestDiagnostics.ValidateInventory(entries, IncompleteInventory(), true, _ => repairs++);
            expect(!report.ScanComplete && !report.IsConsistent && report.HasErrors && repairs == 0, "partial scan repaired entries");
            report = ManifestDiagnostics.ValidateInventory(entries, new[] { "keep", "keep" }, true, _ => repairs++);
            expect(report.DuplicateObjectIds == 1 && report.HasErrors && repairs == 0, "ambiguous scan repaired entries");
            report = ManifestDiagnostics.ValidateInventory(entries, new[] { "keep" }, true, _ => repairs++);
            expect(report.ScanComplete && report.RepairedCount == 1 && repairs == 1 && report.IsConsistent, "explicit verified repair failed");
            expect(ManifestDiagnostics.InventoryUnchanged(new[] { "one", "two", "one" }, new[] { "two", "one", "one" }) &&
                !ManifestDiagnostics.InventoryUnchanged(new[] { "one", "two" }, new[] { "one", "one" }),
                "repair inventory must preserve duplicate counts, not enumeration order");
            foreach (string host in new[] { "word", "excel", "powerpoint" })
            foreach (string fault in new[] { "none", "stale-manifest", "preflight-inventory", "staged-inventory", "partial-rescan" })
            {
                var store = new Store(); bool failed = false; string after = null;
                try
                {
                    after = FormulaManifestReplacement.RemoveGuarded(store, "remove", host,
                        fault == "stale-manifest" ? Original.Replace("<latex>x</latex>", "<latex>z</latex>") : Original,
                        () => {
                            if (fault == "partial-rescan") return ManifestDiagnostics.InventoryUnchanged(new[] { "keep" }, IncompleteInventory());
                            return fault != "preflight-inventory" && (fault != "staged-inventory" || store.Adds == 0);
                        });
                }
                catch (Exception) { failed = true; }
                if (fault == "none")
                {
                    expect(!failed && after == store.Xml && store.Committed, host + " guarded repair failed");
                    var second = new Store { Xml = after };
                    var empty = FormulaManifestReplacement.RemoveGuarded(second, "keep", host, after, () => true);
                    expect(second.Committed && FormulaManifestReader.ReadAll(empty).Count == 0 && XElement.Parse(empty).Element("foreign").Value == "keep",
                        host + " sequential repairs lost expected snapshot or extension");
                }
                else expect(failed && !store.CommitStarted && store.Xml == Original && store.Added == null &&
                    store.Adds == (fault == "staged-inventory" ? 1 : 0), host + " unsafe orphan repair " + fault);
            }
            Console.WriteLine("Manifest deletion/read tests " + (failures == 0 ? "passed" : "failed"));
            return failures;
        }
    }
}

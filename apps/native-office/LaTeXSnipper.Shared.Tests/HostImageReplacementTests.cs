using System;
using System.Collections.Generic;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared.Metadata;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class HostImageReplacementTests
    {
        private sealed class Candidate { public FormulaPayload Metadata; }
        private sealed class Store : IFormulaManifestReplacementStore
        {
            public string Original = "<lsno:manifest xmlns:lsno='urn:latexsnipper:office:objects:v3'><foreign>keep</foreign></lsno:manifest>";
            public string Added, Fault;
            public bool Commit, Rollback;
            public void Dispose() { }
            public string ReadOriginal() => Original;
            public void AddReplacement(string xml)
            {
                if (Fault == "add") throw new InvalidOperationException("authored Add fault");
                Added = xml;
            }
            public string ReadReplacement() => Fault == "readback" ? "<bad/>" : Added;
            public bool IsPreparedUnchanged() => Fault != "manifest-changed";
            public void CommitReplacement()
            {
                if (Fault == "commit") throw new InvalidOperationException("authored commit fault");
                Commit = true;
            }
            public bool RollbackReplacement()
            {
                Rollback = true;
                if (Fault == "add" || Fault == "manifest-changed") return false;
                Added = null; return true;
            }
        }
        public static int Run()
        {
            int failures = 0;
            Action<bool, string> expect = (ok, reason) => { if (!ok) { failures++; Console.Error.WriteLine("FAIL image replacement: " + reason); } };
            var payload = new FormulaPayload { FormulaId = "image-test", Latex = "y^3", StorageMode = "auto",
                Revision = 2, ContentKind = "customSymbol", Render = new RenderData { Png = "authored", WidthPt = 20, HeightPt = 10 } };
            using (var state = JsonDocument.Parse("{\"schemaVersion\":1,\"marker\":\"new-source\"}")) payload.EditorState = state.RootElement.Clone();
            foreach (string host in new[] { "excel", "powerpoint" })
            foreach (string fault in new[] { "none", "manifest-invalid", "create", "prepare", "verify", "readback", "add",
                "changed", "manifest-changed", "delete-before", "delete-after", "promote", "commit", "cleanup" })
            {
                var store = new Store { Fault = fault };
                if (fault == "manifest-invalid") store.Original = "<bad/>";
                bool originalExists = true, cleaned = false, created = false;
                int deleteCalls = 0, verifies = 0;
                Candidate candidate = null;
                var events = new List<string>();
                var result = HostImageReplacement.Replace(payload.FormulaId, payload, host, store,
                    () => {
                        events.Add("create"); created = true;
                        if (fault == "create") throw new InvalidOperationException("authored unreturned candidate");
                        return candidate = new Candidate();
                    }, (value, metadata) => {
                        events.Add("prepare"); value.Metadata = metadata;
                        if (fault == "prepare" || fault == "cleanup") throw new InvalidOperationException("authored prepare fault");
                    }, value => {
                        events.Add("verify"); verifies++;
                        if (fault == "verify") throw new InvalidOperationException("authored readback fault");
                    }, () => fault != "changed" || !created,
                    () => {
                        events.Add("delete"); deleteCalls++;
                        if (fault == "delete-before") throw new InvalidOperationException("authored deletion fault");
                        originalExists = false;
                        if (fault == "delete-after") throw new InvalidOperationException("authored deletion fault after mutation");
                    }, value => {
                        events.Add("promote");
                        if (fault == "promote") throw new InvalidOperationException("authored promotion fault");
                    }, value => {
                        if (fault == "cleanup") throw new InvalidOperationException("authored cleanup fault");
                        cleaned = true;
                    });
                if (fault == "none")
                {
                    expect(result.Success && store.Commit && !cleaned && !originalExists && deleteCalls == 1 && verifies == 3 &&
                        events.IndexOf("verify") < events.IndexOf("delete") && events.IndexOf("delete") < events.IndexOf("promote"), host + " ordering/success");
                    expect(candidate.Metadata.StorageMode == "image" && candidate.Metadata.Render.Png == "authored" &&
                        candidate.Metadata.Revision == 2 && candidate.Metadata.EditorState.Value.GetProperty("marker").GetString() == "new-source" &&
                        payload.StorageMode == "auto", host + " full metadata / caller isolation");
                }
                else
                {
                    bool uncertain = fault == "create" || fault == "add" || fault == "manifest-changed" || fault.StartsWith("delete", StringComparison.Ordinal) ||
                        fault == "promote" || fault == "commit";
                    expect(!result.Success && result.ErrorCode == (uncertain ? "HOST_IMAGE_REPLACE_STATE_UNCERTAIN" :
                        fault == "cleanup" ? "HOST_IMAGE_REPLACE_ROLLBACK_UNVERIFIED" : "HOST_IMAGE_REPLACE_FAILED"), host + " fault state " + fault);
                    expect(deleteCalls <= 1 && (deleteCalls != 0 || originalExists), host + " original before commit " + fault);
                    expect(!uncertain || !cleaned, host + " uncertain candidate erased " + fault);
                    if (fault == "manifest-invalid") expect(!created && store.Added == null, host + " preflight touched document");
                    if (fault == "readback") expect(cleaned && store.Rollback && store.Added == null && originalExists, host + " prepared rollback");
                    if (fault == "manifest-changed") expect(deleteCalls == 0 && originalExists && store.Added != null,
                        host + " changed metadata deleted original picture");
                }
            }
            Console.WriteLine("Host image replacement tests " + (failures == 0 ? "passed" : "failed"));
            return failures;
        }
    }
}

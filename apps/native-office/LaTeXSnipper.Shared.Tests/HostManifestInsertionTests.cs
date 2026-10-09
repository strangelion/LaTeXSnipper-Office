using System;
using System.Text.Json;
using System.Xml.Linq;
using LaTeXSnipper.NativeOffice.Shared.Metadata;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class HostManifestInsertionTests
    {
        public static int Run()
        {
            int failures = 0;
            Action<bool, string> expect = (value, message) => {
                if (!value) { failures++; Console.Error.WriteLine("FAIL host manifest: " + message); }
            };
            var payload = new FormulaPayload { FormulaId = "host-test", Latex = "x^2", StorageMode = "auto",
                Render = new RenderData { Svg = "<svg/>", WidthPt = 10, HeightPt = 10 } };
            foreach (string host in new[] { "excel", "powerpoint" })
            {
                FormulaPayload saved = null;
                bool rollback = false;
                var result = HostManifestInsertion.Commit(payload.FormulaId, payload, host, "image",
                    metadata => saved = metadata, () => rollback = true);
                expect(result == null && !rollback && saved.StorageMode == "image" && saved.Render.Svg == "<svg/>" &&
                    payload.StorageMode == "auto" && !ReferenceEquals(saved, payload), "actual route, complete render or caller isolation failed");
                result = HostManifestInsertion.Commit(payload.FormulaId, payload, host, "ole",
                    metadata => { throw new InvalidOperationException("authored write fault"); }, () => rollback = true);
                expect(result.ErrorCode == "HOST_MANIFEST_WRITE_FAILED" && rollback && HostManifestInsertion.IsFailure(result.ErrorCode),
                    "write fault did not block auto fallback and clean candidate");
                result = HostManifestInsertion.Commit(payload.FormulaId, payload, host, "ole",
                    metadata => { throw new InvalidOperationException("authored write fault"); },
                    () => { throw new InvalidOperationException("authored cleanup fault"); });
                expect(result.ErrorCode == "HOST_MANIFEST_ROLLBACK_UNVERIFIED", "unknown cleanup reported as success");
                int writes = 0;
                result = HostManifestInsertion.Commit("other", payload, host, "image", metadata => writes++, () => rollback = true);
                expect(result != null && writes == 0, "mismatched ID touched metadata");
                var store = new ReplacementStore();
                FormulaManifestReplacement.Write(store, saved, host);
                var entry = XElement.Parse(store.Xml).Element("formula");
                expect((string)entry.Element("locator").Attribute("host") == host &&
                    (string)entry.Attribute("storageMode") == "image", "host locator mapping changed");
                var decoded = JsonSerializer.Deserialize<FormulaPayload>(System.Text.Encoding.UTF8.GetString(
                    Convert.FromBase64String(entry.Element("payload").Value)));
                expect(decoded.Render.Svg == "<svg/>", "manifest omitted full render source");
            }
            Console.WriteLine("Host manifest insertion tests " + (failures == 0 ? "passed" : "failed"));
            return failures;
        }
        private sealed class ReplacementStore : IFormulaManifestReplacementStore
        {
            public string Xml;
            public string ReadOriginal() => null;
            public void AddReplacement(string xml) { Xml = xml; }
            public string ReadReplacement() => Xml;
            public bool IsPreparedUnchanged() => true;
            public void CommitReplacement() { }
            public bool RollbackReplacement() => true;
            public void Dispose() { }
        }
    }
}

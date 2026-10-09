using System;
using System.Linq;
using System.Xml;
using System.Xml.Linq;
using LaTeXSnipper.NativeOffice.Shared.Metadata;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class ManifestReplacementTests
    {
        private static int failures;
        private const string Empty = "<lsno:manifest xmlns:lsno='urn:latexsnipper:office:objects:v3'/>";
        private static FormulaPayload Payload() => new FormulaPayload { FormulaId = "legacy-test-id", Latex = "x^2",
            Omml = "<math>x</math>", StorageMode = "native-omml", Display = "inline" };
        private static void Expect(bool valid, string message)
        {
            if (!valid) { failures++; Console.Error.WriteLine("FAIL manifest replacement: " + message); }
        }
        private sealed class Store : IFormulaManifestReplacementStore
        {
            public string Original = Empty, Added;
            public string Fault;
            public int Adds;
            public bool Committed, RollbackCalled, CommitStarted;
            public string ReadOriginal() => Original;
            public void AddReplacement(string xml)
            {
                Adds++;
                if (Fault == "add-before") throw new InvalidOperationException("ADD_FAILED");
                Added = xml;
                if (Fault == "add-after") throw new InvalidOperationException("ADD_FAILED");
            }
            public string ReadReplacement() => Fault == "readback" ? Added.Replace("x^2", "corrupted") : Added;
            public void CommitReplacement()
            {
                if (Fault == "changed") throw new InvalidOperationException("ORIGINAL_CHANGED");
                CommitStarted = true;
                if (Fault == "delete-before") throw new InvalidOperationException("DELETE_FAILED");
                Original = null;
                if (Fault == "delete-after") throw new InvalidOperationException("DELETE_FAILED");
                Committed = true;
            }
            public bool RollbackReplacement()
            {
                RollbackCalled = true;
                if (CommitStarted || Fault == "changed" || Fault == "unknown-add") return false;
                Added = null; return true;
            }
            public void Dispose() { }
        }
        public static int Run()
        {
            failures = 0;
            var payload = Payload();
            var store = new Store { Original = "<lsno:manifest xmlns:lsno='urn:latexsnipper:office:objects:v3' xmlns:q='urn:authored-extension'>\n<!--keep--><foreign a='q:type'>keep</foreign><formula id='other'><latex>z</latex></formula></lsno:manifest>" };
            FormulaManifestReplacement.Write(store, payload);
            var root = XElement.Parse(store.Added);
            Expect(store.Committed && root.Elements("formula").Count() == 2 && root.Element("foreign")?.Value == "keep" &&
                root.Nodes().OfType<XComment>().Single().Value == "keep" && root.GetNamespaceOfPrefix("q") == "urn:authored-extension", "unrelated data was lost");
            store = new Store { Original = null };
            FormulaManifestReplacement.Write(store, payload);
            Expect(store.Committed && XElement.Parse(store.Added).Element("formula") != null, "first manifest not created");
            store = new Store { Original = "<lsno:manifest xmlns:lsno='urn:latexsnipper:office:objects:v3'><formula id='legacy-test-id'><latex>old</latex></formula></lsno:manifest>" };
            FormulaManifestReplacement.Write(store, payload);
            Expect(XElement.Parse(store.Added).Elements("formula").Count() == 1 && store.Added.Contains("x^2"), "entry update duplicated the ID");
            foreach (string xml in new[] { "<broken", "<lsno:wrong xmlns:lsno='urn:latexsnipper:office:objects:v3'/>",
                "<!DOCTYPE manifest [<!ENTITY x 'expanded'>]>" + Empty,
                "<lsno:manifest xmlns:lsno='urn:latexsnipper:office:objects:v3'><formula id='legacy-test-id'/><formula id='legacy-test-id'/></lsno:manifest>",
                "<lsno:manifest xmlns:lsno='urn:latexsnipper:office:objects:v3'><foreign id='legacy-test-id'/></lsno:manifest>",
                "<lsno:manifest xmlns:lsno='urn:latexsnipper:office:objects:v3'>" + string.Concat(Enumerable.Repeat("<n>", 65)) +
                    string.Concat(Enumerable.Repeat("</n>", 65)) + "</lsno:manifest>" })
            {
                store = new Store { Original = xml };
                bool rejected = false;
                try { FormulaManifestReplacement.Write(store, payload); }
                catch (Exception error) when (error is XmlException || error is InvalidOperationException) { rejected = true; }
                Expect(rejected && store.Adds == 0 && store.Original == xml, "invalid original was replaced");
            }
            foreach (string fault in new[] { "add-before", "add-after", "readback", "changed", "delete-before", "delete-after" })
            {
                store = new Store { Fault = fault };
                bool failed = false, uncertain = false;
                try { FormulaManifestReplacement.Write(store, payload); }
                catch (InvalidOperationException error) { failed = true; uncertain = error.Message.StartsWith("MANIFEST_STATE_UNCERTAIN", StringComparison.Ordinal); }
                bool commitFault = fault.StartsWith("delete", StringComparison.Ordinal) || fault == "changed";
                Expect(failed && store.RollbackCalled && uncertain == commitFault, "error state not propagated: " + fault);
                Expect(commitFault ? store.Added != null : store.Added == null && store.Original == Empty,
                    "cleanup erased the valid payload or lost old storage: " + fault);
            }
            Console.WriteLine("Manifest replacement tests " + (failures == 0 ? "passed" : "failed"));
            return failures;
        }
    }
}

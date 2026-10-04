using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using LaTeXSnipper.Word.Host;
using InteropWord = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.Word.HostTests
{
    internal static class DocumentTargetsAcceptance
    {
        private static void Require(bool value, string error)
        {
            if (!value) throw new InvalidOperationException(error);
        }

        public static int Run(InteropWord.Application application, ref InteropWord.Document first,
            WordAdapter adapter, string evidenceDirectory)
        {
            InteropWord.Document second = null;
            InteropWord.Document readOnly = null;
            string firstDirectory = Path.Combine(evidenceDirectory, "a");
            string secondDirectory = Path.Combine(evidenceDirectory, "b");
            Directory.CreateDirectory(firstDirectory);
            Directory.CreateDirectory(secondDirectory);
            string firstPath = Path.Combine(firstDirectory, "same-title.docx");
            string secondPath = Path.Combine(secondDirectory, "same-title.docx");
            try
            {
                first.Content.Text = "DOC_A \\frac{1}{2}";
                first.SaveAs2(firstPath, InteropWord.WdSaveFormat.wdFormatXMLDocument);
                second = application.Documents.Add();
                second.Content.Text = "DOC_B x^2";
                second.SaveAs2(secondPath, InteropWord.WdSaveFormat.wdFormatXMLDocument);
                string current = adapter.GetCurrentContextId();
                var listed = adapter.DocumentTargets();
                Require(listed.Success && listed.Documents.Count == 2, "Two-document enumeration failed");
                Require(listed.Documents.Select(item => item.DocumentContextId).Distinct().Count() == 2,
                    "Same-title documents lost their distinct identities");
                Require(listed.Documents.Select(item => item.DocumentTitle).Distinct().Count() == 1,
                    "Fixture did not reproduce duplicate document titles");
                Require(!listed.Activated && adapter.GetCurrentContextId() == current,
                    "Enumeration changed the active document");
                string firstId = listed.Documents.Single(item => item.DocumentContextId == "word:" + firstPath).DocumentContextId;
                Require(adapter.DocumentTargets(firstId).Success && adapter.GetCurrentContextId() == firstId,
                    "Explicit first-document activation failed");
                Require(application.Selection.Document.FullName == firstPath,
                    "Selection did not bind to the chosen document");
                string renamedPath = Path.Combine(firstDirectory, "renamed.docx");
                first.SaveAs2(renamedPath, InteropWord.WdSaveFormat.wdFormatXMLDocument);
                string renamedId = adapter.GetCurrentContextId();
                Require(!adapter.DocumentTargets(firstId).Success && adapter.GetCurrentContextId() == renamedId,
                    "Save-As accepted a stale target or changed focus on rejection");
                string secondId = "word:" + secondPath;
                Require(adapter.DocumentTargets(secondId).Success, "Second-document activation failed");
                first.Close(InteropWord.WdSaveOptions.wdDoNotSaveChanges);
                Marshal.ReleaseComObject(first);
                first = null;
                Require(!adapter.DocumentTargets(renamedId).Success && adapter.GetCurrentContextId() == secondId,
                    "Closed document target was accepted or changed focus");
                readOnly = application.Documents.Open(firstPath, ReadOnly: true, AddToRecentFiles: false, Visible: true);
                var readOnlyList = adapter.DocumentTargets();
                Require(readOnlyList.Documents.Single(item => item.DocumentContextId == firstId).ReadOnly,
                    "Read-only state was not reported");
                Require(adapter.DocumentTargets(secondId).Success, "Could not return to writable document");
                Require(!adapter.DocumentTargets(firstId).Success && adapter.GetCurrentContextId() == secondId,
                    "Read-only conversion target was accepted or changed focus");
                Require(readOnly.Content.Text.TrimEnd('\r') == "DOC_A \\frac{1}{2}" &&
                    second.Content.Text.TrimEnd('\r') == "DOC_B x^2", "Document targeting modified source text");
                File.WriteAllText(Path.Combine(evidenceDirectory, "document-targets-evidence.json"),
                    JsonSerializer.Serialize(new {
                        status = "passed", host = "word", targetCount = 2,
                        verified = new[] { "duplicate-titles-distinct-contexts", "readonly-enumeration", "explicit-activation",
                            "selection-document-binding", "save-as-stale-rejection", "closed-target-rejection",
                            "readonly-target-rejection", "source-unchanged" },
                        pipeVerified = false,
                    }, new JsonSerializerOptions { WriteIndented = true }));
                Console.WriteLine("passed real Word document targeting (pipe not covered)");
                return 0;
            }
            finally
            {
                if (readOnly != null) { readOnly.Close(InteropWord.WdSaveOptions.wdDoNotSaveChanges); Marshal.ReleaseComObject(readOnly); }
                if (second != null) { second.Close(InteropWord.WdSaveOptions.wdDoNotSaveChanges); Marshal.ReleaseComObject(second); }
            }
        }
    }
}

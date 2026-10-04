using System;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class DocumentTargetsProtocolTests
    {
        public static int Run()
        {
            try
            {
                DesktopMessage query = new DesktopRequestDocumentTargets { RequestId = "query", SessionId = "s" };
                using (var wire = JsonDocument.Parse(JsonSerializer.Serialize(query)))
                {
                    Require(wire.RootElement.GetProperty("type").GetString() == "REQUEST_DOCUMENT_TARGETS", "query type");
                    Require(!wire.RootElement.TryGetProperty("expectedContextId", out _), "query must not activate a context");
                }
                var activation = JsonSerializer.Deserialize<DesktopMessage>(
                    "{\"type\":\"ACTIVATE_DOCUMENT_TARGET\",\"requestId\":\"activate\",\"sessionId\":\"s\",\"expectedContextId\":\"word:b/same.docx\",\"targetDocumentContextId\":\"word:a/same.docx\"}")
                    as DesktopActivateDocumentTarget;
                Require(activation != null && activation.ExpectedContextId == "word:b/same.docx" &&
                    activation.TargetDocumentContextId == "word:a/same.docx", "explicit source and target identities");
                VstoMessage result = new VstoDocumentTargetsResult {
                    RequestId = "query", SessionId = "s", Success = true, Activated = false,
                    ActiveDocumentContextId = "word:b/same.docx",
                    Documents = {
                        new OfficeDocumentTarget { DocumentContextId = "word:a/same.docx", DocumentTitle = "same.docx", ReadOnly = true },
                        new OfficeDocumentTarget { DocumentContextId = "word:b/same.docx", DocumentTitle = "same.docx", ReadOnly = false }
                    }
                };
                var roundTrip = JsonSerializer.Deserialize<VstoMessage>(JsonSerializer.Serialize(result)) as VstoDocumentTargetsResult;
                Require(roundTrip != null && roundTrip.Documents.Count == 2 && roundTrip.Documents[0].ReadOnly &&
                    roundTrip.Documents[0].DocumentContextId != roundTrip.Documents[1].DocumentContextId &&
                    roundTrip.RequestId == "query" && roundTrip.SessionId == "s", "response identity and readonly state");
                DesktopMessage media = new DesktopReplaceSelectionMedia { RequestId = "media", SessionId = "s",
                    ExpectedContextId = "word:a/same.docx", PlanId = "p", TargetFormat = "svg",
                    Item = new BatchConversionItem { SourceText = "x^2", SourceHash = "hash", Status = "converted",
                        Locator = JsonSerializer.SerializeToElement(new { kind = "wordRange", start = 1, end = 4 }) },
                    Formula = new FormulaPayload { FormulaId = FormulaIdHelper.NewId(), Latex = "x^2", StorageMode = "image",
                        Render = new RenderData { Svg = "<svg/>", WidthPt = 10, HeightPt = 8 } } };
                var mediaRoundTrip = JsonSerializer.Deserialize<DesktopMessage>(JsonSerializer.Serialize(media)) as DesktopReplaceSelectionMedia;
                Require(mediaRoundTrip != null && mediaRoundTrip.TargetFormat == "svg" &&
                    mediaRoundTrip.Item.Locator?.GetProperty("kind").GetString() == "wordRange" &&
                    mediaRoundTrip.ExpectedContextId == "word:a/same.docx" && mediaRoundTrip.Formula.StorageMode == "image",
                    "selection media exact source/target wire contract");
                Console.WriteLine("PASS document targets and selection media v3 wire contract");
                return 0;
            }
            catch (Exception error) { Console.Error.WriteLine("FAIL document targets wire: " + error.Message); return 1; }
        }
        private static void Require(bool value, string message)
        {
            if (!value) throw new InvalidOperationException(message);
        }
    }
}

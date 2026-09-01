#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.ProtocolV4;
using LaTeXSnipper.NativeOffice.Shared;
using ProtocolVersion = LaTeXSnipper.NativeOffice.ProtocolV4.ProtocolV4;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class ProtocolV4Tests
    {
        public static int Run()
        {
            int failures = 0;
            failures += RunCase("insert object round-trip", InsertObjectRoundTrip);
            failures += RunCase("update keeps expected revision", UpdateKeepsExpectedRevision);
            failures += RunCase("unknown message is rejected", UnknownMessageIsRejected);
            failures += RunCase("host router preserves object lifecycle", HostRouterPreservesObjectLifecycle);
            failures += RunCase("host router rejects protocol mismatch", HostRouterRejectsProtocolMismatch);
            failures += RunCase("host router exposes capabilities and cancellation", HostRouterCapabilitiesAndCancellation);
            return failures;
        }

        private static int RunCase(string name, Action test)
        {
            try
            {
                test();
                Console.WriteLine("PASS ProtocolV4 " + name);
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("FAIL ProtocolV4 " + name + ": " + ex.Message);
                return 1;
            }
        }

        private static void InsertObjectRoundTrip()
        {
            using JsonDocument document = JsonDocument.Parse(
                "{\"schema\":\"latexsnipper.object/v1\",\"id\":\"formula-1\",\"kind\":\"formula\",\"revision\":1}");
            ProtocolV4Message source = new InsertObjectV4
            {
                RequestId = "request-1",
                SessionId = "session-1",
                ExpectedContextId = "word:document-1",
                Object = document.RootElement.Clone(),
                Capabilities = { "nativeOmml", "oleRoundTrip" }
            };

            string json = JsonSerializer.Serialize(source);
            ProtocolV4Message? roundTrip = JsonSerializer.Deserialize<ProtocolV4Message>(json);
            InsertObjectV4? insert = roundTrip as InsertObjectV4;

            Expect(insert != null, "message did not deserialize as INSERT_OBJECT");
            Expect(insert!.ProtocolVersion == ProtocolVersion.Version, "protocol version was not preserved");
            Expect(insert.RequestId == "request-1" && insert.SessionId == "session-1",
                "correlation fields were not preserved");
            Expect(insert.Object.GetProperty("id").GetString() == "formula-1",
                "editable object payload was not preserved");
            Expect(insert.Capabilities.Count == 2, "capability evidence was not preserved");
        }

        private static void UpdateKeepsExpectedRevision()
        {
            using JsonDocument document = JsonDocument.Parse(
                "{\"schema\":\"latexsnipper.object/v1\",\"id\":\"drawing-1\",\"kind\":\"drawing\",\"revision\":8}");
            ProtocolV4Message source = new UpdateObjectV4
            {
                RequestId = "request-2",
                SessionId = "session-1",
                ObjectId = "drawing-1",
                ExpectedRevision = 7,
                Object = document.RootElement.Clone()
            };

            string json = JsonSerializer.Serialize(source);
            UpdateObjectV4? update = JsonSerializer.Deserialize<ProtocolV4Message>(json) as UpdateObjectV4;
            Expect(update != null && update.ExpectedRevision == 7,
                "optimistic concurrency revision was not preserved");
        }

        private static void UnknownMessageIsRejected()
        {
            const string json =
                "{\"type\":\"INSERT_DRAWING\",\"requestId\":\"r\",\"sessionId\":\"s\",\"protocolVersion\":4}";
            try
            {
                JsonSerializer.Deserialize<ProtocolV4Message>(json);
                throw new InvalidOperationException("unknown per-artifact command was accepted");
            }
            catch (JsonException)
            {
                // Expected: protocol v4 only accepts the generic object lifecycle.
            }
        }

        private static void HostRouterPreservesObjectLifecycle()
        {
            using JsonDocument document = JsonDocument.Parse(
                "{\"schema\":\"latexsnipper.object/v1\",\"id\":\"drawing-1\",\"kind\":\"drawing\",\"revision\":3}");
            var adapter = new RecordingHostAdapter();
            var router = new ProtocolV4HostRouter();
            var request = new UpdateObjectV4
            {
                RequestId = "request-update",
                SessionId = "session-2",
                ExpectedContextId = "powerpoint:slide-4",
                ObjectId = "drawing-1",
                ExpectedRevision = 2,
                Object = document.RootElement.Clone()
            };

            ObjectResultV4? response = router.Route(request, adapter) as ObjectResultV4;

            Expect(response != null && response.Success && response.Action == "update",
                "host update did not produce a successful correlated response");
            Expect(response!.RequestId == request.RequestId && response.SessionId == request.SessionId,
                "host response lost correlation fields");
            Expect(adapter.LastRequest != null && adapter.LastRequest.ExpectedRevision == 2,
                "host adapter did not receive expectedRevision");
            Expect(adapter.LastRequest!.ExpectedContextId == "powerpoint:slide-4",
                "host adapter did not receive expectedContextId");
        }

        private static void HostRouterRejectsProtocolMismatch()
        {
            var router = new ProtocolV4HostRouter();
            var request = new GetObjectV4
            {
                RequestId = "request-version",
                SessionId = "session-version",
                ProtocolVersion = 99,
                ObjectId = "formula-1"
            };

            ObjectResultV4? response = router.Route(request, new RecordingHostAdapter()) as ObjectResultV4;
            Expect(response != null && !response.Success, "protocol mismatch was accepted");
            Expect(
                response!.Diagnostics.EnumerateArray().Any(
                    item => item.GetProperty("code").GetString() == "PROTOCOL_VERSION_UNSUPPORTED"),
                "protocol mismatch did not return a structured diagnostic");
        }

        private static void HostRouterCapabilitiesAndCancellation()
        {
            var adapter = new RecordingHostAdapter();
            var router = new ProtocolV4HostRouter();
            HostCapabilitiesV4 capabilities = router.DescribeCapabilities("request-cap", "session-cap", adapter);
            Expect(capabilities.Host == "test-host" && capabilities.Capabilities.Count == 2,
                "host capabilities were not exposed");

            var cancel = new CancelRequestV4
            {
                RequestId = "request-cancel",
                SessionId = "session-cap",
                TargetRequestId = "active-request"
            };
            ObjectResultV4? response = router.Route(cancel, adapter) as ObjectResultV4;
            Expect(response != null && response.Success && adapter.Cancelled == "active-request",
                "active request was not cancelled through the host adapter");
        }

        private static void Expect(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private sealed class RecordingHostAdapter :
            IEditableObjectHostAdapter,
            ICancellableEditableObjectHostAdapter
        {
            public string HostName => "test-host";
            public IReadOnlyCollection<string> Capabilities { get; } =
                new[] { "nativeOmml", "svg" };
            public EditableObjectHostRequest? LastRequest { get; private set; }
            public string? Cancelled { get; private set; }

            public EditableObjectHostResult Insert(EditableObjectHostRequest request) => Record(request);
            public EditableObjectHostResult Get(EditableObjectHostRequest request) => Record(request);
            public EditableObjectHostResult Update(EditableObjectHostRequest request) => Record(request);
            public EditableObjectHostResult Delete(EditableObjectHostRequest request) => Record(request);

            public bool Cancel(string targetRequestId)
            {
                Cancelled = targetRequestId;
                return targetRequestId == "active-request";
            }

            private EditableObjectHostResult Record(EditableObjectHostRequest request)
            {
                LastRequest = request;
                return new EditableObjectHostResult
                {
                    Success = true,
                    ObjectId = request.ObjectId ?? "inserted-object",
                    Revision = (request.ExpectedRevision ?? 0) + 1,
                    Object = request.Object
                };
            }
        }
    }
}

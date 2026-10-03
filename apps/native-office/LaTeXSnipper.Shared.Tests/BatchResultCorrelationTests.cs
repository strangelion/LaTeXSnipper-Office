using System;
using System.Collections.Generic;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class BatchResultCorrelationTests
    {
        public static int Run()
        {
            try
            {
                const string requestJson = "{\"type\":\"BATCH_CONVERT\",\"requestId\":\"batch-request-7\",\"sessionId\":\"word-session-2\",\"expectedContextId\":\"document-3\",\"planId\":\"plan-1-part-2\"}";
                var request = (DesktopBatchConvert)JsonSerializer.Deserialize<DesktopMessage>(requestJson);
                var result = new VstoBatchConvertResult
                {
                    PlanId = request.PlanId,
                    Total = 25,
                    Converted = 23,
                    Skipped = 1,
                    Failed = 1,
                    Failures = new List<BatchFailureDto>
                    {
                        new BatchFailureDto { SourceId = "invalid-item", Error = "invalid OMML" }
                    }
                }.WithRequestContext(request);
                var json = JsonSerializer.Serialize<VstoMessage>(result);
                using (var document = JsonDocument.Parse(json))
                {
                    var wire = document.RootElement;
                    if (wire.GetProperty("type").GetString() != "BATCH_CONVERT_RESULT" ||
                        wire.GetProperty("requestId").GetString() != request.RequestId ||
                        wire.GetProperty("sessionId").GetString() != request.SessionId ||
                        wire.GetProperty("planId").GetString() != request.PlanId ||
                        wire.GetProperty("converted").GetInt32() != 23 ||
                        wire.GetProperty("failures")[0].GetProperty("sourceId").GetString() != "invalid-item")
                        throw new InvalidOperationException("batch wire result lost its request context or execution data");
                }
                Console.WriteLine("PASS BatchResultCorrelation request-to-result wire identity and counts");
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("FAIL BatchResultCorrelation: " + ex.Message);
                return 1;
            }
        }
    }
}

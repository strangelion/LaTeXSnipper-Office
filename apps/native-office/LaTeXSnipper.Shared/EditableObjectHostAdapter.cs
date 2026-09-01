#nullable enable
using System;
using System.Collections.Generic;
using System.Text.Json;
using LaTeXSnipper.NativeOffice.ProtocolV4;
using ProtocolVersion = LaTeXSnipper.NativeOffice.ProtocolV4.ProtocolV4;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// Host-neutral lifecycle for Universal Editable Objects. Implementations own
/// host-specific lookup and persistence; the protocol router owns validation,
/// correlation and diagnostic envelopes.
/// </summary>
public interface IEditableObjectHostAdapter
{
    string HostName { get; }
    IReadOnlyCollection<string> Capabilities { get; }
    EditableObjectHostResult Insert(EditableObjectHostRequest request);
    EditableObjectHostResult Get(EditableObjectHostRequest request);
    EditableObjectHostResult Update(EditableObjectHostRequest request);
    EditableObjectHostResult Delete(EditableObjectHostRequest request);
}

public interface ICancellableEditableObjectHostAdapter
{
    bool Cancel(string targetRequestId);
}

public sealed class EditableObjectHostRequest
{
    public string RequestId { get; set; } = "";
    public string SessionId { get; set; } = "";
    public string? ExpectedContextId { get; set; }
    public string? ObjectId { get; set; }
    public ulong? ExpectedRevision { get; set; }
    public JsonElement? Object { get; set; }
    public IReadOnlyCollection<string> RequestedCapabilities { get; set; } = Array.Empty<string>();
}

public sealed class EditableObjectHostDiagnostic
{
    public string Code { get; set; } = "";
    public string Severity { get; set; } = "error";
    public string Message { get; set; } = "";
    public bool Recoverable { get; set; }
}

public sealed class EditableObjectHostResult
{
    public bool Success { get; set; }
    public string? ObjectId { get; set; }
    public ulong? Revision { get; set; }
    public JsonElement? Object { get; set; }
    public List<EditableObjectHostDiagnostic> Diagnostics { get; } = new();

    public static EditableObjectHostResult Failure(
        string code,
        string message,
        bool recoverable = false) =>
        new()
        {
            Success = false,
            Diagnostics =
            {
                new EditableObjectHostDiagnostic
                {
                    Code = code,
                    Message = message,
                    Recoverable = recoverable
                }
            }
        };
}

public sealed class ProtocolV4HostRouter
{
    public ProtocolV4Message Route(
        ProtocolV4Message message,
        IEditableObjectHostAdapter adapter)
    {
        if (message == null) throw new ArgumentNullException(nameof(message));
        if (adapter == null) throw new ArgumentNullException(nameof(adapter));

        if (message.ProtocolVersion != ProtocolVersion.Version)
        {
            return Failure(
                message,
                "protocol",
                "PROTOCOL_VERSION_UNSUPPORTED",
                $"Expected protocol {ProtocolVersion.Version}, received {message.ProtocolVersion}.");
        }

        try
        {
            return message switch
            {
                InsertObjectV4 insert => Result(
                    insert,
                    "insert",
                    adapter.Insert(new EditableObjectHostRequest
                    {
                        RequestId = insert.RequestId,
                        SessionId = insert.SessionId,
                        ExpectedContextId = insert.ExpectedContextId,
                        Object = insert.Object,
                        RequestedCapabilities = insert.Capabilities
                    })),
                GetObjectV4 get => Result(
                    get,
                    "get",
                    adapter.Get(new EditableObjectHostRequest
                    {
                        RequestId = get.RequestId,
                        SessionId = get.SessionId,
                        ExpectedContextId = get.ExpectedContextId,
                        ObjectId = get.ObjectId
                    })),
                UpdateObjectV4 update => Result(
                    update,
                    "update",
                    adapter.Update(new EditableObjectHostRequest
                    {
                        RequestId = update.RequestId,
                        SessionId = update.SessionId,
                        ExpectedContextId = update.ExpectedContextId,
                        ObjectId = update.ObjectId,
                        ExpectedRevision = update.ExpectedRevision,
                        Object = update.Object
                    })),
                DeleteObjectV4 delete => Result(
                    delete,
                    "delete",
                    adapter.Delete(new EditableObjectHostRequest
                    {
                        RequestId = delete.RequestId,
                        SessionId = delete.SessionId,
                        ExpectedContextId = delete.ExpectedContextId,
                        ObjectId = delete.ObjectId,
                        ExpectedRevision = delete.ExpectedRevision
                    })),
                CancelRequestV4 cancel => Cancel(cancel, adapter),
                _ => Failure(
                    message,
                    "protocol",
                    "PROTOCOL_DIRECTION_INVALID",
                    "Only desktop-to-host protocol messages can be routed to an Office adapter.")
            };
        }
        catch (Exception ex)
        {
            return Failure(
                message,
                "host",
                "HOST_ADAPTER_FAILED",
                ex.Message,
                recoverable: true);
        }
    }

    public HostCapabilitiesV4 DescribeCapabilities(
        string requestId,
        string sessionId,
        IEditableObjectHostAdapter adapter) =>
        new()
        {
            RequestId = requestId,
            SessionId = sessionId,
            Host = adapter.HostName,
            Capabilities = new List<string>(adapter.Capabilities)
        };

    private static ProtocolV4Message Cancel(
        CancelRequestV4 message,
        IEditableObjectHostAdapter adapter)
    {
        if (adapter is not ICancellableEditableObjectHostAdapter cancellable)
        {
            return Failure(
                message,
                "cancel",
                "CANCEL_UNSUPPORTED",
                $"Host {adapter.HostName} does not support cancellation.");
        }

        return Result(
            message,
            "cancel",
            cancellable.Cancel(message.TargetRequestId)
                ? new EditableObjectHostResult { Success = true }
                : EditableObjectHostResult.Failure(
                    "REQUEST_NOT_ACTIVE",
                    $"Request {message.TargetRequestId} is not active."));
    }

    private static ObjectResultV4 Result(
        ProtocolV4Message request,
        string action,
        EditableObjectHostResult result) =>
        new()
        {
            RequestId = request.RequestId,
            SessionId = request.SessionId,
            Success = result.Success,
            Action = action,
            ObjectId = result.ObjectId,
            Revision = result.Revision,
            Object = result.Object,
            Diagnostics = ToJson(result.Diagnostics)
        };

    private static ObjectResultV4 Failure(
        ProtocolV4Message request,
        string action,
        string code,
        string message,
        bool recoverable = false) =>
        Result(
            request,
            action,
            EditableObjectHostResult.Failure(code, message, recoverable));

    private static JsonElement ToJson(object value)
    {
        using JsonDocument document = JsonDocument.Parse(JsonSerializer.Serialize(
            value,
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
        return document.RootElement.Clone();
    }
}

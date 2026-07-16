#nullable enable
using System;
using System.Collections.Concurrent;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace LaTeXSnipper.NativeOffice.Shared;

internal static class ProtocolJson
{
    internal static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
}

/// <summary>
/// Named Pipe client for communicating with LaTeXSnipper Desktop.
///
/// Architecture:
/// - Single Reader Loop: reads all incoming messages from pipe
/// - SendAsync: writes message and waits for response via requestId
/// - Desktop push commands: routed to MessageReceived event
/// </summary>
public class PipeClient : IDisposable
{
    private NamedPipeClientStream? _pipe;
    private readonly string _pipeName;
    private bool _connected;
    private int _disconnectSignaled;
    private readonly object _writeLock = new();

    // Pending requests: requestId -> TaskCompletionSource
    private readonly ConcurrentDictionary<string, TaskCompletionSource<DesktopMessage>> _pendingRequests = new();

    // Reader loop cancellation
    private CancellationTokenSource? _readerCts;

    public event EventHandler<DesktopMessage>? MessageReceived;
    public event EventHandler? Disconnected;
    public bool IsConnected => _connected;

    public PipeClient()
    {
        // Use Windows SID for pipe name - not username
        _pipeName = WindowsIdentityHelper.PipeLeafName;
    }

    /// <summary>
    /// Connect to the Desktop pipe server. Timeout after 5 seconds.
    /// </summary>
    public async Task<bool> ConnectAsync(CancellationToken ct = default)
    {
        try
        {
            _pipe = new NamedPipeClientStream(
                ".",
                _pipeName,
                PipeDirection.InOut,
                PipeOptions.Asynchronous
            );

            await _pipe.ConnectAsync(5000, ct);
            Interlocked.Exchange(ref _disconnectSignaled, 0);
            _connected = true;
            return true;
        }
        catch (TimeoutException)
        {
            _connected = false;
            return false;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[PipeClient] Connect failed: {ex.Message}");
            _connected = false;
            return false;
        }
    }

    /// <summary>
    /// Send a message without waiting for a response (fire-and-forget).
    /// Used for result/event messages that do not expect a reply.
    /// </summary>
    public Task SendOnlyAsync(VstoMessage message, CancellationToken ct = default)
    {
        if (_pipe == null || !_connected)
            return Task.CompletedTask;

        try
        {
            var json = JsonSerializer.Serialize<VstoMessage>(message, ProtocolJson.Options);
            var payload = System.Text.Encoding.UTF8.GetBytes(json);
            if (payload.Length == 0 || payload.Length > NativeOfficeProtocol.MaximumMessageBytes)
                throw new InvalidDataException($"Pipe payload length is outside the protocol limit: {payload.Length}.");
            var lenBytes = BitConverter.GetBytes(payload.Length);

            lock (_writeLock)
            {
                _pipe.Write(lenBytes, 0, 4);
                _pipe.Write(payload, 0, payload.Length);
                _pipe.Flush();
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[PipeClient] SendOnly failed: {ex.Message}");
            SignalDisconnected();
        }
        return Task.CompletedTask;
    }

    /// <summary>
    /// Send a message to the Desktop and wait for a response.
    /// Uses requestId to match responses.
    /// </summary>
    public async Task<DesktopMessage?> SendAsync(VstoMessage message, CancellationToken ct = default)
    {
        if (_pipe == null || !_connected)
            return null;

        // Register pending request before sending
        var tcs = new TaskCompletionSource<DesktopMessage>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pendingRequests[message.RequestId] = tcs;

        try
        {
            var json = JsonSerializer.Serialize<VstoMessage>(message, ProtocolJson.Options);
            var payload = Encoding.UTF8.GetBytes(json);
            if (payload.Length == 0 || payload.Length > NativeOfficeProtocol.MaximumMessageBytes)
                throw new InvalidDataException($"Pipe payload length is outside the protocol limit: {payload.Length}.");
            var lenBytes = BitConverter.GetBytes(payload.Length);

            lock (_writeLock)
            {
                _pipe.Write(lenBytes, 0, 4);
                _pipe.Write(payload, 0, payload.Length);
                _pipe.Flush();
            }

            // Wait for response with timeout
            var timeoutTask = Task.Delay(TimeSpan.FromSeconds(10), ct);
            var completedTask = await Task.WhenAny(tcs.Task, timeoutTask);

            if (completedTask == timeoutTask)
            {
                _pendingRequests.TryRemove(message.RequestId, out _);
                return null;
            }

            return await tcs.Task;
        }
        catch (OperationCanceledException)
        {
            _pendingRequests.TryRemove(message.RequestId, out _);
            return null;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[PipeClient] Send failed: {ex.Message}");
            _pendingRequests.TryRemove(message.RequestId, out _);
            SignalDisconnected();
            return null;
        }
    }

    /// <summary>
    /// Start the single reader loop. Must be called after ConnectAsync.
    /// </summary>
    public Task StartListeningAsync(CancellationToken ct)
    {
        _readerCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        return ReaderLoop(_readerCts.Token);
    }

    /// <summary>
    /// Single reader loop - reads all messages from pipe and routes them.
    /// </summary>
    private async Task ReaderLoop(CancellationToken ct)
    {
        if (_pipe == null) return;

        try
        {
            while (!ct.IsCancellationRequested && _connected)
            {
                var msg = await ReadMessageAsync(ct);
                if (msg == null) continue;

                // Check if this is a response to a pending request
                if (_pendingRequests.TryRemove(msg.RequestId, out var tcs))
                {
                    tcs.SetResult(msg);
                }
                else
                {
                    // This is a Desktop push command
                    MessageReceived?.Invoke(this, msg);
                }
            }
        }
        catch (OperationCanceledException ex)
        {
            OfficeOperationLog.Failure("pipe-reader-cancel", "shared", null, ex);
        }
        catch (EndOfStreamException)
        {
            System.Diagnostics.Debug.WriteLine("[PipeClient] Connection closed by server");
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[PipeClient] ReaderLoop error: {ex.Message}");
        }
        finally
        {
            SignalDisconnected();
        }
    }

    private async Task<DesktopMessage?> ReadMessageAsync(CancellationToken ct)
    {
        if (_pipe == null) return null;

        // Read 4-byte length prefix
        var lenBuf = new byte[4];
        await _pipe.ReadExactAsync(lenBuf, 0, 4, ct);
        var len = BitConverter.ToInt32(lenBuf, 0);

        if (len <= 0 || len > NativeOfficeProtocol.MaximumMessageBytes)
            throw new InvalidDataException($"Pipe frame length is outside the protocol limit: {len}.");

        // Read payload
        var payload = new byte[len];
        await _pipe.ReadExactAsync(payload, 0, len, ct);

        var json = Encoding.UTF8.GetString(payload);
        return JsonSerializer.Deserialize<DesktopMessage>(json, ProtocolJson.Options);
    }

    /// <summary>
    /// Send HELLO handshake.
    /// </summary>
    public async Task<bool> SendHelloAsync(string sessionId, string dpapiSecret, string hostType, string hostVersion)
    {
        var hello = new VstoHello
        {
            RequestId = GenerateId(),
            SessionId = sessionId,
            ProtocolVersion = NativeOfficeProtocol.Version,
            DpapiSecret = dpapiSecret,
            HostType = hostType,
            HostVersion = hostVersion
        };

        var response = await SendAsync(hello);
        return response is DesktopHelloAck ack && ack.ProtocolVersion == NativeOfficeProtocol.Version;
    }

    /// <summary>
    /// Send HOST_READY after the add-in is fully initialized.
    /// The capabilities describe which commands this host supports.
    /// </summary>
    public async Task SendHostReadyAsync(string sessionId, string hostType, string hostVersion, Capabilities capabilities, string? documentContextId = null, string? documentTitle = null)
    {
        var msg = new VstoHostReady
        {
            RequestId = GenerateId(),
            SessionId = sessionId,
            HostType = hostType,
            HostVersion = hostVersion,
            Capabilities = capabilities,
            DocumentContextId = documentContextId,
            DocumentTitle = documentTitle
        };
        await SendAsync(msg);
    }

    public void Disconnect()
    {
        _readerCts?.Cancel();
        SignalDisconnected();

        // Complete all pending requests with error
        foreach (var kvp in _pendingRequests)
        {
            kvp.Value.TrySetCanceled();
        }
        _pendingRequests.Clear();

        try { _pipe?.Dispose(); }
        catch (Exception ex)
        {
            OfficeOperationLog.Failure("pipe-dispose", "shared", null, ex);
        }
        _pipe = null;
    }

    private void SignalDisconnected()
    {
        bool wasConnected = _connected;
        _connected = false;
        if (wasConnected && Interlocked.Exchange(ref _disconnectSignaled, 1) == 0)
            Disconnected?.Invoke(this, EventArgs.Empty);
    }

    public void Dispose()
    {
        Disconnect();
        GC.SuppressFinalize(this);
    }

    /// Generate a short request ID (12 chars, sufficient for tracing).
    private static string GenerateId() => Guid.NewGuid().ToString("N").Substring(0, 12);
}

/// Helper for generating formula identifiers (full GUID, no truncation).
public static class FormulaIdHelper
{
    public static string NewId() => Guid.NewGuid().ToString("N");

    public static bool IsCanonical(string? value) =>
        value != null && value.Length == 32 && Guid.TryParseExact(value, "N", out _);
}

/// <summary>
/// Extension method for reading exact byte count from stream.
/// </summary>
internal static class StreamExtensions
{
    public static async Task ReadExactAsync(this Stream stream, byte[] buffer, int offset, int count, CancellationToken ct)
    {
        int totalRead = 0;
        while (totalRead < count)
        {
            int read = await stream.ReadAsync(buffer, offset + totalRead, count - totalRead, ct);
            if (read == 0)
                throw new EndOfStreamException();
            totalRead += read;
        }
    }
}

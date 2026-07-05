using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// Named Pipe client for communicating with LaTeXSnipper Desktop.
/// </summary>
public class PipeClient : IDisposable
{
    private NamedPipeClientStream? _pipe;
    private readonly string _pipeName;
    private bool _connected;
    private readonly object _lock = new();

    public event EventHandler<DesktopMessage>? MessageReceived;
    public event EventHandler? Disconnected;
    public bool IsConnected => _connected;

    public PipeClient(string userSid)
    {
        _pipeName = $@"\\.\pipe\{PipePrefix}.{userSid}";
    }

    public PipeClient() : this(Environment.UserName) { }

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
                PipeOptions.None
            );

            await _pipe.ConnectAsync(5000, ct);
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
    /// Send a message to the Desktop and wait for a response.
    /// </summary>
    public async Task<DesktopMessage?> SendAsync(VstoMessage message, CancellationToken ct = default)
    {
        if (_pipe == null || !_connected)
            return null;

        try
        {
            var json = JsonSerializer.Serialize(message);
            var payload = Encoding.UTF8.GetBytes(json);
            var lenBytes = BitConverter.GetBytes(payload.Length);

            lock (_lock)
            {
                _pipe.Write(lenBytes, 0, 4);
                _pipe.Write(payload, 0, payload.Length);
                _pipe.Flush();
            }

            // Wait for response
            return await ReadMessageAsync(ct);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[PipeClient] Send failed: {ex.Message}");
            _connected = false;
            Disconnected?.Invoke(this, EventArgs.Empty);
            return null;
        }
    }

    /// <summary>
    /// Start listening for incoming messages from the Desktop.
    /// </summary>
    public async Task StartListeningAsync(CancellationToken ct)
    {
        if (_pipe == null || !_connected) return;

        try
        {
            while (!ct.IsCancellationRequested && _connected)
            {
                var msg = await ReadMessageAsync(ct);
                if (msg != null)
                {
                    MessageReceived?.Invoke(this, msg);
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[PipeClient] Listen error: {ex.Message}");
        }
        finally
        {
            _connected = false;
            Disconnected?.Invoke(this, EventArgs.Empty);
        }
    }

    private async Task<DesktopMessage?> ReadMessageAsync(CancellationToken ct)
    {
        if (_pipe == null) return null;

        // Read 4-byte length prefix
        var lenBuf = new byte[4];
        await _pipe.ReadExactAsync(lenBuf, 0, 4, ct);
        var len = BitConverter.ToInt32(lenBuf, 0);

        if (len <= 0 || len > 1024 * 1024) // 1MB max
            return null;

        // Read payload
        var payload = new byte[len];
        await _pipe.ReadExactAsync(payload, 0, len, ct);

        var json = Encoding.UTF8.GetString(payload);
        return JsonSerializer.Deserialize<DesktopMessage>(json);
    }

    /// <summary>
    /// Send HELLO handshake.
    /// </summary>
    public async Task<bool> SendHelloAsync(string dpapiSecret, string hostType, string hostVersion)
    {
        var hello = new VstoHello
        {
            RequestId = GenerateId(),
            SessionId = GenerateId(),
            ProtocolVersion = ProtocolVersion,
            DpapiSecret = dpapiSecret,
            HostType = hostType,
            HostVersion = hostVersion
        };

        var response = await SendAsync(hello);
        return response is DesktopHelloAck ack && ack.ProtocolVersion == ProtocolVersion;
    }

    /// <summary>
    /// Send HOST_READY after Word is fully initialized.
    /// </summary>
    public async Task SendHostReadyAsync(string sessionId, string hostType, string hostVersion, string? documentId = null)
    {
        var msg = new VstoHostReady
        {
            RequestId = GenerateId(),
            SessionId = sessionId,
            HostType = hostType,
            HostVersion = hostVersion,
            DocumentId = documentId
        };
        await SendAsync(msg);
    }

    public void Disconnect()
    {
        _connected = false;
        try { _pipe?.Dispose(); } catch { }
        _pipe = null;
    }

    public void Dispose()
    {
        Disconnect();
        GC.SuppressFinalize(this);
    }

    private static string GenerateId() => Guid.NewGuid().ToString("N")[..12];
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

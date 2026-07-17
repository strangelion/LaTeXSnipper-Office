#nullable enable
using System;
using System.Threading;
using System.Threading.Tasks;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// Runs one Native Office connection attempt at a time and reconnects until the
/// owning Office host shuts down.
/// </summary>
public sealed class PipeReconnectCoordinator : IDisposable
{
    private readonly string _host;
    private readonly Func<Action, CancellationToken, Task<bool>> _connectOnce;
    private readonly Action<bool> _connectionChanged;
    private readonly TimeSpan _retryDelay;
    private readonly CancellationTokenSource _shutdown = new();
    private int _started;
    private int _connected;

    public PipeReconnectCoordinator(
        string host,
        Func<Action, CancellationToken, Task<bool>> connectOnce,
        Action<bool> connectionChanged,
        TimeSpan? retryDelay = null)
    {
        _host = string.IsNullOrWhiteSpace(host) ? "shared" : host;
        _connectOnce = connectOnce ?? throw new ArgumentNullException(nameof(connectOnce));
        _connectionChanged = connectionChanged ?? throw new ArgumentNullException(nameof(connectionChanged));
        _retryDelay = retryDelay ?? TimeSpan.FromSeconds(3);
        if (_retryDelay < TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(retryDelay));
    }

    public bool IsConnected => Volatile.Read(ref _connected) != 0;

    public void Start()
    {
        if (Interlocked.Exchange(ref _started, 1) != 0) return;
        _ = RunAsync(_shutdown.Token);
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var disconnected = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            bool connected = false;
            try
            {
                connected = await _connectOnce(
                    () => disconnected.TrySetResult(true),
                    cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                OfficeOperationLog.Failure("pipe-connect-attempt", _host, null, ex);
            }

            if (connected)
            {
                SetConnected(true);
                using (cancellationToken.Register(() => disconnected.TrySetCanceled()))
                {
                    try
                    {
                        await disconnected.Task.ConfigureAwait(false);
                    }
                    catch (TaskCanceledException) when (cancellationToken.IsCancellationRequested)
                    {
                        break;
                    }
                }
                SetConnected(false);
            }

            if (cancellationToken.IsCancellationRequested) break;
            try
            {
                await Task.Delay(_retryDelay, cancellationToken).ConfigureAwait(false);
            }
            catch (TaskCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
        }

        SetConnected(false);
    }

    private void SetConnected(bool connected)
    {
        int next = connected ? 1 : 0;
        if (Interlocked.Exchange(ref _connected, next) == next) return;
        try
        {
            _connectionChanged(connected);
        }
        catch (Exception ex)
        {
            OfficeOperationLog.Failure("pipe-connection-state", _host, null, ex);
        }
    }

    public void Dispose()
    {
        _shutdown.Cancel();
        SetConnected(false);
        GC.SuppressFinalize(this);
    }
}

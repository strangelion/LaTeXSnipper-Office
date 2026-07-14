#nullable enable
using System;
using System.Threading;
using System.Windows.Forms;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// Marshals Named Pipe commands onto the Office-owned UI STA.
/// The dispatcher uses the Office message pump, bounds queued work, rejects
/// stale operations, and never moves Office RCWs onto a thread-pool worker.
/// </summary>
public sealed class OfficeStaDispatcher : IDisposable
{
    private readonly Control _control;
    private readonly string _host;
    private readonly int _ownerThreadId;
    private readonly int _maximumPendingOperations;
    private readonly TimeSpan _maximumQueueAge;
    private int _pendingOperations;
    private int _disposed;

    public OfficeStaDispatcher(
        string host,
        int maximumPendingOperations = 64,
        TimeSpan? maximumQueueAge = null)
    {
        if (Thread.CurrentThread.GetApartmentState() != ApartmentState.STA)
            throw new InvalidOperationException("OfficeStaDispatcher must be created on the Office STA thread.");
        if (maximumPendingOperations < 1)
            throw new ArgumentOutOfRangeException(nameof(maximumPendingOperations));

        _host = string.IsNullOrWhiteSpace(host) ? "office" : host;
        _ownerThreadId = Thread.CurrentThread.ManagedThreadId;
        _maximumPendingOperations = maximumPendingOperations;
        _maximumQueueAge = maximumQueueAge ?? TimeSpan.FromSeconds(30);
        _control = new Control();
        _control.CreateControl();
    }

    public bool IsAvailable =>
        Volatile.Read(ref _disposed) == 0 && !_control.IsDisposed && _control.IsHandleCreated;

    public bool IsCurrentThread =>
        Thread.CurrentThread.ManagedThreadId == _ownerThreadId &&
        Thread.CurrentThread.GetApartmentState() == ApartmentState.STA;

    public int PendingOperations => Volatile.Read(ref _pendingOperations);

    public bool TryPost(string operationId, Action operation, Action<Exception>? onError = null)
    {
        if (operation == null) throw new ArgumentNullException(nameof(operation));
        if (!IsAvailable) return false;

        int pending = Interlocked.Increment(ref _pendingOperations);
        if (pending > _maximumPendingOperations)
        {
            Interlocked.Decrement(ref _pendingOperations);
            onError?.Invoke(new InvalidOperationException("OFFICE_STA_QUEUE_FULL"));
            return false;
        }

        DateTime queuedAt = DateTime.UtcNow;
        try
        {
            _control.BeginInvoke(new Action(() =>
            {
                try
                {
                    if (!IsAvailable)
                        throw new ObjectDisposedException(nameof(OfficeStaDispatcher));
                    if (!IsCurrentThread)
                        throw new InvalidOperationException("OFFICE_STA_THREAD_MISMATCH");
                    if (DateTime.UtcNow - queuedAt > _maximumQueueAge)
                        throw new TimeoutException("OFFICE_STA_QUEUE_TIMEOUT");
                    operation();
                }
                catch (Exception error)
                {
                    OfficeOperationLog.Failure(
                        string.IsNullOrWhiteSpace(operationId) ? "office-sta-operation" : operationId,
                        _host,
                        null,
                        error);
                    onError?.Invoke(error);
                }
                finally
                {
                    Interlocked.Decrement(ref _pendingOperations);
                }
            }));
            return true;
        }
        catch (Exception error)
        {
            Interlocked.Decrement(ref _pendingOperations);
            OfficeOperationLog.Failure("office-sta-dispatch", _host, null, error);
            onError?.Invoke(error);
            return false;
        }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        if (IsCurrentThread)
            _control.Dispose();
        else
            _control.BeginInvoke(new Action(_control.Dispose));
    }
}

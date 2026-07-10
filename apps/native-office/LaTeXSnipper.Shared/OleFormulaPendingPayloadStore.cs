#nullable enable
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32;

namespace LaTeXSnipper.NativeOffice.Shared;

public static class OleFormulaPendingPayloadStore
{
    private const string KeyPath = @"Software\LaTeXSnipper\OfficePlugin\OleFormulaObject";
    private const string PendingPayloadPrefix = "PendingPayload.";
    private static readonly TimeSpan LeaseTimeout = TimeSpan.FromSeconds(10);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    private static string GetValueName(int pid) => $"{PendingPayloadPrefix}{pid}";

    public static PendingPayloadLease Save(FormulaPayload payload)
    {
        if (payload == null) throw new ArgumentNullException(nameof(payload));
        int pid = Process.GetCurrentProcess().Id;
        uint tid = GetCurrentThreadId();
        var mutex = new Mutex(false, $@"Local\LaTeXSnipper.OlePayload.{pid}");
        bool ownsMutex = false;
        try
        {
            try
            {
                ownsMutex = mutex.WaitOne(LeaseTimeout);
            }
            catch (AbandonedMutexException)
            {
                ownsMutex = true;
            }
            if (!ownsMutex)
                throw new TimeoutException($"OLE payload lease timed out for process {pid}.");

            payload.CreatedUtcTicks = DateTime.UtcNow.Ticks;
            string json = System.Text.Json.JsonSerializer.Serialize(payload, new System.Text.Json.JsonSerializerOptions
            {
                DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
            });
            string valueName = GetValueName(pid);
            using RegistryKey key = Registry.CurrentUser.CreateSubKey(KeyPath)
                ?? throw new InvalidOperationException("Cannot open OLE formula payload registry key.");
            key.SetValue(valueName, json, RegistryValueKind.String);
            Debug.WriteLine($"[OlePayloadStore] Saved pid={pid} tid={tid} formulaId={payload.FormulaId}");
            return new PendingPayloadLease(mutex, valueName, pid, tid, payload.FormulaId);
        }
        catch
        {
            if (ownsMutex) mutex.ReleaseMutex();
            mutex.Dispose();
            throw;
        }
    }

    public static string? Consume()
    {
        int pid = Process.GetCurrentProcess().Id;
        string valueName = GetValueName(pid);
        using RegistryKey? key = Registry.CurrentUser.OpenSubKey(KeyPath, writable: true);
        if (key == null) return null;
        string? value = key.GetValue(valueName) as string;
        if (value != null) key.DeleteValue(valueName, throwOnMissingValue: false);
        return value;
    }

    internal static void DeleteValue(string valueName)
    {
        using RegistryKey? key = Registry.CurrentUser.OpenSubKey(KeyPath, writable: true);
        key?.DeleteValue(valueName, throwOnMissingValue: false);
    }
}

public sealed class PendingPayloadLease : IDisposable
{
    private Mutex? mutex;
    private readonly string valueName;
    private readonly int pid;
    private readonly uint tid;
    private readonly string formulaId;

    internal PendingPayloadLease(Mutex mutex, string valueName, int pid, uint tid, string formulaId)
    {
        this.mutex = mutex;
        this.valueName = valueName;
        this.pid = pid;
        this.tid = tid;
        this.formulaId = formulaId;
    }

    public void Dispose()
    {
        Mutex? owned = Interlocked.Exchange(ref mutex, null);
        if (owned == null) return;
        try
        {
            OleFormulaPendingPayloadStore.DeleteValue(valueName);
            Debug.WriteLine($"[OlePayloadStore] Released pid={pid} tid={tid} formulaId={formulaId}");
        }
        finally
        {
            owned.ReleaseMutex();
            owned.Dispose();
        }
    }
}

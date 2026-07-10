#nullable enable
using System;
using System.Diagnostics;
using System.Threading;
using Microsoft.Win32;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// Registry-based pending payload store for OLE formula objects.
///
/// The VSTO add-in writes the FormulaPayload JSON to HKCU before calling
/// AddOLEObject. The C++ OLE DLL reads (and deletes) this value during
/// construction, allowing it to render the correct formula immediately
/// without waiting for InitializeFromJson (which is called after AddOLEObject
/// returns and may race with Office's rendering requests).
///
/// Uses per-PID.TID isolation to prevent concurrent insertions (e.g. Word +
/// PowerPoint simultaneously) from overwriting each other's payloads.
///
/// Registry path: HKCU\Software\LaTeXSnipper\OfficePlugin\OleFormulaObject
/// Value name:    PendingPayload.{ProcessId}.{ThreadId}
/// </summary>
public static class OleFormulaPendingPayloadStore
{
    private const string KeyPath = @"Software\LaTeXSnipper\OfficePlugin\OleFormulaObject";
    private const string PendingPayloadPrefix = "PendingPayload.";

    /// <summary>
    /// Build the per-PID.TID value name for registry isolation.
    /// </summary>
    private static string GetValueName()
    {
        int pid = Process.GetCurrentProcess().Id;
        int tid = Thread.CurrentThread.ManagedThreadId;
        return $"{PendingPayloadPrefix}{pid}.{tid}";
    }

    /// <summary>
    /// Save a FormulaPayload JSON to the registry for the OLE DLL to consume.
    /// Must be called BEFORE InlineShapes.AddOLEObject().
    /// Uses current PID.TID as the value name so concurrent insertions
    /// in different processes or threads do not collide.
    /// </summary>
    public static void Save(FormulaPayload payload)
    {
        if (payload == null)
            throw new ArgumentNullException(nameof(payload));

        string json = System.Text.Json.JsonSerializer.Serialize(payload, new System.Text.Json.JsonSerializerOptions
        {
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
        });

        using RegistryKey key = Registry.CurrentUser.CreateSubKey(KeyPath)
            ?? throw new InvalidOperationException("Cannot open OLE formula payload registry key.");
        key.SetValue(GetValueName(), json, RegistryValueKind.String);
    }

    /// <summary>
    /// Read and delete the pending payload from the registry for the current PID.TID.
    /// Called by the OLE DLL during construction.
    /// Returns null if no pending payload exists for the current thread.
    /// </summary>
    public static string? Consume()
    {
        using RegistryKey? key = Registry.CurrentUser.OpenSubKey(KeyPath, writable: true);
        if (key == null) return null;

        string valueName = GetValueName();
        string? value = key.GetValue(valueName) as string;
        if (value != null)
        {
            key.DeleteValue(valueName);
        }
        return value;
    }
}

#nullable enable
using System;
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
/// Registry path: HKCU\Software\LaTeXSnipper\OfficePlugin\OleFormulaObject\PendingPayload
/// Same key as the legacy LaTeXSnipper project for compatibility.
/// </summary>
public static class OleFormulaPendingPayloadStore
{
    private const string KeyPath = @"Software\LaTeXSnipper\OfficePlugin\OleFormulaObject";
    private const string PendingPayloadValue = "PendingPayload";

    /// <summary>
    /// Save a FormulaPayload JSON to the registry for the OLE DLL to consume.
    /// Must be called BEFORE InlineShapes.AddOLEObject().
    /// Overwrites any previous pending payload.
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
        key.SetValue(PendingPayloadValue, json, RegistryValueKind.String);
    }

    /// <summary>
    /// Read and delete the pending payload from the registry.
    /// Called by the OLE DLL during construction.
    /// Returns null if no pending payload exists.
    /// </summary>
    public static string? Consume()
    {
        using RegistryKey? key = Registry.CurrentUser.OpenSubKey(KeyPath, writable: true);
        if (key == null) return null;

        string? value = key.GetValue(PendingPayloadValue) as string;
        if (value != null)
        {
            key.DeleteValue(PendingPayloadValue);
        }
        return value;
    }
}

#nullable enable
using System;
using System.Diagnostics;

namespace LaTeXSnipper.NativeOffice.Shared;

public static class OfficeOperationLog
{
    public static void Failure(string operation, string host, string? formulaId, Exception exception)
    {
        if (exception == null) throw new ArgumentNullException(nameof(exception));
        Debug.WriteLine(
            $"[NativeOffice] operation={Sanitize(operation)} host={Sanitize(host)} " +
            $"formulaId={Sanitize(formulaId ?? "<unknown>")} hresult=0x{exception.HResult:X8} " +
            $"error={exception.GetType().Name}");
    }

    public static void Event(string operation, string host, string? formulaId, int hresult = 0)
    {
        Debug.WriteLine(
            $"[NativeOffice] operation={Sanitize(operation)} host={Sanitize(host)} " +
            $"formulaId={Sanitize(formulaId ?? "<unknown>")} hresult=0x{hresult:X8}");
    }

    private static string Sanitize(string value) =>
        value.Replace("\r", " ").Replace("\n", " ").Replace("\t", " ");
}

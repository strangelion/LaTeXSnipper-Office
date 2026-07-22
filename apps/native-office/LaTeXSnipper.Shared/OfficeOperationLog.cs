#nullable enable
using System;
using System.Diagnostics;
using System.IO;

namespace LaTeXSnipper.NativeOffice.Shared;

public static class OfficeOperationLog
{
    private static readonly object s_fileLock = new();
    private static string? s_logDir;

    private static string LogDir
    {
        get
        {
            if (s_logDir == null)
            {
                s_logDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "LaTeXSnipper",
                    "Logs",
                    "native-office");
                Directory.CreateDirectory(s_logDir);
            }
            return s_logDir;
        }
    }

    public static void Failure(string operation, string host, string? formulaId, Exception exception)
    {
        if (exception == null) throw new ArgumentNullException(nameof(exception));
        var msg =
            $"[NativeOffice] operation={Sanitize(operation)} host={Sanitize(host)} " +
            $"formulaId={Sanitize(formulaId ?? "<unknown>")} hresult=0x{exception.HResult:X8} " +
            $"error={exception.GetType().Name}";
        Debug.WriteLine(msg);
        WriteToFile(host, $"[ERROR] {msg}");
    }

    public static void Event(string operation, string host, string? formulaId, int hresult = 0)
    {
        var msg =
            $"[NativeOffice] operation={Sanitize(operation)} host={Sanitize(host)} " +
            $"formulaId={Sanitize(formulaId ?? "<unknown>")} hresult=0x{hresult:X8}";
        Debug.WriteLine(msg);
        WriteToFile(host, $"[INFO] {msg}");
    }

    private static void WriteToFile(string host, string line)
    {
        try
        {
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
            var entry = $"{timestamp} {line}\n";
            var path = Path.Combine(LogDir, $"{SanitizeFileName(host)}.log");

            lock (s_fileLock)
            {
                var fi = new FileInfo(path);
                if (fi.Exists && fi.Length > 512 * 1024)
                {
                    var oldPath = Path.ChangeExtension(path, ".old.log");
                    try { File.Delete(oldPath); } catch { }
                    try { File.Move(path, oldPath); } catch { }
                }
                File.AppendAllText(path, entry);
            }
        }
        catch
        {
            // Logging must never throw
        }
    }

    private static string SanitizeFileName(string value) =>
        value.Replace('\\', '_').Replace('/', '_').Replace(':', '_');

    private static string Sanitize(string value) =>
        value.Replace("\r", " ").Replace("\n", " ").Replace("\t", " ");
}

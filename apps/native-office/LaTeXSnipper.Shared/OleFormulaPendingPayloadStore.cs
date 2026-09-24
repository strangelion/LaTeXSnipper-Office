#nullable enable
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using Microsoft.Win32;

namespace LaTeXSnipper.NativeOffice.Shared;

public static class OleFormulaPendingPayloadStore
{
    private const string KeyPath = @"Software\LaTeXSnipper\OfficePlugin\OleFormulaObject";
    private const string PendingPayloadPrefix = "PendingPayload.";
    private const string PendingReferenceFilePrefix = "reference-";
    private const int ReferenceSchemaVersion = 1;
    private const int MaximumPayloadBytes = 64 * 1024 * 1024;
    private const int MaximumReferenceCharacters = 2048;
    private static readonly TimeSpan LeaseTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PayloadTimeout = TimeSpan.FromMinutes(5);
    private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    private static string GetValueName(int pid) => $"{PendingPayloadPrefix}{pid}";

    internal static string PayloadDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "LaTeXSnipper", "OfficePlugin", "PendingPayloads");

    private static string GetPayloadPath(string token) => Path.Combine(PayloadDirectory, token + ".json");
    private static string GetReferencePath(int pid) => Path.Combine(
        PayloadDirectory,
        $"{PendingReferenceFilePrefix}{pid}.json");

    public static PendingPayloadLease Save(FormulaPayload payload)
    {
        return SaveForProcess(payload, Process.GetCurrentProcess().Id);
    }

    /// <summary>
    /// Save a payload for an out-of-process Office host used by real-host
    /// acceptance tests. The target must be alive in the caller's session.
    /// Production add-ins use <see cref="Save(FormulaPayload)"/> because the
    /// managed add-in and native OLE handler share the Office process.
    /// </summary>
    public static PendingPayloadLease SaveForProcess(
        FormulaPayload payload,
        int targetProcessId)
    {
        if (payload == null) throw new ArgumentNullException(nameof(payload));
        if (targetProcessId <= 0)
            throw new ArgumentOutOfRangeException(nameof(targetProcessId));
        int callerProcessId;
        using (Process target = Process.GetProcessById(targetProcessId))
        using (Process current = Process.GetCurrentProcess())
        {
            callerProcessId = current.Id;
            if (target.HasExited || target.SessionId != current.SessionId)
                throw new InvalidOperationException(
                    "OLE payload target must be alive in the current logon session.");
        }
        int pid = targetProcessId;
        uint tid = GetCurrentThreadId();
        var mutex = new Mutex(false, $@"Local\LaTeXSnipper.OlePayload.{pid}");
        bool ownsMutex = false;
        string? token = null;
        string? payloadPath = null;
        string referencePath = GetReferencePath(pid);
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
            byte[] payloadBytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, JsonOptions));
            if (payloadBytes.Length == 0 || payloadBytes.Length > MaximumPayloadBytes)
                throw new InvalidOperationException($"OLE payload size is outside the allowed range: {payloadBytes.Length} bytes.");

            EnsurePayloadDirectoryAcl();
            token = CreateToken();
            payloadPath = GetPayloadPath(token);
            WritePayloadAtomically(payloadPath, payloadBytes);

            var reference = new PendingPayloadReference
            {
                SchemaVersion = ReferenceSchemaVersion,
                Token = token,
                CreatedUtcTicks = payload.CreatedUtcTicks,
                ByteLength = payloadBytes.Length,
                Sha256 = ComputeSha256(payloadBytes)
            };
            string referenceJson = JsonSerializer.Serialize(reference, JsonOptions);
            if (referenceJson.Length > MaximumReferenceCharacters)
                throw new InvalidOperationException("OLE payload reference exceeds the registry size limit.");

            DeleteFile(referencePath);
            WritePayloadAtomically(referencePath, Encoding.UTF8.GetBytes(referenceJson));
            string valueName = GetValueName(pid);
            using RegistryKey key = Registry.CurrentUser.CreateSubKey(KeyPath)
                ?? throw new InvalidOperationException("Cannot open OLE formula payload registry key.");
            key.SetValue(valueName, referenceJson, RegistryValueKind.String);
            WriteDiagnostic($"saved callerPid={callerProcessId} targetPid={pid} tid={tid} value={valueName} formulaId={payload.FormulaId} bytes={payloadBytes.Length}");
            Debug.WriteLine($"[OlePayloadStore] Saved token reference pid={pid} tid={tid} formulaId={payload.FormulaId} bytes={payloadBytes.Length}");
            return new PendingPayloadLease(mutex, valueName, token, pid, tid, payload.FormulaId);
        }
        catch
        {
            if (payloadPath != null) DeleteFile(payloadPath);
            DeleteFile(referencePath);
            if (ownsMutex) mutex.ReleaseMutex();
            mutex.Dispose();
            throw;
        }
    }

    public static string? Consume()
    {
        int pid = Process.GetCurrentProcess().Id;
        string valueName = GetValueName(pid);
        string? referenceJson = null;
        string referencePath = GetReferencePath(pid);
        try
        {
            if (File.Exists(referencePath))
                referenceJson = File.ReadAllText(referencePath, new UTF8Encoding(false, true));
        }
        catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is DecoderFallbackException)
        {
            Debug.WriteLine($"[OlePayloadStore] Consume failed operation=read-reference-file pid={pid} error={ex.GetType().Name}");
        }
        using (RegistryKey? key = Registry.CurrentUser.OpenSubKey(KeyPath, writable: true))
        {
            if (referenceJson == null)
                referenceJson = key?.GetValue(valueName) as string;
            key?.DeleteValue(valueName, throwOnMissingValue: false);
        }
        DeleteFile(referencePath);
        if (referenceJson == null || string.IsNullOrWhiteSpace(referenceJson) ||
            referenceJson.Length > MaximumReferenceCharacters) return null;

        PendingPayloadReference? reference = null;
        try
        {
            reference = JsonSerializer.Deserialize<PendingPayloadReference>(referenceJson, JsonOptions);
            if (!IsValidReference(reference)) return null;
            string path = GetPayloadPath(reference!.Token);
            byte[] bytes = File.ReadAllBytes(path);
            if (bytes.Length != reference.ByteLength || bytes.Length > MaximumPayloadBytes ||
                !FixedTimeEquals(reference.Sha256, ComputeSha256(bytes)))
            {
                return null;
            }
            return new UTF8Encoding(false, true).GetString(bytes);
        }
        catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is JsonException || ex is DecoderFallbackException)
        {
            Debug.WriteLine($"[OlePayloadStore] Consume failed operation=read-reference pid={pid} error={ex.GetType().Name}");
            return null;
        }
        finally
        {
            if (reference != null && IsToken(reference.Token)) DeleteFile(GetPayloadPath(reference.Token));
        }
    }

    internal static void DeleteValueAndFile(string valueName, string token, int pid)
    {
        WriteDiagnostic($"releasing callerPid={Process.GetCurrentProcess().Id} targetPid={pid} value={valueName}");
        using RegistryKey? key = Registry.CurrentUser.OpenSubKey(KeyPath, writable: true);
        key?.DeleteValue(valueName, throwOnMissingValue: false);
        DeleteFile(GetReferencePath(pid));
        if (IsToken(token)) DeleteFile(GetPayloadPath(token));
    }

    internal static void WriteDiagnostic(string message)
    {
        if (Environment.GetEnvironmentVariable("LATEXSNIPPER_OLE_LOG") == null) return;
        try
        {
            string directory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "LaTeXSnipper", "OfficePlugin", "OleFormulaObjectNative");
            Directory.CreateDirectory(directory);
            File.AppendAllText(
                Path.Combine(directory, "ole-managed.log"),
                $"{DateTime.Now:yyyy-MM-ddTHH:mm:ss.fff} {message}{Environment.NewLine}",
                Encoding.UTF8);
        }
        catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
        {
            Debug.WriteLine($"[OlePayloadStore] Diagnostic log failed: {ex.GetType().Name}");
        }
    }

    private static bool IsValidReference(PendingPayloadReference? reference)
    {
        if (reference == null || reference.SchemaVersion != ReferenceSchemaVersion || !IsToken(reference.Token) ||
            reference.ByteLength <= 0 || reference.ByteLength > MaximumPayloadBytes ||
            !IsSha256(reference.Sha256))
        {
            return false;
        }
        long age = DateTime.UtcNow.Ticks - reference.CreatedUtcTicks;
        return age >= -TimeSpan.FromMinutes(1).Ticks && age <= PayloadTimeout.Ticks;
    }

    private static bool IsToken(string? token)
    {
        if (token == null || token.Length != 64) return false;
        foreach (char ch in token)
            if (!Uri.IsHexDigit(ch)) return false;
        return true;
    }

    private static bool IsSha256(string? value) => IsToken(value);

    private static string CreateToken()
    {
        byte[] bytes = new byte[32];
        using (RandomNumberGenerator random = RandomNumberGenerator.Create()) random.GetBytes(bytes);
        return ToHex(bytes);
    }

    private static string ComputeSha256(byte[] bytes)
    {
        using (SHA256 sha256 = SHA256.Create()) return ToHex(sha256.ComputeHash(bytes));
    }

    private static string ToHex(byte[] bytes)
    {
        var result = new StringBuilder(bytes.Length * 2);
        foreach (byte value in bytes) result.Append(value.ToString("x2"));
        return result.ToString();
    }

    private static bool FixedTimeEquals(string left, string right)
    {
        if (left.Length != right.Length) return false;
        int difference = 0;
        for (int index = 0; index < left.Length; index++) difference |= left[index] ^ right[index];
        return difference == 0;
    }

    private static void EnsurePayloadDirectoryAcl()
    {
        Directory.CreateDirectory(PayloadDirectory);
        SecurityIdentifier currentUser = WindowsIdentity.GetCurrent().User
            ?? throw new InvalidOperationException("Cannot resolve the current Windows user SID.");
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        security.AddAccessRule(new FileSystemAccessRule(currentUser, FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        Directory.SetAccessControl(PayloadDirectory, security);
    }

    private static void WritePayloadAtomically(string finalPath, byte[] bytes)
    {
        string temporaryPath = $"{finalPath}.{Guid.NewGuid():N}.tmp";
        SecurityIdentifier currentUser = WindowsIdentity.GetCurrent().User
            ?? throw new InvalidOperationException("Cannot resolve the current Windows user SID.");
        var security = new FileSecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        security.AddAccessRule(new FileSystemAccessRule(currentUser, FileSystemRights.FullControl, AccessControlType.Allow));
        try
        {
            using (var stream = new FileStream(temporaryPath, FileMode.CreateNew, FileSystemRights.FullControl,
                FileShare.None, 4096, FileOptions.WriteThrough, security))
            {
                stream.Write(bytes, 0, bytes.Length);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temporaryPath, finalPath);
        }
        catch
        {
            DeleteFile(temporaryPath);
            throw;
        }
    }

    private static void DeleteFile(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
        {
            Debug.WriteLine($"[OlePayloadStore] Cleanup failed operation=delete-file error={ex.GetType().Name}");
        }
    }

    private sealed class PendingPayloadReference
    {
        [JsonPropertyName("schemaVersion")]
        public int SchemaVersion { get; set; }
        [JsonPropertyName("token")]
        public string Token { get; set; } = string.Empty;
        [JsonPropertyName("createdUtcTicks")]
        public long CreatedUtcTicks { get; set; }
        [JsonPropertyName("byteLength")]
        public int ByteLength { get; set; }
        [JsonPropertyName("sha256")]
        public string Sha256 { get; set; } = string.Empty;
    }
}

public sealed class PendingPayloadLease : IDisposable
{
    private Mutex? mutex;
    private readonly string valueName;
    private readonly string token;
    private readonly int pid;
    private readonly uint tid;
    private readonly string formulaId;

    internal PendingPayloadLease(Mutex mutex, string valueName, string token, int pid, uint tid, string formulaId)
    {
        this.mutex = mutex;
        this.valueName = valueName;
        this.token = token;
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
            OleFormulaPendingPayloadStore.DeleteValueAndFile(valueName, token, pid);
            Debug.WriteLine($"[OlePayloadStore] Released pid={pid} tid={tid} formulaId={formulaId}");
        }
        finally
        {
            owned.ReleaseMutex();
            owned.Dispose();
        }
    }
}

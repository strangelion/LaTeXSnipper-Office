using System.IO;
using System.Text.Json;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// DPAPI-based shared secret for Named Pipe handshake.
/// Matches the Rust handshake.rs implementation.
/// </summary>
public static class Handshake
{
    private static string? _cachedSecret;

    private static string SecretPath()
    {
        var dataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "LaTeXSnipper"
        );
        Directory.CreateDirectory(dataDir);
        return Path.Combine(dataDir, "native-office-secret.json");
    }

    /// <summary>
    /// Get or create the shared secret. Returns base64-encoded bytes.
    /// Must match the Desktop-side secret exactly.
    /// </summary>
    public static string GetOrCreateSecret()
    {
        if (_cachedSecret != null) return _cachedSecret;

        var path = SecretPath();

        // Try to load existing
        if (File.Exists(path))
        {
            try
            {
                var json = File.ReadAllText(path);
                var stored = JsonSerializer.Deserialize<StoredSecret>(json);
                if (stored?.SecretB64 != null)
                {
                    _cachedSecret = stored.SecretB64;
                    return _cachedSecret;
                }
            }
            catch { /* Fall through to create new */ }
        }

        // Generate new secret
        var bytes = new byte[32];
        using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create())
        {
            rng.GetBytes(bytes);
        }

        var secret = Convert.ToBase64String(bytes);
        var data = new StoredSecret { SecretB64 = secret };
        File.WriteAllText(path, JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true }));

        _cachedSecret = secret;
        return secret;
    }

    /// <summary>
    /// Verify that a client-provided secret matches ours.
    /// </summary>
    public static bool VerifySecret(string clientSecret)
    {
        try
        {
            return GetOrCreateSecret() == clientSecret;
        }
        catch
        {
            return false;
        }
    }

    private class StoredSecret
    {
        [System.Text.Json.Serialization.JsonPropertyName("secretB64")]
        public string SecretB64 { get; set; } = "";
    }
}

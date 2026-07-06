using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// DPAPI-based shared secret for Named Pipe handshake.
/// Matches the Rust handshake.rs implementation.
///
/// Security model:
/// - Secret is generated using cryptographically secure random (RandomNumberGenerator)
/// - Secret is encrypted with DPAPI before writing to disk
/// - Only the same Windows user can decrypt the secret
/// - Desktop creates the secret, VSTO reads it
/// </summary>
public static class Handshake
{
    private static string _cachedSecret;

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
                var encryptedData = File.ReadAllBytes(path);

                // Try to decrypt with DPAPI first
                try
                {
                    var decrypted = ProtectedData.Unprotect(
                        encryptedData,
                        null,
                        DataProtectionScope.CurrentUser
                    );
                    var json = Encoding.UTF8.GetString(decrypted);
                    var stored = JsonSerializer.Deserialize<StoredSecret>(json);
                    if (stored?.SecretB64 != null)
                    {
                        _cachedSecret = stored.SecretB64;
                        return _cachedSecret;
                    }
                }
                catch
                {
                    // Not DPAPI encrypted, try as plain JSON (migration from old format)
                    var json = Encoding.UTF8.GetString(encryptedData);
                    var stored = JsonSerializer.Deserialize<StoredSecret>(json);
                    if (stored?.SecretB64 != null)
                    {
                        // Re-encrypt with DPAPI
                        SaveSecret(stored.SecretB64);
                        _cachedSecret = stored.SecretB64;
                        return _cachedSecret;
                    }
                }
            }
            catch { /* Fall through to create new */ }
        }

        // Generate new secret using CSPRNG
        var bytes = new byte[32];
        using (var rng = RandomNumberGenerator.Create())
        {
            rng.GetBytes(bytes);
        }

        var secret = Convert.ToBase64String(bytes);
        SaveSecret(secret);

        _cachedSecret = secret;
        return secret;
    }

    /// <summary>
    /// Save secret to disk with DPAPI encryption.
    /// </summary>
    private static void SaveSecret(string secret)
    {
        var path = SecretPath();
        var data = new StoredSecret { SecretB64 = secret };
        var json = JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true });
        var jsonBytes = Encoding.UTF8.GetBytes(json);

        // Encrypt with DPAPI
        var encrypted = ProtectedData.Protect(
            jsonBytes,
            null,
            DataProtectionScope.CurrentUser
        );

        File.WriteAllBytes(path, encrypted);
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
        [JsonPropertyName("secretB64")]
        public string SecretB64 { get; set; } = "";
    }
}

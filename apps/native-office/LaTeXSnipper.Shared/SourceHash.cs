// SourceHash.cs — .NET Framework 4.8 compatible SHA-256 helpers.
//
// .NET Framework 4.8 does not support SHA256.HashData() or
// Convert.ToHexString() (those require .NET 5+). Use classic
// SHA256.Create() + BitConverter/hex builder instead.

#nullable enable
using System.Security.Cryptography;
using System.Text;

namespace LaTeXSnipper.NativeOffice.Shared;

internal static class SourceHash
{
    /// <summary>Compute lowercase hex SHA-256 of a UTF-8 string.</summary>
    public static string Sha256Hex(string value)
    {
        using (var sha = SHA256.Create())
        {
            byte[] input = Encoding.UTF8.GetBytes(value ?? "");
            byte[] hash = sha.ComputeHash(input);
            var sb = new StringBuilder(hash.Length * 2);
            foreach (byte b in hash)
                sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
    }
}

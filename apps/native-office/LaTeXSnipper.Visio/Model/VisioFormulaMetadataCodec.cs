#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.Visio.Model
{
    internal sealed class EncodedVisioMetadata
    {
        public int SchemaVersion { get; set; }
        public int ChunkCount { get; set; }
        public string Sha256 { get; set; } = "";
        public IReadOnlyList<string> Chunks { get; set; } = Array.Empty<string>();
    }

    internal static class VisioFormulaMetadataCodec
    {
        public const int SchemaVersion = 3;
        public const int MaximumPayloadBytes = 256 * 1024;
        public const int MaximumChunks = 64;
        public const int ChunkCharacters = 8192;

        public static EncodedVisioMetadata Encode(string payloadJson)
        {
            if (payloadJson == null) throw new ArgumentNullException(nameof(payloadJson));
            byte[] bytes = new UTF8Encoding(false, true).GetBytes(payloadJson);
            if (bytes.Length == 0) throw new ArgumentException("Metadata payload must not be empty.", nameof(payloadJson));
            if (bytes.Length > MaximumPayloadBytes)
                throw new ArgumentOutOfRangeException(nameof(payloadJson), "Metadata payload exceeds 256 KiB.");

            string encoded = Convert.ToBase64String(bytes);
            var chunks = new List<string>((encoded.Length + ChunkCharacters - 1) / ChunkCharacters);
            for (int offset = 0; offset < encoded.Length; offset += ChunkCharacters)
            {
                chunks.Add(encoded.Substring(offset, Math.Min(ChunkCharacters, encoded.Length - offset)));
            }
            if (chunks.Count == 0 || chunks.Count > MaximumChunks)
                throw new InvalidOperationException("Metadata payload requires too many ShapeSheet chunks.");

            return new EncodedVisioMetadata
            {
                SchemaVersion = SchemaVersion,
                ChunkCount = chunks.Count,
                Sha256 = ComputeSha256(bytes),
                Chunks = chunks
            };
        }

        public static string Decode(int schemaVersion, int chunkCount, string sha256, IReadOnlyList<string> chunks)
        {
            if (schemaVersion != SchemaVersion) throw new InvalidOperationException("Unsupported Visio metadata schema.");
            if (chunkCount <= 0 || chunkCount > MaximumChunks) throw new InvalidOperationException("Invalid Visio metadata chunk count.");
            if (chunks == null || chunks.Count != chunkCount) throw new InvalidOperationException("Visio metadata chunks are incomplete.");
            if (string.IsNullOrWhiteSpace(sha256) || sha256.Length != 64) throw new InvalidOperationException("Invalid Visio metadata checksum.");
            if (chunks.Any(chunk => string.IsNullOrEmpty(chunk) || chunk.Length > ChunkCharacters))
                throw new InvalidOperationException("Visio metadata contains an invalid ShapeSheet chunk.");

            string encoded = string.Concat(chunks);
            byte[] bytes;
            try
            {
                bytes = StrictBase64.Decode(encoded, MaximumPayloadBytes, allowDataUrl: false);
            }
            catch (Exception ex) when (ex is FormatException || ex is InvalidOperationException)
            {
                throw new InvalidOperationException("Visio metadata contains invalid Base64.", ex);
            }
            if (bytes.Length == 0 || bytes.Length > MaximumPayloadBytes) throw new InvalidOperationException("Invalid Visio metadata payload size.");
            if (!FixedTimeEqualsHex(ComputeSha256(bytes), sha256)) throw new InvalidOperationException("Visio metadata checksum mismatch.");

            return new UTF8Encoding(false, true).GetString(bytes);
        }

        public static string QuoteShapeSheetString(string value)
        {
            if (value == null) throw new ArgumentNullException(nameof(value));
            return "\"" + value.Replace("\"", "\"\"") + "\"";
        }

        private static string ComputeSha256(byte[] bytes)
        {
            using (var sha = SHA256.Create())
                return string.Concat(sha.ComputeHash(bytes).Select(b => b.ToString("x2")));
        }

        private static bool FixedTimeEqualsHex(string expected, string actual)
        {
            if (expected.Length != actual.Length) return false;
            int difference = 0;
            for (int i = 0; i < expected.Length; i++)
                difference |= char.ToLowerInvariant(expected[i]) ^ char.ToLowerInvariant(actual[i]);
            return difference == 0;
        }
    }
}

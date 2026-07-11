using System;

namespace LaTeXSnipper.NativeOffice.Shared
{
    public static class StrictBase64
    {
        public const int DefaultMaxDecodedBytes = 64 * 1024 * 1024;

        public static byte[] Decode(string value, int maxDecodedBytes = DefaultMaxDecodedBytes,
            bool allowDataUrl = false, string expectedMediaType = null)
        {
            if (value == null) throw new ArgumentNullException(nameof(value));
            if (maxDecodedBytes < 0) throw new ArgumentOutOfRangeException(nameof(maxDecodedBytes));

            if (value.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
            {
                if (!allowDataUrl) throw new FormatException("Data URLs are not allowed here.");
                int comma = value.IndexOf(',');
                if (comma <= 5) throw new FormatException("Malformed Base64 data URL.");
                string metadata = value.Substring(5, comma - 5);
                string[] parts = metadata.Split(';');
                if (parts.Length < 2 || !string.Equals(parts[parts.Length - 1], "base64", StringComparison.OrdinalIgnoreCase))
                    throw new FormatException("Data URL must use explicit Base64 encoding.");
                if (!string.IsNullOrEmpty(expectedMediaType) &&
                    !string.Equals(parts[0], expectedMediaType, StringComparison.OrdinalIgnoreCase))
                    throw new FormatException("Unexpected data URL media type.");
                value = value.Substring(comma + 1);
            }

            if (value.Length == 0) return Array.Empty<byte>();
            if ((value.Length & 3) != 0) throw new FormatException("Base64 length must be a multiple of four.");
            if ((long)(value.Length / 4) * 3 > (long)maxDecodedBytes + 2)
                throw new InvalidOperationException("Base64 payload exceeds the configured size limit.");

            int padding = value.EndsWith("==", StringComparison.Ordinal) ? 2
                : value.EndsWith("=", StringComparison.Ordinal) ? 1 : 0;
            for (int index = 0; index < value.Length; index++)
            {
                char ch = value[index];
                bool alphabet = ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z' ||
                    ch >= '0' && ch <= '9' || ch == '+' || ch == '/';
                if (!alphabet && !(ch == '=' && index >= value.Length - padding))
                    throw new FormatException("Base64 contains an invalid character or padding position.");
            }

            if (padding == 1 && (Value(value[value.Length - 2]) & 0x03) != 0)
                throw new FormatException("Base64 has non-zero trailing padding bits.");
            if (padding == 2 && (Value(value[value.Length - 3]) & 0x0F) != 0)
                throw new FormatException("Base64 has non-zero trailing padding bits.");

            byte[] decoded = Convert.FromBase64String(value);
            if (decoded.Length > maxDecodedBytes)
                throw new InvalidOperationException("Base64 payload exceeds the configured size limit.");
            return decoded;
        }

        public static bool TryDecode(string value, out byte[] decoded, int maxDecodedBytes = DefaultMaxDecodedBytes,
            bool allowDataUrl = false, string expectedMediaType = null)
        {
            try
            {
                decoded = Decode(value, maxDecodedBytes, allowDataUrl, expectedMediaType);
                return true;
            }
            catch (Exception exception) when (exception is ArgumentException || exception is FormatException ||
                                               exception is InvalidOperationException)
            {
                decoded = null;
                return false;
            }
        }

        private static int Value(char ch)
        {
            if (ch >= 'A' && ch <= 'Z') return ch - 'A';
            if (ch >= 'a' && ch <= 'z') return ch - 'a' + 26;
            if (ch >= '0' && ch <= '9') return ch - '0' + 52;
            if (ch == '+') return 62;
            if (ch == '/') return 63;
            throw new FormatException("Invalid Base64 alphabet character.");
        }
    }
}

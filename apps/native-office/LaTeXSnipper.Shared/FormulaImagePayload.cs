#nullable enable

using System;

namespace LaTeXSnipper.NativeOffice.Shared
{
    public static class FormulaImagePayload
    {
        private static readonly byte[] PngSignature =
        {
            0x89, 0x50, 0x4E, 0x47,
            0x0D, 0x0A, 0x1A, 0x0A
        };

        public static byte[] DecodePng(string encodedPng)
        {
            if (string.IsNullOrWhiteSpace(encodedPng))
            {
                throw new InvalidOperationException(
                    "PNG render payload is empty.");
            }

            byte[] bytes = StrictBase64.Decode(
                encodedPng,
                allowDataUrl: true,
                expectedMediaType: "image/png");

            if (bytes.Length < PngSignature.Length)
            {
                throw new FormatException(
                    "Decoded PNG payload is too short.");
            }

            for (int index = 0;
                 index < PngSignature.Length;
                 index++)
            {
                if (bytes[index] != PngSignature[index])
                {
                    throw new FormatException(
                        "Decoded render payload is not a PNG file.");
                }
            }

            return bytes;
        }
    }
}

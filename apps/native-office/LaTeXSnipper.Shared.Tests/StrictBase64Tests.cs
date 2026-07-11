using System;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class StrictBase64Tests
    {
        internal static int Run()
        {
            int failures = 0;
            failures += ExpectDecode("TWFu", "Man");
            failures += ExpectDecode("TWE=", "Ma");
            failures += ExpectDecode("TQ==", "M");
            failures += ExpectDecode("data:image/png;base64,iVBORw0KGgo=", null, true, "image/png");
            failures += ExpectReject("T WFu");
            failures += ExpectReject("TWFu\r\n");
            failures += ExpectReject("TWFu=");
            failures += ExpectReject("=WFu");
            failures += ExpectReject("TW=Fu");
            failures += ExpectReject("TR==");
            failures += ExpectReject("TWF=");
            failures += ExpectReject("data:text/plain;base64,TQ==", true, "image/png");
            failures += ExpectReject("data:image/png,TQ==", true, "image/png");
            bool oversizedRejected = false;
            try
            {
                StrictBase64.Decode("TWFu", 2);
            }
            catch (InvalidOperationException)
            {
                oversizedRejected = true;
            }
            if (!oversizedRejected)
            {
                failures++;
                Console.Error.WriteLine("FAIL: oversized Base64 was accepted");
            }
            return failures;
        }

        private static int ExpectDecode(string encoded, string expected, bool dataUrl = false, string mediaType = null)
        {
            try
            {
                byte[] decoded = StrictBase64.Decode(encoded, allowDataUrl: dataUrl, expectedMediaType: mediaType);
                if (expected == null || System.Text.Encoding.ASCII.GetString(decoded) == expected) return 0;
                Console.Error.WriteLine("FAIL: decoded Base64 does not match expected text");
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("FAIL: valid Base64 rejected: " + error.Message);
            }
            return 1;
        }

        private static int ExpectReject(string encoded, bool dataUrl = false, string mediaType = null)
        {
            if (!StrictBase64.TryDecode(encoded, out _, allowDataUrl: dataUrl, expectedMediaType: mediaType)) return 0;
            Console.Error.WriteLine("FAIL: invalid Base64 accepted: " + encoded);
            return 1;
        }
    }
}

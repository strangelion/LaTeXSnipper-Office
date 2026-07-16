#nullable enable
using System;
using System.IO;
using System.Text;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.Visio.Host
{
    internal sealed class VisioOwnedTempFile : IDisposable
    {
        private const int MaximumSvgBytes = 8 * 1024 * 1024;
        private readonly string _path;

        private VisioOwnedTempFile(string path) { _path = path; }

        public string Path => _path;

        public static VisioOwnedTempFile FromSvg(string svg)
        {
            if (string.IsNullOrWhiteSpace(svg)) throw new InvalidDataException("SVG payload is empty.");
            byte[] bytes = new UTF8Encoding(false, true).GetBytes(svg);
            if (bytes.Length > MaximumSvgBytes) throw new InvalidDataException("SVG payload exceeds 8 MiB.");
            return Write(bytes, ".svg");
        }

        public static VisioOwnedTempFile FromPng(string png)
        {
            return Write(FormulaImagePayload.DecodePng(png), ".png");
        }

        private static VisioOwnedTempFile Write(byte[] bytes, string extension)
        {
            string root = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "LaTeXSnipper", "NativeOffice", "VisioTemp");
            Directory.CreateDirectory(root);
            Cleanup(root);
            string path = System.IO.Path.Combine(root, "lsv_" + Guid.NewGuid().ToString("N") + extension);
            using (var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                stream.Write(bytes, 0, bytes.Length);
                stream.Flush(true);
            }
            return new VisioOwnedTempFile(path);
        }

        private static void Cleanup(string root)
        {
            DateTime cutoff = DateTime.UtcNow.AddHours(-1);
            foreach (string file in Directory.EnumerateFiles(root, "lsv_*"))
            {
                try { if (File.GetLastWriteTimeUtc(file) < cutoff) File.Delete(file); }
                catch (IOException ex)
                {
                    OfficeOperationLog.Failure("cleanup-stale-temp-file", "visio", null, ex);
                }
                catch (UnauthorizedAccessException ex)
                {
                    OfficeOperationLog.Failure("cleanup-stale-temp-file", "visio", null, ex);
                }
            }
        }

        public void Dispose()
        {
            try { if (File.Exists(_path)) File.Delete(_path); }
            catch (IOException ex)
            {
                OfficeOperationLog.Failure("delete-temp-file", "visio", null, ex);
            }
            catch (UnauthorizedAccessException ex)
            {
                OfficeOperationLog.Failure("delete-temp-file", "visio", null, ex);
            }
        }
    }
}

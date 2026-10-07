#nullable enable
using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

namespace LaTeXSnipper.NativeOffice.Shared;

/// <summary>
/// Bounded class-identity inspection, not a full CFB validator or stream reader.
/// No filesystem access, COM storage creation or OLE activation is performed.
/// </summary>
public static class OleStorageIdentity
{
    public static readonly Guid FormulaClassId = new Guid("B7F5B4AB-5F94-4D87-A29F-9A41D41B3B9F");
    public const int MaxStorageBytes = 8 * 1024 * 1024;
    public const int MaxWordXmlChars = 32 * 1024 * 1024;

    public static Guid? ReadRootClass(byte[]? bytes)
    {
        if (bytes == null || bytes.Length < 512 || bytes.Length > MaxStorageBytes) return null;
        byte[] signature = { 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1 };
        for (int i = 0; i < signature.Length; i++) if (bytes[i] != signature[i]) return null;
        for (int i = 8; i < 24; i++) if (bytes[i] != 0) return null;
        for (int i = 34; i < 40; i++) if (bytes[i] != 0) return null;
        int version = BitConverter.ToUInt16(bytes, 26), shift = BitConverter.ToUInt16(bytes, 30);
        if (BitConverter.ToUInt16(bytes, 28) != 0xfffe || BitConverter.ToUInt16(bytes, 32) != 6 ||
            !((version == 3 && shift == 9) || (version == 4 && shift == 12))) return null;
        int sectorSize = 1 << shift;
        if (bytes.Length < sectorSize * 3 || bytes.Length % sectorSize != 0 ||
            (version == 3 && BitConverter.ToUInt32(bytes, 40) != 0)) return null;
        uint directory = BitConverter.ToUInt32(bytes, 48);
        long offset = ((long)directory + 1) * sectorSize;
        if (offset < sectorSize || offset + sectorSize > bytes.Length) return null;
        int root = (int)offset;
        if (bytes[root + 66] != 5 || BitConverter.ToUInt16(bytes, root + 64) != 22 ||
            Encoding.Unicode.GetString(bytes, root, 22) != "Root Entry\0") return null;
        var classBytes = new byte[16];
        Array.Copy(bytes, root + 80, classBytes, 0, classBytes.Length);
        return new Guid(classBytes);
    }

    /// <summary>
    /// Accept only a one-object Word range Flat OPC export. Resolve the exact
    /// document relationship, rejecting duplicates, links and ambiguous objects.
    /// </summary>
    public static Guid? ReadSelectedWordStorageClass(string? xml)
    {
        if (string.IsNullOrEmpty(xml) || xml.Length > MaxWordXmlChars) return null;
        try
        {
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = null, MaxCharactersInDocument = MaxWordXmlChars };
            using (var input = new StringReader(xml))
            using (var reader = XmlReader.Create(input, settings))
            {
                int events = 0;
                while (reader.Read()) if (reader.Depth > 64 || ++events > 100000) return null;
            }
            XDocument package;
            using (var input = new StringReader(xml))
            using (var reader = XmlReader.Create(input, settings)) package = XDocument.Load(reader);
            XNamespace pkg = "http://schemas.microsoft.com/office/2006/xmlPackage";
            XNamespace o = "urn:schemas-microsoft-com:office:office";
            XNamespace r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
            XNamespace rel = "http://schemas.openxmlformats.org/package/2006/relationships";
            if (package.Root?.Name != pkg + "package") return null;
            var parts = package.Root.Elements(pkg + "part").ToArray();
            if (parts.Length > 128 || parts.GroupBy(part => (string?)part.Attribute(pkg + "name"))
                .Any(group => group.Count() != 1)) return null;
            var document = parts.SingleOrDefault(part => (string?)part.Attribute(pkg + "name") == "/word/document.xml");
            var objects = document?.Element(pkg + "xmlData")?.Descendants(o + "OLEObject").ToArray();
            if (objects == null || objects.Length != 1 || (string?)objects[0].Attribute("Type") != "Embed") return null;
            string? id = (string?)objects[0].Attribute(r + "id");
            if (string.IsNullOrEmpty(id)) return null;
            var relationships = parts.SingleOrDefault(part => (string?)part.Attribute(pkg + "name") == "/word/_rels/document.xml.rels")
                ?.Element(pkg + "xmlData")?.Element(rel + "Relationships")?.Elements(rel + "Relationship")
                .Where(item => (string?)item.Attribute("Id") == id).ToArray();
            if (relationships == null || relationships.Length != 1) return null;
            var relationship = relationships[0];
            if ((string?)relationship.Attribute("Type") != r.NamespaceName + "/oleObject" ||
                relationship.Attribute("TargetMode") != null) return null;
            string? target = (string?)relationship.Attribute("Target");
            if (target == null || !Regex.IsMatch(target, @"\Aembeddings/[A-Za-z0-9_.-]+\.bin\z")) return null;
            var binary = parts.SingleOrDefault(part => (string?)part.Attribute(pkg + "name") == "/word/" + target);
            if ((string?)binary?.Attribute(pkg + "contentType") != "application/vnd.openxmlformats-officedocument.oleObject") return null;
            var data = binary?.Elements(pkg + "binaryData").ToArray();
            if (data == null || data.Length != 1 || data[0].HasElements) return null;
            // Word wraps Base64 lines; only XML whitespace may be removed.
            string raw = data[0].Value;
            int limit = ((MaxStorageBytes + 2) / 3) * 4;
            var compact = new StringBuilder(Math.Min(raw.Length, limit));
            foreach (char ch in raw)
            {
                if (ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n') continue;
                if (compact.Length >= limit) return null;
                compact.Append(ch);
            }
            return StrictBase64.TryDecode(compact.ToString(), out byte[] bytes, MaxStorageBytes) ? ReadRootClass(bytes) : null;
        }
        catch (Exception exception) when (exception is XmlException || exception is InvalidOperationException ||
            exception is ArgumentException || exception is FormatException) { return null; }
    }
}

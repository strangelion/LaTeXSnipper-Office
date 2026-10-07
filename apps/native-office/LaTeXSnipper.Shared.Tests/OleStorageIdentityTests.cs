using System;
using System.Linq;
using System.Text;
using LaTeXSnipper.NativeOffice.Shared;

namespace LaTeXSnipper.NativeOffice.Shared.Tests
{
    internal static class OleStorageIdentityTests
    {
        private static int Expect(bool value, string message)
        {
            if (value) return 0;
            Console.Error.WriteLine("FAIL: " + message); return 1;
        }

        // Authored identity framing only; not a complete valid CFB stream tree.
        private static byte[] Storage(int version, Guid classId)
        {
            int sector = version == 3 ? 512 : 4096;
            var bytes = new byte[sector * 3];
            byte[] signature = { 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1 };
            Array.Copy(signature, bytes, signature.Length);
            bytes[26] = (byte)version; bytes[28] = 0xfe; bytes[29] = 0xff;
            bytes[30] = (byte)(version == 3 ? 9 : 12); bytes[32] = 6; bytes[48] = 1;
            Array.Copy(Encoding.Unicode.GetBytes("Root Entry\0"), 0, bytes, sector * 2, 22);
            bytes[sector * 2 + 64] = 22; bytes[sector * 2 + 66] = 5;
            Array.Copy(classId.ToByteArray(), 0, bytes, sector * 2 + 80, 16);
            return bytes;
        }

        private static string Package(byte[] bytes)
        {
            return "<pkg:package xmlns:pkg='http://schemas.microsoft.com/office/2006/xmlPackage' " +
                "xmlns:o='urn:schemas-microsoft-com:office:office' " +
                "xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'>" +
                "<pkg:part pkg:name='/word/document.xml'><pkg:xmlData><o:OLEObject Type='Embed' r:id='r1'/></pkg:xmlData></pkg:part>" +
                "<pkg:part pkg:name='/word/_rels/document.xml.rels'><pkg:xmlData>" +
                "<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>" +
                "<Relationship Id='r1' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject' Target='embeddings/oleObject1.bin'/>" +
                "</Relationships></pkg:xmlData></pkg:part>" +
                "<pkg:part pkg:name='/word/embeddings/oleObject1.bin' pkg:contentType='application/vnd.openxmlformats-officedocument.oleObject'>" +
                "<pkg:binaryData>\n" + Convert.ToBase64String(bytes) + "\n</pkg:binaryData></pkg:part></pkg:package>";
        }

        internal static int Run()
        {
            int failures = 0;
            foreach (int version in new[] { 3, 4 })
            {
                var bytes = Storage(version, OleStorageIdentity.FormulaClassId);
                var before = bytes.ToArray();
                failures += Expect(OleStorageIdentity.ReadRootClass(bytes) == OleStorageIdentity.FormulaClassId, "CFB identity version rejected");
                failures += Expect(before.SequenceEqual(bytes), "CFB identity inspection mutated input");
                failures += Expect(OleStorageIdentity.ReadSelectedWordStorageClass(Package(bytes)) == OleStorageIdentity.FormulaClassId, "Scoped Flat OPC relationship failed");
            }
            var valid = Storage(3, OleStorageIdentity.FormulaClassId);
            foreach (int offset in new[] { 0, 8, 28, 30, 32, 34, 40, 1024, 1088, 1090 })
            {
                var broken = valid.ToArray(); broken[offset] ^= 0x80;
                failures += Expect(OleStorageIdentity.ReadRootClass(broken) == null, "Malformed CFB identity accepted");
            }
            var badPointer = valid.ToArray(); Array.Copy(BitConverter.GetBytes(uint.MaxValue), 0, badPointer, 48, 4);
            failures += Expect(OleStorageIdentity.ReadRootClass(badPointer) == null, "CFB pointer exceeded bounds");
            failures += Expect(OleStorageIdentity.ReadRootClass(valid.Take(valid.Length - 1).ToArray()) == null, "Truncated sector accepted");
            failures += Expect(OleStorageIdentity.ReadRootClass(new byte[OleStorageIdentity.MaxStorageBytes + 1]) == null, "Storage budget not enforced");
            string xml = Package(valid);
            foreach (string broken in new[] {
                xml.Replace("Type='Embed'", "Type='Link'"),
                xml.Replace("Target='", "TargetMode='External' Target='"),
                xml.Replace("embeddings/oleObject1.bin'", "https://invalid.example/ole.bin'"),
                xml.Replace("embeddings/oleObject1.bin'", "embeddings/../ole.bin'"),
                xml.Replace("r:id='r1'", "r:id='missing'"),
                xml.Replace("<o:OLEObject Type='Embed' r:id='r1'/>", "<o:OLEObject Type='Embed' r:id='r1'/><o:OLEObject Type='Embed' r:id='r1'/>"),
                xml.Replace("<pkg:binaryData>", "<pkg:binaryData>*"),
                "<!DOCTYPE package [<!ENTITY x SYSTEM 'file:///unavailable'>]>" + xml,
                xml.Replace("</pkg:package>", "<bad></pkg:package>") })
                failures += Expect(OleStorageIdentity.ReadSelectedWordStorageClass(broken) == null, "Ambiguous/external/malformed package accepted");
            string duplicateRel = "<Relationship Id='r1' Type='anything' Target='embeddings/oleObject1.bin'/>";
            failures += Expect(OleStorageIdentity.ReadSelectedWordStorageClass(xml.Replace("</Relationships>", duplicateRel + "</Relationships>")) == null, "Duplicate relationship accepted");
            failures += Expect(OleStorageIdentity.ReadSelectedWordStorageClass(new string('x', OleStorageIdentity.MaxWordXmlChars + 1)) == null, "Word XML budget not enforced");
            var foreign = new Guid("0003000C-0000-0000-C000-000000000046");
            failures += Expect(OleStorageIdentity.ReadSelectedWordStorageClass(Package(Storage(3, foreign))) == foreign, "Foreign class diagnostic lost identity");
            return failures;
        }
    }
}

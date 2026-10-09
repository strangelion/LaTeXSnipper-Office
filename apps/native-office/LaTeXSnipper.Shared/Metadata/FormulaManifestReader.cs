#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;

namespace LaTeXSnipper.NativeOffice.Shared.Metadata
{
    public static class FormulaManifestReader
    {
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        public static Dictionary<string, FormulaPayload> ReadAll(string? xml)
        {
            var result = new Dictionary<string, FormulaPayload>(StringComparer.Ordinal);
            if (xml == null) return result;
            var root = FormulaManifestReplacement.ParseRoot(xml);
            var counts = root.Elements().Where(value => value.Attribute("id") != null)
                .GroupBy(value => (string)value.Attribute("id")!, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);
            foreach (var entry in root.Elements("formula"))
            {
                string id = (string?)entry.Attribute("id") ?? "";
                ValidateId(id);
                if (counts[id] != 1)
                    throw new InvalidOperationException("MANIFEST_ENTRY_AMBIGUOUS");
                result.Add(id, Decode(entry, id));
            }
            return result;
        }

        public static FormulaPayload? Read(string? xml, string formulaId)
        {
            ValidateId(formulaId);
            if (xml == null) return null;
            var root = FormulaManifestReplacement.ParseRoot(xml);
            var entries = root.Elements().Where(value => (string?)value.Attribute("id") == formulaId).ToList();
            if (entries.Count > 1 || entries.Any(value => value.Name != XName.Get("formula")))
                throw new InvalidOperationException("MANIFEST_ENTRY_AMBIGUOUS");
            return entries.Count == 0 ? null : Decode(entries[0], formulaId);
        }

        private static FormulaPayload Decode(XElement entry, string id)
        {
            var payloads = entry.Elements("payload").ToList();
            if (payloads.Count > 1) throw new InvalidOperationException("MANIFEST_PAYLOAD_AMBIGUOUS");
            if (payloads.Count == 1)
            {
                string json = Utf8.GetString(StrictBase64.Decode(payloads[0].Value, 24 * 1024 * 1024));
                using (var document = JsonDocument.Parse(json))
                {
                    if (document.RootElement.ValueKind != JsonValueKind.Object)
                        throw new InvalidOperationException("MANIFEST_PAYLOAD_INVALID");
                    var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var field in document.RootElement.EnumerateObject())
                        if (!names.Add(field.Name)) throw new InvalidOperationException("MANIFEST_PAYLOAD_FIELD_AMBIGUOUS");
                }
                var payload = JsonSerializer.Deserialize<FormulaPayload>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (payload == null || payload.FormulaId != id)
                    throw new InvalidOperationException("MANIFEST_PAYLOAD_ID_MISMATCH");
                return payload;
            }
            // Only truly absent payloads use the documented legacy projection.
            // A corrupt/empty/mismatched payload must never become a fake entry.
            var omml = entry.Element("omml");
            return new FormulaPayload { FormulaId = id, Latex = entry.Element("latex")?.Value ?? "",
                Display = entry.Element("display")?.Value ?? "inline", Revision = (int?)entry.Attribute("revision") ?? 0,
                StorageMode = (string?)entry.Attribute("storageMode"), SchemaVersion = (int?)entry.Attribute("schemaVersion") ?? 3,
                Omml = omml == null ? "" : Utf8.GetString(StrictBase64.Decode(omml.Value, 24 * 1024 * 1024)) };
        }

        private static void ValidateId(string id)
        {
            if (string.IsNullOrWhiteSpace(id) || id.Length > 256)
                throw new InvalidOperationException("MANIFEST_PAYLOAD_ID_INVALID");
        }
    }
}

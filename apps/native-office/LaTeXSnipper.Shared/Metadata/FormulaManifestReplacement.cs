#nullable enable
using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Xml;
using System.Xml.Linq;
using Office = Microsoft.Office.Core;
using InteropWord = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.NativeOffice.Shared.Metadata
{
    public interface IFormulaManifestReplacementStore : IDisposable
    {
        string? ReadOriginal();
        void AddReplacement(string xml);
        string ReadReplacement();
        void CommitReplacement();
        bool RollbackReplacement();
    }

    /// <summary>Whole-manifest replacement with explicit failure propagation.</summary>
    public static class FormulaManifestReplacement
    {
        public const int MaximumCharacters = 32 * 1024 * 1024;
        internal const string NamespaceUri = "urn:latexsnipper:office:objects:v3";

        public static void Write(IFormulaManifestReplacementStore store, FormulaPayload payload)
        {
            if (store == null) throw new ArgumentNullException(nameof(store));
            if (payload == null || string.IsNullOrWhiteSpace(payload.FormulaId) || payload.FormulaId.Length > 256)
                throw new InvalidOperationException("MANIFEST_PAYLOAD_ID_INVALID");
            string? original = store.ReadOriginal();
            var root = original == null ? new XElement(XName.Get("manifest", NamespaceUri)) : Parse(original);
            if (root.Name != XName.Get("manifest", NamespaceUri))
                throw new InvalidOperationException("MANIFEST_ROOT_INVALID");
            var matching = root.Elements().Where(entry => (string?)entry.Attribute("id") == payload.FormulaId).ToList();
            if (matching.Count > 1 || matching.Any(entry => entry.Name != XName.Get("formula")))
                throw new InvalidOperationException("MANIFEST_ENTRY_AMBIGUOUS");
            var added = FormulaDocumentManifest.BuildWordEntryElement(payload);
            if (string.IsNullOrEmpty(added.Element("payload")?.Value))
                throw new InvalidOperationException("MANIFEST_SERIALIZATION_FAILED");
            matching.SingleOrDefault()?.Remove();
            root.Add(added);
            string xml = root.ToString(SaveOptions.DisableFormatting);
            if (xml.Length > MaximumCharacters) throw new InvalidOperationException("MANIFEST_BUDGET_EXCEEDED");
            try
            {
                store.AddReplacement(xml);
                if (!Equivalent(xml, store.ReadReplacement()))
                    throw new InvalidOperationException("MANIFEST_READBACK_MISMATCH");
                store.CommitReplacement();
            }
            catch (Exception error)
            {
                bool restored = false;
                try { restored = store.RollbackReplacement(); }
                catch (Exception cleanup) { OfficeOperationLog.Failure("rollback-word-manifest", "word", payload.FormulaId, cleanup); }
                if (!restored)
                    throw new InvalidOperationException("MANIFEST_STATE_UNCERTAIN: replacement was not proven rolled back; no automatic retry.", error);
                throw;
            }
        }

        internal static bool Equivalent(string expected, string actual)
        {
            try { return XNode.DeepEquals(Parse(expected), Parse(actual)); }
            catch (XmlException) { return false; }
        }

        private static XElement Parse(string xml)
        {
            if (string.IsNullOrEmpty(xml) || xml.Length > MaximumCharacters)
                throw new XmlException("Manifest XML size invalid.");
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null,
                MaxCharactersInDocument = MaximumCharacters };
            using (var reader = XmlReader.Create(new StringReader(xml), settings))
                while (reader.Read()) if (reader.Depth > 64) throw new XmlException("Manifest XML depth exceeded.");
            XElement root;
            using (var reader = XmlReader.Create(new StringReader(xml), settings)) root = XElement.Load(reader, LoadOptions.PreserveWhitespace);
            // Preserve namespace bindings, including aliases used by QName
            // strings inside unknown extension content or attributes.
            return root;
        }
    }

    internal sealed class WordManifestReplacementStore : IFormulaManifestReplacementStore
    {
        private readonly InteropWord.Document _document;
        private Office.CustomXMLPart? _original;
        private Office.CustomXMLPart? _replacement;
        private string? _originalId;
        private string? _originalXml;
        private string? _replacementXml;
        private bool _commitStarted;
        private bool _addAttempted;
        public WordManifestReplacementStore(InteropWord.Document document) { _document = document; }

        public string? ReadOriginal()
        {
            Office.CustomXMLParts? parts = null, matches = null;
            try
            {
                parts = _document.CustomXMLParts;
                matches = parts.SelectByNamespace(FormulaManifestReplacement.NamespaceUri);
                if (matches.Count > 1) throw new InvalidOperationException("MANIFEST_PART_AMBIGUOUS");
                if (matches.Count == 0) return null;
                _original = matches[1]; _originalId = _original.Id;
                return _originalXml = _original.XML;
            }
            finally { Release(matches); Release(parts); }
        }

        public void AddReplacement(string xml)
        {
            _replacementXml = xml;
            _addAttempted = true;
            Office.CustomXMLParts? parts = null;
            try { parts = _document.CustomXMLParts; _replacement = parts.Add(xml); }
            finally { Release(parts); }
        }
        public string ReadReplacement() => _replacement?.XML ?? "";

        public void CommitReplacement()
        {
            if (!AttachedAndUnchanged()) throw new InvalidOperationException("MANIFEST_CHANGED_BEFORE_COMMIT");
            _commitStarted = true;
            _original?.Delete();
            Office.CustomXMLParts? parts = null, matches = null;
            Office.CustomXMLPart? current = null;
            try
            {
                parts = _document.CustomXMLParts;
                matches = parts.SelectByNamespace(FormulaManifestReplacement.NamespaceUri);
                if (matches.Count != 1) throw new InvalidOperationException("MANIFEST_COMMIT_UNVERIFIED");
                current = matches[1];
                if (_replacement == null || current.Id != _replacement.Id ||
                    !FormulaManifestReplacement.Equivalent(_replacementXml!, current.XML))
                    throw new InvalidOperationException("MANIFEST_COMMIT_UNVERIFIED");
            }
            finally { Release(current); Release(matches); Release(parts); }
        }

        public bool RollbackReplacement()
        {
            // A Delete call may mutate then throw. Never erase the only remaining
            // valid payload after commit began, or guess an unreturned Add result.
            if (_commitStarted || (_addAttempted && _replacement == null)) return false;
            if (_replacement == null) return true;
            if (!AttachedAndUnchanged()) return false;
            _replacement.Delete();
            return true;
        }

        private bool AttachedAndUnchanged()
        {
            Office.CustomXMLParts? parts = null, matches = null;
            try
            {
                parts = _document.CustomXMLParts;
                matches = parts.SelectByNamespace(FormulaManifestReplacement.NamespaceUri);
                if (_replacement == null || matches.Count != (_original == null ? 1 : 2)) return false;
                bool oldFound = _original == null, newFound = false;
                for (int index = 1; index <= matches.Count; index++)
                {
                    Office.CustomXMLPart? part = null;
                    try
                    {
                        part = matches[index];
                        if (part.Id == _originalId && part.XML == _originalXml) oldFound = true;
                        if (part.Id == _replacement.Id && FormulaManifestReplacement.Equivalent(_replacementXml!, part.XML)) newFound = true;
                    }
                    finally { Release(part); }
                }
                return oldFound && newFound;
            }
            finally { Release(matches); Release(parts); }
        }

        public void Dispose()
        {
            try { Release(_replacement); } finally { Release(_original); }
        }
        private static void Release(object? value)
        {
            if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value);
        }
    }
}

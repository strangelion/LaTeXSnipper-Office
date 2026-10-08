#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Xml;
using System.Xml.Linq;
using Office = Microsoft.Office.Core;
using Word = Microsoft.Office.Interop.Word;

namespace LaTeXSnipper.NativeOffice.Shared.Metadata
{
    // A narrow store seam for fault tests; production uses the bound Word part.
    public interface IFormulaManifestAppendStore : IDisposable
    {
        bool Contains(string formulaId);
        string AppendAndRead(string formulaId, string entryXml);
        bool RemoveIfMatches(string formulaId, string expectedEntryXml);
    }

    /// <summary>New native-inline entries only, committed and read back per item.</summary>
    public sealed class FormulaManifestAppendSession : IDisposable
    {
        public const int MaximumEntries = 10000;
        public const int MaximumEntryCharacters = 2 * 1024 * 1024;
        public const int MaximumWrittenBytes = 16 * 1024 * 1024;
        private readonly object _document;
        private readonly IFormulaManifestAppendStore _store;
        private readonly int _thread = Thread.CurrentThread.ManagedThreadId;
        private readonly Dictionary<string, string> _owned = new(StringComparer.Ordinal);
        private bool _disposed;
        private bool _faulted;
        private int _attempts;
        private long _writtenBytes;

        public FormulaManifestAppendSession(object document, IFormulaManifestAppendStore store)
        {
            _document = document ?? throw new ArgumentNullException(nameof(document));
            _store = store ?? throw new ArgumentNullException(nameof(store));
        }

        public void WriteNew(object document, FormulaPayload payload)
        {
            CheckContext(document);
            if (_faulted) throw new InvalidOperationException("BATCH_MANIFEST_SESSION_FAULTED");
            if (payload == null || !FormulaIdHelper.IsCanonical(payload.FormulaId) ||
                payload.Revision != 0 || payload.StorageMode != "native-omml" || payload.Display != "inline" ||
                (payload.ContentKind != null && payload.ContentKind != "formula"))
                throw new InvalidOperationException("BATCH_MANIFEST_PAYLOAD_INVALID");
            var entry = FormulaDocumentManifest.BuildWordEntryElement(payload);
            if (string.IsNullOrEmpty(entry.Element("payload")?.Value))
                throw new InvalidOperationException("BATCH_MANIFEST_SERIALIZATION_FAILED");
            string xml = entry.ToString(SaveOptions.DisableFormatting);
            long bytes = Encoding.UTF8.GetByteCount(xml);
            if (_attempts >= MaximumEntries || xml.Length > MaximumEntryCharacters ||
                _writtenBytes + bytes > MaximumWrittenBytes)
                throw new InvalidOperationException("BATCH_MANIFEST_BUDGET_EXCEEDED");
            if (_owned.ContainsKey(payload.FormulaId) || _store.Contains(payload.FormulaId))
                throw new InvalidOperationException("BATCH_MANIFEST_ID_EXISTS");

            _attempts++;
            _writtenBytes += bytes;
            // Record ownership before calling COM: Append may mutate then throw.
            _owned.Add(payload.FormulaId, xml);
            try
            {
                string readBack = _store.AppendAndRead(payload.FormulaId, xml);
                if (!EntryMatches(xml, readBack))
                    throw new InvalidOperationException("BATCH_MANIFEST_READBACK_MISMATCH");
            }
            catch
            {
                _faulted = true;
                try { RemoveCreated(document, payload.FormulaId); }
                catch (Exception cleanup) { OfficeOperationLog.Failure("batch-manifest-cleanup", "word", payload.FormulaId, cleanup); }
                throw;
            }
        }

        // Never remove a pre-existing or subsequently changed entry.
        public void RemoveCreated(object document, string formulaId)
        {
            CheckContext(document);
            if (_owned.TryGetValue(formulaId, out string expected) && _store.RemoveIfMatches(formulaId, expected))
                _owned.Remove(formulaId);
        }

        private void CheckContext(object document)
        {
            if (_disposed) throw new ObjectDisposedException(nameof(FormulaManifestAppendSession));
            if (_thread != Thread.CurrentThread.ManagedThreadId || !ReferenceEquals(_document, document))
                throw new InvalidOperationException("BATCH_MANIFEST_CONTEXT_CHANGED");
        }

        public void Dispose()
        {
            if (_disposed) return;
            CheckContext(_document);
            _disposed = true;
            try { _store.Dispose(); }
            finally { _owned.Clear(); }
        }

        internal static bool EntryMatches(string expected, string actual)
        {
            if (string.IsNullOrEmpty(actual) || actual.Length > MaximumEntryCharacters) return false;
            try { return XNode.DeepEquals(ParseEntry(expected), ParseEntry(actual)); }
            catch (XmlException) { return false; }
        }

        private static XElement ParseEntry(string xml)
        {
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null,
                MaxCharactersInDocument = MaximumEntryCharacters };
            using (var reader = XmlReader.Create(new StringReader(xml), settings))
                while (reader.Read()) if (reader.Depth > 64) throw new XmlException("Manifest entry depth exceeded.");
            XElement entry;
            using (var reader = XmlReader.Create(new StringReader(xml), settings)) entry = XElement.Load(reader);
            // Word may add in-scope namespace declarations to a node's XML.
            foreach (var node in entry.DescendantsAndSelf())
                node.Attributes().Where(attribute => attribute.IsNamespaceDeclaration).Remove();
            return entry;
        }
    }

    public static partial class FormulaDocumentManifest
    {
        public static FormulaManifestAppendSession OpenWordAppendSession(Word.Document document) =>
            new(document, new WordAppendStore(document));

        private sealed class WordAppendStore : IFormulaManifestAppendStore
        {
            private readonly Word.Document _document;
            private Office.CustomXMLPart? _part;
            private string? _partId;
            private Office.CustomXMLNode? _root;

            public WordAppendStore(Word.Document document) { _document = document; }

            private void EnsurePart()
            {
                Office.CustomXMLParts? parts = null;
                Office.CustomXMLParts? matches = null;
                Office.CustomXMLPart? current = null;
                try
                {
                    parts = _document.CustomXMLParts;
                    matches = parts.SelectByNamespace(NamespaceUri);
                    if (matches.Count > 1) throw new InvalidOperationException("BATCH_MANIFEST_PART_AMBIGUOUS");
                    if (_part == null)
                    {
                        _part = matches.Count == 0
                            ? parts.Add($"<lsno:manifest xmlns:lsno=\"{NamespaceUri}\" />") : matches[1];
                        _partId = _part.Id;
                    }
                    else
                    {
                        if (matches.Count != 1) throw new InvalidOperationException("BATCH_MANIFEST_PART_CHANGED");
                        current = matches[1];
                        if (current.Id != _partId) throw new InvalidOperationException("BATCH_MANIFEST_PART_CHANGED");
                    }
                    // Obtain the attached root rather than treating a cached
                    // DOM node as evidence of current document storage.
                    var root = _part.DocumentElement;
                    try
                    {
                        if (root.BaseName != "manifest" || root.NamespaceURI != NamespaceUri)
                            throw new InvalidOperationException("BATCH_MANIFEST_ROOT_INVALID");
                    }
                    catch { Release(root); throw; }
                    Release(_root); _root = root;
                }
                finally { Release(current); Release(matches); Release(parts); }
            }

            public bool Contains(string formulaId)
            {
                EnsurePart();
                Office.CustomXMLNode? node = null;
                // Legacy readers inspect IDs on every direct child, including
                // unknown extensions. Such IDs must not be shadowed either.
                try { node = _root!.SelectSingleNode($"./*[@id='{formulaId}']"); return node != null; }
                finally { Release(node); }
            }

            public string AppendAndRead(string formulaId, string entryXml)
            {
                // Contains just bound and checked this root. Checking again
                // before Append adds duplicate COM calls, but cannot make the
                // operation atomic. The post-append live-part gate is required.
                _root!.AppendChildSubtree(entryXml);
                // Read from the currently attached part, after possible Word
                // callbacks. A cached LastChild is not persistence evidence.
                EnsurePart();
                Office.CustomXMLNodes? nodes = null;
                Office.CustomXMLNode? node = null;
                try
                {
                    nodes = _root!.SelectNodes($"./*[@id='{formulaId}']");
                    if (nodes.Count != 1) return "";
                    node = nodes[1]; return node.XML;
                }
                finally { Release(node); Release(nodes); }
            }

            public bool RemoveIfMatches(string formulaId, string expectedEntryXml)
            {
                EnsurePart();
                Office.CustomXMLNodes? nodes = null;
                Office.CustomXMLNode? node = null;
                try
                {
                    nodes = _root!.SelectNodes($"./*[@id='{formulaId}']");
                    if (nodes.Count == 0) return true;
                    if (nodes.Count != 1) return false;
                    node = nodes[1];
                    if (!FormulaManifestAppendSession.EntryMatches(expectedEntryXml, node.XML)) return false;
                    node.Delete();
                    return true;
                }
                finally { Release(node); Release(nodes); }
            }

            public void Dispose()
            {
                var root = _root; var part = _part;
                _root = null; _part = null; _partId = null;
                try { Release(root); } finally { Release(part); }
            }

            private static void Release(object? value)
            {
                if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value);
            }
        }
    }
}

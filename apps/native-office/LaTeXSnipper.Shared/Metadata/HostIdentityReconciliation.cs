#nullable enable
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Runtime.InteropServices;
using Microsoft.Office.Core;

namespace LaTeXSnipper.NativeOffice.Shared.Metadata
{
    public sealed class HostIdentityReconciliationException : InvalidOperationException
    {
        public string ErrorCode { get; }
        public HostIdentityReconciliationException(string code, Exception inner) : base(code + ": " + inner.Message, inner) { ErrorCode = code; }
    }

    /// <summary>Adopt only a captured selected object; never rewrite its original sibling entry.</summary>
    public static class HostIdentityReconciliation
    {
        public static T FindOwner<T>(object value) where T : class
        {
            object parent = ((dynamic)value).Parent;
            for (int depth = 0; depth < 16; depth++)
            {
                if (parent is T owner) return owner;
                object next;
                try { next = ((dynamic)parent).Parent; }
                finally { if (Marshal.IsComObject(parent)) Marshal.ReleaseComObject(parent); }
                parent = next;
            }
            if (Marshal.IsComObject(parent)) Marshal.ReleaseComObject(parent);
            throw new HostIdentityReconciliationException("HOST_IDENTITY_OWNER_UNAVAILABLE", new InvalidOperationException("No bounded host owner was found."));
        }

        public static FormulaPayload ReadLegacyReference(CustomXMLParts parts, string reference, string? namedId)
        {
            try
            {
                string id = ParseLegacyReferenceId(reference, namedId);
                var entries = FormulaDocumentManifest.ReadAllEntries(parts);
                if (entries.TryGetValue(id, out var payload)) return payload;
                throw new HostIdentityReconciliationException("HOST_IDENTITY_SOURCE_UNAVAILABLE", new InvalidOperationException("Legacy reference has no manifest source payload."));
            }
            catch (HostIdentityReconciliationException) { throw; }
            catch (Exception error) { throw new HostIdentityReconciliationException("HOST_IDENTITY_SOURCE_UNAVAILABLE", error); }
        }

        public static string ParseLegacyReferenceId(string reference, string? namedId)
        {
            if (reference == null || reference.Length > 4096 || !reference.StartsWith("LSNO:v3:", StringComparison.Ordinal))
                throw new HostIdentityReconciliationException("HOST_IDENTITY_REFERENCE_INVALID", new InvalidOperationException("Legacy reference prefix or size is invalid."));
            string? id = null;
            foreach (string field in reference.Substring("LSNO:v3:".Length).Split(';'))
                if (field.StartsWith("id=", StringComparison.Ordinal))
                {
                    if (id != null) throw new HostIdentityReconciliationException("HOST_IDENTITY_REFERENCE_INVALID", new InvalidOperationException("Legacy reference contains repeated identity fields."));
                    id = field.Substring(3);
                }
            if (!FormulaIdHelper.IsCanonical(id ?? "") || FormulaIdHelper.IsCanonical(namedId ?? "") && namedId != id)
                throw new HostIdentityReconciliationException("HOST_IDENTITY_REFERENCE_INVALID", new InvalidOperationException("Legacy reference identity is not unambiguous."));
            return id!;
        }

        public static FormulaPayload ReconcileShape(CustomXMLParts parts, object value, FormulaPayload selected, string host,
            string documentContext, bool readOnly, Func<Dictionary<string, FormulaPayload>, string, int> countObjects, object? automation)
        {
            dynamic shape = value;
            string mode = HostPictureSnapshot.IsPicture(value) ? "image" : "ole";
            HostPictureSnapshot snapshot;
            try { snapshot = HostPictureSnapshot.Capture(value, host == "excel", string.IsNullOrEmpty(selected.FormulaId) ? null : selected.FormulaId); }
            catch (Exception error) { throw new HostIdentityReconciliationException("HOST_IDENTITY_RECONCILE_FAILED", error); }
            var originalPayload = Clone(selected);
            FormulaPayload? attempted = null;
            bool NativeMatches(FormulaPayload expected)
            {
                if (automation == null) return true;
                string? json = OleFormulaInterop.GetPayloadJson((dynamic)automation);
                var actual = string.IsNullOrEmpty(json) ? null : JsonSerializer.Deserialize<FormulaPayload>(json,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                return actual != null && JsonSerializer.Serialize(actual) == JsonSerializer.Serialize(expected);
            }
            using (var store = FormulaDocumentManifest.OpenReplacementStore(parts))
                return Reconcile(store, selected, host, mode, documentContext, readOnly || mode == "ole" && automation == null, countObjects,
                    () => snapshot.Matches(value) && NativeMatches(originalPayload), metadata => {
                        attempted = metadata;
                        shape.Name = "LSNO_" + metadata.FormulaId;
                        shape.AlternativeText = OleFormulaInterop.CreateHostMetadataJson(metadata, mode);
                        if (automation != null && !OleFormulaInterop.ReplacePayloadJson((dynamic)automation, metadata))
                            throw new InvalidOperationException("HOST_IDENTITY_OLE_WRITE_UNVERIFIED");
                    }, metadata => snapshot.MatchesLayout(value) && shape.Name == "LSNO_" + metadata.FormulaId &&
                        shape.AlternativeText == OleFormulaInterop.CreateHostMetadataJson(metadata, mode) && NativeMatches(metadata), () => {
                        if (!snapshot.MatchesLayout(value)) return false;
                        string name = shape.Name, text = shape.AlternativeText ?? "";
                        if (attempted == null || (name != snapshot.OriginalName && name != "LSNO_" + attempted.FormulaId) ||
                            (text != snapshot.OriginalAlternativeText && text != OleFormulaInterop.CreateHostMetadataJson(attempted, mode)) ||
                            (!NativeMatches(originalPayload) && !NativeMatches(attempted))) return false;
                        if (automation != null && !OleFormulaInterop.ReplacePayloadJson((dynamic)automation, originalPayload)) return false;
                        shape.Name = snapshot.OriginalName; shape.AlternativeText = snapshot.OriginalAlternativeText;
                        return snapshot.Matches(value) && NativeMatches(originalPayload);
                    });
        }

        public static FormulaPayload Reconcile(IFormulaManifestReplacementStore store, FormulaPayload selected, string host,
            string actualMode, string documentContext, bool readOnly,
            Func<Dictionary<string, FormulaPayload>, string, int> countObjects,
            Func<bool> originalUnchanged, Action<FormulaPayload> writeIdentity, Func<FormulaPayload, bool> verifyIdentity,
            Func<bool> restoreIdentity, Func<string>? newId = null)
        {
            bool added = false, mutationStarted = false, commitStarted = false;
            try
            {
                if (host != "excel" && host != "powerpoint" && host != "word" ||
                    actualMode != "image" && actualMode != "ole" && !(host == "word" && actualMode == "native-omml"))
                    throw new InvalidOperationException("HOST_IDENTITY_HOST_OR_MODE_INVALID");
                string? original = store.ReadOriginal();
                var entries = FormulaManifestReader.ReadAll(original);
                string oldId = selected.FormulaId;
                var metadata = Clone(selected); metadata.StorageMode = actualMode;
                bool hadEntry = entries.TryGetValue(oldId, out var stored);
                // Compact host metadata intentionally omits binary render. Only
                // hydrate it from a record whose complete compact source matches.
                bool sourceMatches = stored != null && OleFormulaInterop.CreateHostMetadataJson(stored, actualMode) ==
                    OleFormulaInterop.CreateHostMetadataJson(selected, actualMode);
                if (sourceMatches) metadata = Clone(stored!);
                metadata.StorageMode = actualMode;
                var knownEntries = new Dictionary<string, FormulaPayload>(entries, StringComparer.Ordinal);
                if (!string.IsNullOrEmpty(oldId) && !knownEntries.ContainsKey(oldId)) knownEntries.Add(oldId, selected);
                int oldCount = string.IsNullOrEmpty(oldId) ? 0 : countObjects(knownEntries, oldId);
                bool reassign = !FormulaIdHelper.IsCanonical(oldId) || oldCount > 1 || !hadEntry;
                if (!string.IsNullOrEmpty(oldId) && oldCount == 0) throw new InvalidOperationException("HOST_IDENTITY_TARGET_NOT_IN_DOCUMENT");
                if (!originalUnchanged() || !store.IsOriginalUnchanged()) throw new InvalidOperationException("HOST_IDENTITY_TARGET_CHANGED");
                if (!reassign && hadEntry)
                {
                    if (!sourceMatches) throw new InvalidOperationException("HOST_IDENTITY_SOURCE_CONFLICT");
                    return metadata;
                }
                if (readOnly) throw new InvalidOperationException("HOST_IDENTITY_DOCUMENT_READ_ONLY");
                if (reassign)
                {
                    metadata.FormulaId = (newId ?? FormulaIdHelper.NewId)();
                    if (!FormulaIdHelper.IsCanonical(metadata.FormulaId) || entries.ContainsKey(metadata.FormulaId) ||
                        countObjects(knownEntries, metadata.FormulaId) != 0) throw new InvalidOperationException("HOST_IDENTITY_NEW_ID_CONFLICT");
                    metadata.Revision = 0;
                    metadata.CreatedUtcTicks = DateTime.UtcNow.Ticks;
                }
                metadata.Host = host; metadata.DocumentContext = documentContext;
                string xml = FormulaManifestReplacement.BuildReplacementFromXml(original, metadata, host);
                added = true; store.AddReplacement(xml);
                if (!FormulaManifestReplacement.Equivalent(xml, store.ReadReplacement()) || !store.IsPreparedUnchanged() || !originalUnchanged())
                    throw new InvalidOperationException("HOST_IDENTITY_PREPARED_STATE_CHANGED");
                if (countObjects(knownEntries, metadata.FormulaId) != 0 ||
                    (!string.IsNullOrEmpty(oldId) && countObjects(knownEntries, oldId) != oldCount))
                    throw new InvalidOperationException("HOST_IDENTITY_INVENTORY_CHANGED");
                mutationStarted = true;
                writeIdentity(metadata);
                if (!verifyIdentity(metadata) || countObjects(knownEntries, metadata.FormulaId) != 1 ||
                    (reassign && !string.IsNullOrEmpty(oldId) && countObjects(knownEntries, oldId) != oldCount - 1))
                    throw new InvalidOperationException("HOST_IDENTITY_READBACK_UNVERIFIED");
                if (!store.IsPreparedUnchanged()) throw new InvalidOperationException("HOST_IDENTITY_MANIFEST_CHANGED");
                commitStarted = true; store.CommitReplacement();
                return metadata;
            }
            catch (Exception error)
            {
                bool uncertain = commitStarted;
                if (!uncertain && mutationStarted)
                {
                    try { uncertain = !restoreIdentity() || !originalUnchanged(); }
                    catch (Exception cleanup) { uncertain = true; OfficeOperationLog.Failure("restore-copied-identity", host, selected.FormulaId, cleanup); }
                }
                if (!uncertain && added)
                {
                    try { uncertain = !store.RollbackReplacement(); }
                    catch (Exception cleanup) { uncertain = true; OfficeOperationLog.Failure("rollback-copied-manifest", host, selected.FormulaId, cleanup); }
                }
                string code = uncertain ? "HOST_IDENTITY_STATE_UNCERTAIN" : "HOST_IDENTITY_RECONCILE_FAILED";
                OfficeOperationLog.Failure(code, host, selected.FormulaId, error);
                throw new HostIdentityReconciliationException(code, error);
            }
        }

        private static FormulaPayload Clone(FormulaPayload value) => JsonSerializer.Deserialize<FormulaPayload>(JsonSerializer.Serialize(value))
            ?? throw new InvalidOperationException("HOST_IDENTITY_SERIALIZATION_FAILED");
    }
}

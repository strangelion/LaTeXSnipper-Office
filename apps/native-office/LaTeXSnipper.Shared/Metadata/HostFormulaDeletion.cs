#nullable enable
using System;
using System.Runtime.InteropServices;
using Office = Microsoft.Office.Core;

namespace LaTeXSnipper.NativeOffice.Shared.Metadata
{
    public sealed class HostDeletionResult
    {
        public bool Success { get; set; }
        public string? ErrorCode { get; set; }
        public string? Error { get; set; }
    }

    public static class HostFormulaDeletion
    {
        public static HostDeletionResult DeleteShape(Office.CustomXMLParts parts, object shapes, string formulaId, string host,
            Func<object, bool> matches, Func<bool> uniqueDocumentTarget)
        {
            object? original = null;
            try
            {
                if (string.IsNullOrWhiteSpace(formulaId) || !uniqueDocumentTarget() || HostPictureSnapshot.CountTargets(shapes, matches) != 1)
                    throw new InvalidOperationException("HOST_DELETE_TARGET_AMBIGUOUS_OR_MISSING");
                dynamic collection = shapes;
                for (int index = 1; index <= collection.Count; index++)
                {
                    object value = collection.Item(index);
                    if (matches(value)) { original = value; break; }
                    Marshal.ReleaseComObject(value);
                }
                var target = original ?? throw new InvalidOperationException("HOST_DELETE_TARGET_MISSING");
                var snapshot = HostPictureSnapshot.Capture(target, host == "excel", expectedFormulaId: formulaId);
                using (var store = FormulaDocumentManifest.OpenReplacementStore(parts))
                    return Delete(store, formulaId, host,
                        () => snapshot.Matches(target) && uniqueDocumentTarget() && HostPictureSnapshot.CountTargets(shapes, matches) == 1,
                        () => HostPictureSnapshot.DeleteAndVerify(target, shapes));
            }
            catch (Exception error) { return new HostDeletionResult { ErrorCode = "HOST_DELETE_FAILED", Error = error.Message }; }
            finally { if (original != null) Marshal.ReleaseComObject(original); }
        }

        public static HostDeletionResult Delete(IFormulaManifestReplacementStore store, string formulaId, string host,
            Func<bool> originalUnchanged, Action deleteAndVerify)
        {
            bool added = false, deletionStarted = false;
            try
            {
                string? xml = FormulaManifestReplacement.BuildRemoval(store, formulaId, host);
                if (!originalUnchanged()) throw new InvalidOperationException("HOST_DELETE_TARGET_CHANGED");
                if (xml != null)
                {
                    added = true;
                    store.AddReplacement(xml);
                    if (!FormulaManifestReplacement.Equivalent(xml, store.ReadReplacement()))
                        throw new InvalidOperationException("MANIFEST_READBACK_MISMATCH");
                }
                if (!originalUnchanged() || !(added ? store.IsPreparedUnchanged() : store.IsOriginalUnchanged()))
                    throw new InvalidOperationException("HOST_DELETE_STATE_CHANGED");
                deletionStarted = true;
                deleteAndVerify();
                if (added) store.CommitReplacement();
                else if (!store.IsOriginalUnchanged()) throw new InvalidOperationException("MANIFEST_CHANGED_AFTER_DELETE");
                return new HostDeletionResult { Success = true };
            }
            catch (Exception error)
            {
                bool uncertain = deletionStarted;
                if (!uncertain && added)
                {
                    try { uncertain = !store.RollbackReplacement(); }
                    catch (Exception cleanup) { uncertain = true; OfficeOperationLog.Failure("rollback-deletion-manifest", host, formulaId, cleanup); }
                }
                var result = new HostDeletionResult { ErrorCode = uncertain ? "HOST_DELETE_STATE_UNCERTAIN" : "HOST_DELETE_FAILED",
                    Error = error.Message };
                OfficeOperationLog.Failure(result.ErrorCode!, host, formulaId, error);
                return result;
            }
        }
    }
}

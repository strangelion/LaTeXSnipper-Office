#nullable enable
using System;
using System.Text.Json;

namespace LaTeXSnipper.NativeOffice.Shared.Metadata
{
    public sealed class HostImageReplacementResult
    {
        public bool Success { get; set; }
        public string ActualStorageMode { get; set; } = "image";
        public string? ErrorCode { get; set; }
        public string? Error { get; set; }
    }

    /// <summary>Stage a verified image and manifest before the irreversible old-object deletion.</summary>
    public static class HostImageReplacement
    {
        public static HostImageReplacementResult Replace<T>(string formulaId, FormulaPayload payload, string host,
            IFormulaManifestReplacementStore manifest, Func<T> createCandidate,
            Action<T, FormulaPayload> prepareCandidate, Action<T> verifyCandidate,
            Func<bool> originalUnchanged, Action deleteOriginal, Action<T> promoteCandidate,
            Action<T> deleteCandidate) where T : class
        {
            T? candidate = null;
            bool createStarted = false, addStarted = false, deleteStarted = false;
            try
            {
                if (payload == null || string.IsNullOrWhiteSpace(formulaId) || payload.FormulaId != formulaId ||
                    (host != "excel" && host != "powerpoint"))
                    throw new InvalidOperationException("HOST_IMAGE_REPLACE_ID_OR_HOST_INVALID");
                var metadata = JsonSerializer.Deserialize<FormulaPayload>(JsonSerializer.Serialize(payload))
                    ?? throw new InvalidOperationException("HOST_IMAGE_REPLACE_SERIALIZATION_FAILED");
                metadata.StorageMode = "image";
                // Reject bad/ambiguous manifests before creating any picture.
                string xml = FormulaManifestReplacement.BuildReplacement(manifest, metadata, host);
                if (!originalUnchanged()) throw new InvalidOperationException("HOST_IMAGE_REPLACE_ORIGINAL_CHANGED");
                createStarted = true;
                candidate = createCandidate() ?? throw new InvalidOperationException("HOST_IMAGE_REPLACE_CANDIDATE_MISSING");
                prepareCandidate(candidate, metadata);
                verifyCandidate(candidate);
                if (!originalUnchanged()) throw new InvalidOperationException("HOST_IMAGE_REPLACE_ORIGINAL_CHANGED");
                addStarted = true;
                manifest.AddReplacement(xml);
                if (!FormulaManifestReplacement.Equivalent(xml, manifest.ReadReplacement()))
                    throw new InvalidOperationException("MANIFEST_READBACK_MISMATCH");
                verifyCandidate(candidate);
                if (!originalUnchanged()) throw new InvalidOperationException("HOST_IMAGE_REPLACE_ORIGINAL_CHANGED");
                if (!manifest.IsPreparedUnchanged()) throw new InvalidOperationException("MANIFEST_CHANGED_BEFORE_IMAGE_COMMIT");
                // COM may mutate and then throw. Once Delete is issued, retain
                // the candidate and both payloads on error; never blind-retry.
                deleteStarted = true;
                deleteOriginal();
                promoteCandidate(candidate);
                verifyCandidate(candidate);
                manifest.CommitReplacement();
                return new HostImageReplacementResult { Success = true };
            }
            catch (Exception error)
            {
                bool uncertain = deleteStarted || (createStarted && candidate == null);
                if (!uncertain && addStarted)
                {
                    try { uncertain = !manifest.RollbackReplacement(); }
                    catch (Exception cleanup)
                    {
                        uncertain = true;
                        OfficeOperationLog.Failure("rollback-image-manifest", host, formulaId, cleanup);
                    }
                }
                var result = new HostImageReplacementResult { Error = error.Message,
                    ErrorCode = uncertain ? "HOST_IMAGE_REPLACE_STATE_UNCERTAIN" : "HOST_IMAGE_REPLACE_FAILED" };
                if (!uncertain && candidate != null)
                {
                    try { deleteCandidate(candidate); }
                    catch (Exception cleanup)
                    {
                        result.ErrorCode = "HOST_IMAGE_REPLACE_ROLLBACK_UNVERIFIED";
                        OfficeOperationLog.Failure("rollback-image-candidate", host, formulaId, cleanup);
                    }
                }
                OfficeOperationLog.Failure(result.ErrorCode!, host, formulaId, error);
                return result;
            }
        }
    }
}

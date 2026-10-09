#nullable enable
using System;
using System.Text.Json;

namespace LaTeXSnipper.NativeOffice.Shared.Metadata
{
    /// <summary>Commit metadata before a new shape insertion may report success.</summary>
    public sealed class HostManifestFailure
    {
        public string ErrorCode { get; set; } = "HOST_MANIFEST_WRITE_FAILED";
        public string Error { get; set; } = "";
    }

    public static class HostManifestInsertion
    {
        public static HostManifestFailure? Commit(string formulaId, FormulaPayload payload, string host,
            string actualStorageMode, Action<FormulaPayload> persist, Action rollbackCandidate)
        {
            try
            {
                if (formulaId != payload.FormulaId || string.IsNullOrEmpty(formulaId) ||
                    (actualStorageMode != "ole" && actualStorageMode != "image"))
                    throw new InvalidOperationException("HOST_MANIFEST_INSERT_ID_OR_MODE_INVALID");
                // Keep the complete source/render payload, but do not mutate the
                // caller's requested route when auto falls back to an image.
                var metadata = JsonSerializer.Deserialize<FormulaPayload>(JsonSerializer.Serialize(payload))
                    ?? throw new InvalidOperationException("HOST_MANIFEST_SERIALIZATION_FAILED");
                metadata.StorageMode = actualStorageMode;
                persist(metadata);
                return null;
            }
            catch (Exception failure)
            {
                var result = new HostManifestFailure { Error = failure.Message };
                OfficeOperationLog.Failure("commit-insertion-manifest", host, payload.FormulaId, failure);
                try { rollbackCandidate(); }
                catch (Exception cleanup)
                {
                    result.ErrorCode = "HOST_MANIFEST_ROLLBACK_UNVERIFIED";
                    result.Error += "; candidate cleanup could not be verified.";
                    OfficeOperationLog.Failure("rollback-insertion-manifest", host, payload.FormulaId, cleanup);
                }
                return result;
            }
        }

        public static bool IsFailure(string? errorCode) =>
            errorCode?.StartsWith("HOST_MANIFEST_", StringComparison.Ordinal) == true;
    }
}

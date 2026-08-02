const ALLOWED_SOURCES = new Set([
  "user",
  "parser-divergence",
  "office-readback",
  "ole",
  "runtime",
  "drawing",
]);

export function createFailureCandidate(input) {
  if (!ALLOWED_SOURCES.has(input.source)) {
    throw new Error("FAILURE_CORPUS_SOURCE_INVALID");
  }
  if (!/^[a-f0-9]{64}$/.test(input.inputHash || "")) {
    throw new Error("FAILURE_CORPUS_INPUT_HASH_INVALID");
  }
  if (input.rawUserData != null) {
    throw new Error("FAILURE_CORPUS_RAW_USER_DATA_FORBIDDEN");
  }
  return {
    schemaVersion: 1,
    candidateId: input.candidateId,
    source: input.source,
    inputHash: input.inputHash,
    inputType: input.inputType,
    sanitizedInputRef: input.sanitizedInputRef || null,
    expectedRef: input.expectedRef || null,
    actualRef: input.actualRef || null,
    coreCommit: input.coreCommit,
    officeCommit: input.officeCommit,
    provider: input.provider || null,
    model: input.model || null,
    host: input.host || null,
    diagnostics: [...(input.diagnostics || [])],
    firstStructuralDivergence: input.firstStructuralDivergence || null,
    drawing: input.drawing || null,
    privacy: {
      containsRawUserData: false,
      redistributable: input.privacy?.redistributable === true,
    },
    promotion: "candidate",
  };
}

export function canPromoteCandidate(candidate, approval) {
  return (
    candidate?.privacy?.containsRawUserData === false &&
    candidate?.privacy?.redistributable === true &&
    approval?.humanApproved === true &&
    approval?.licenseConfirmed === true &&
    Boolean(candidate.sanitizedInputRef)
  );
}

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL(
    "../src/features/recognition/auto-insert-decision.js",
    import.meta.url,
  ),
  "utf8",
);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { decideAutoInsert } = await import(moduleUrl);

const valid = {
  userEnabled: true,
  protocolRequested: true,
  targetSessionId: "word-session",
  targetHost: "word",
  expectedDocumentContext: "doc-1",
  currentDocumentContext: "doc-1",
  output: "E=mc^2",
  acceptance: {
    technicallyValid: true,
    qualityStatus: "validated",
    confidence: 0.97,
    parseValid: true,
    structureValid: true,
    reviewRequired: false,
    recommendedAction: "autoAccept",
    reasons: [],
  },
};

assert.equal(decideAutoInsert(valid).allowed, true);
assert.equal(
  decideAutoInsert({ ...valid, userEnabled: undefined }).allowed,
  false,
);
assert.ok(
  decideAutoInsert({
    ...valid,
    currentDocumentContext: "doc-2",
  }).reasons.includes("DOCUMENT_CONTEXT_CHANGED"),
);
assert.ok(
  decideAutoInsert({
    ...valid,
    acceptance: { ...valid.acceptance, qualityStatus: "experimental" },
  }).reasons.includes("MODEL_QUALITY_EXPERIMENTAL"),
);
assert.ok(
  decideAutoInsert({
    ...valid,
    acceptance: {
      ...valid.acceptance,
      reviewRequired: true,
      reasons: ["POSTPROCESS_REVIEW_REQUIRED"],
    },
  }).reasons.includes("POSTPROCESS_REVIEW_REQUIRED"),
);

console.log("Auto-insert quality gate contracts passed OK");

import { strict as assert } from "node:assert";
import {
  canPromoteCandidate,
  createFailureCandidate,
} from "../src/features/failure-corpus/candidate.js";

const candidate = createFailureCandidate({
  candidateId: "candidate-1",
  source: "office-readback",
  inputHash: "a".repeat(64),
  inputType: "omml",
  sanitizedInputRef: "quality/failure-corpus/inbox/minimal.xml",
  coreCommit: "core",
  officeCommit: "office",
  privacy: { redistributable: false },
});
assert.equal(candidate.privacy.containsRawUserData, false);
assert.equal(canPromoteCandidate(candidate, { humanApproved: true }), false);
assert.throws(
  () => createFailureCandidate({ ...candidate, rawUserData: "private" }),
  /RAW_USER_DATA_FORBIDDEN/,
);

console.log("Office failure-corpus privacy contract passed OK");

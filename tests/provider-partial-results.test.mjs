import { strict as assert } from "node:assert";
import {
  benchmarkLabel,
  collectProviderValidations,
} from "../src/features/recognition/provider-validation.js";

const results = await collectProviderValidations(
  ["CPU", "DirectML", "CUDA"],
  async (provider) => {
    if (provider === "DirectML") throw new Error("DML_SESSION_FAILED");
    if (provider === "CUDA") throw new Error("CUDA_UNSUPPORTED");
    return { provider, validationLevel: "smokeInferencePassed" };
  },
  "smokeInference",
);
assert.deepEqual(
  results.map(({ provider, status }) => [provider, status]),
  [
    ["CPU", "passed"],
    ["DirectML", "failed"],
    ["CUDA", "unsupported"],
  ],
);
assert.equal(benchmarkLabel({ benchmarkMeasured: true }), "基准已测量");
assert.equal(
  benchmarkLabel({ benchmarkMeasured: true, benchmarkValidated: true }),
  "基准证据不完整",
);
assert.equal(
  benchmarkLabel({
    benchmarkValidated: true,
    thresholdVersion: "v1",
    datasetSha256: "a".repeat(64),
    evidenceSha256: "b".repeat(64),
  }),
  "基准已验证",
);

console.log("Provider partial-result and benchmark-label contracts passed OK");

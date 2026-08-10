import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { shouldPresentRecognitionResult } from "../src/features/recognition/result-selection.js";

test("only the selected/latest recognition job may replace the visible result", () => {
  assert.equal(shouldPresentRecognitionResult("job-new", "job-old"), false);
  assert.equal(shouldPresentRecognitionResult("job-new", "job-new"), true);
  assert.equal(shouldPresentRecognitionResult(null, "job-restored"), true);
  assert.equal(shouldPresentRecognitionResult("job-new", null), false);
});

test("all recognition entry points use the shared controller", () => {
  const source = readFileSync("src/main.js", "utf8");
  const imageStartIndex = source.indexOf("async selectImageFile()");
  const pdfStartIndex = source.indexOf(
    "async selectPdfFile()",
    imageStartIndex,
  );
  const recognitionSettingsIndex = source.indexOf(
    "openRecognitionSettings()",
    pdfStartIndex,
  );
  const imageStart = source.slice(imageStartIndex, pdfStartIndex);
  const pdfStart = source.slice(pdfStartIndex, recognitionSettingsIndex);
  assert.match(imageStart, /controller\.startJob/);
  assert.match(pdfStart, /controller\.startJob/);
  assert.doesNotMatch(imageStart, /invoke\("recognition_start"/);
  assert.doesNotMatch(pdfStart, /invoke\("recognition_start"/);
});

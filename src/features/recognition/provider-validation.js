export async function collectProviderValidations(providers, validate, policy) {
  const settled = await Promise.allSettled(
    providers.map((provider) => validate(provider, policy)),
  );
  return settled.map((entry, index) => {
    const provider = providers[index];
    if (entry.status === "fulfilled") {
      return { provider, status: "passed", report: entry.value, reason: null };
    }
    const reason = entry.reason?.message || String(entry.reason);
    const unsupported = /UNSUPPORTED|UNAVAILABLE|NOT_SUPPORTED/i.test(reason);
    return {
      provider,
      status: unsupported ? "unsupported" : "failed",
      report: {
        provider,
        validationLevel: "declared",
        stale: false,
        diagnostics: [reason],
      },
      reason,
    };
  });
}

export function benchmarkLabel(report) {
  if (report?.benchmarkValidated === true) {
    const completeEvidence =
      report.thresholdVersion && report.datasetSha256 && report.evidenceSha256;
    return completeEvidence ? "基准已验证" : "基准证据不完整";
  }
  return report?.benchmarkMeasured === true ? "基准已测量" : "未测量";
}

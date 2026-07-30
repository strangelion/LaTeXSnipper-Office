import { layeredCapability, unsupported } from "../capabilities.js";

export function nativeOleCapability({ os, runtimeState } = {}) {
  if (os !== "windows") {
    return unsupported("Native COM/OLE is Windows-only.");
  }
  const status = runtimeState?.nativeOle;
  const registered =
    status?.registered === true && status?.currentDllMatches === true;
  const healthy =
    status?.available === true &&
    status?.bitnessMatch === true &&
    status?.geometryContract === true &&
    status?.inkIntegrity === true;
  return layeredCapability({
    staticSupported: true,
    installedBackend: status ? registered : undefined,
    runtimeHealthy: status ? healthy : undefined,
    backend: "native-com-ole",
    message: status
      ? `handler=${status.handlerVersion || "unknown"}; registered=${registered}; bitnessMatch=${status.bitnessMatch === true}; geometryContract=${status.geometryContract === true}; inkIntegrity=${status.inkIntegrity === true}`
      : "Native OLE requires live registry, bitness, handler, geometry, and ink-integrity diagnostics.",
    nextAction: healthy
      ? undefined
      : "Run Native Office OLE validation or repair.",
  });
}

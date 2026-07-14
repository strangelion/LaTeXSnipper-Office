declare const Office: any;

export type OfficeHostName = "word" | "excel" | "powerpoint" | "unknown";

export function detectOfficeHost(): OfficeHostName {
  const host = String(Office?.context?.host ?? "").toLowerCase();
  if (host.includes("word")) return "word";
  if (host.includes("excel")) return "excel";
  if (host.includes("powerpoint")) return "powerpoint";
  return "unknown";
}

export function isRequirementSetSupported(name: string, version: string): boolean {
  try {
    return Boolean(Office?.context?.requirements?.isSetSupported?.(name, version));
  } catch {
    return false;
  }
}

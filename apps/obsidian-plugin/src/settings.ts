export const DEFAULT_BRIDGE_URL = "http://127.0.0.1:19877";
export const SETTINGS_SCHEMA_VERSION = 2;

const LEGACY_BRIDGE_URLS = new Set([
  "http://127.0.0.1:28765",
  "http://localhost:28765",
  "http://127.0.0.1:28766",
  "http://localhost:28766",
  "http://127.0.0.1:19876",
  "http://localhost:19876",
]);

export interface LaTeXSnipperSettings {
  bridgeUrl: string;
  defaultDisplay: "inline" | "block";
  autoNumber: boolean;
  numberFormat: "global" | "chapter" | "chapter-hyphen";
}

export interface PersistedPluginData extends LaTeXSnipperSettings {
  schemaVersion: number;
  equationCounter: number;
  ecosystemClientId: string;
}

export function normalizeBridgeUrl(value: unknown): string {
  const normalized =
    typeof value === "string"
      ? value.trim().replace(/\/+$/, "")
      : "";

  if (!normalized) return DEFAULT_BRIDGE_URL;

  if (LEGACY_BRIDGE_URLS.has(normalized.toLowerCase())) {
    return DEFAULT_BRIDGE_URL;
  }

  return normalized;
}

export function migratePluginData(
  raw: Partial<PersistedPluginData> | null | undefined,
): PersistedPluginData {
  const numberFormat = raw?.numberFormat;
  const validNumberFormats = ["global", "chapter", "chapter-hyphen"];

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    bridgeUrl: normalizeBridgeUrl(raw?.bridgeUrl),
    defaultDisplay:
      raw?.defaultDisplay === "block" ? "block" : "inline",
    autoNumber: raw?.autoNumber === true,
    numberFormat:
      numberFormat && validNumberFormats.includes(numberFormat)
        ? numberFormat
        : "global",
    equationCounter:
      typeof raw?.equationCounter === "number"
        ? raw.equationCounter
        : 0,
    ecosystemClientId:
      typeof raw?.ecosystemClientId === "string" &&
      raw.ecosystemClientId.trim()
        ? raw.ecosystemClientId
        : `obsidian-${crypto.randomUUID()}`,
  };
}

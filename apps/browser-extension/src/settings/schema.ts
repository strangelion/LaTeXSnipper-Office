import type { MessageRole } from "../providers/types";

export type ReadScopeMode =
  | "selection-only"
  | "current-message"
  | "current-assistant-message"
  | "visible-conversation"
  | "loaded-conversation"
  | "last-n-messages"
  | "selected-message-range"
  | "custom-container"
  | "formula-only";
export interface ExtractionLimits {
  maxMessages: number;
  maxCharacters: number;
  maxFormulas: number;
  maxCodeBytes: number;
  maxTableCells: number;
  maxDomNodes: number;
  contextCharacters: number;
}
export interface ContentFilters {
  text: boolean;
  markdown: boolean;
  formulas: boolean;
  renderedMath: boolean;
  code: boolean;
  tables: boolean;
  lists: boolean;
  links: boolean;
  imageAlt: boolean;
  attachmentLabels: boolean;
}
export interface SelectorProfile {
  conversationRoots: string[];
  messages: string[];
  userMessages: string[];
  assistantMessages: string[];
  content: string[];
  formulaIncludes: string[];
  excludes: string[];
  composers: string[];
}
export interface SiteSettings {
  enabled: boolean;
  persistentPermission: boolean;
  scope: ReadScopeMode;
  roles: MessageRole[];
  filters: ContentFilters;
  lastN: number;
  selectors?: SelectorProfile;
}
export interface BrowserSettings {
  schemaVersion: 1;
  locale: "auto" | "en" | "zh_CN" | "zh_TW";
  defaultScope: ReadScopeMode;
  roles: MessageRole[];
  filters: ContentFilters;
  limits: ExtractionLimits;
  formulaConfidence: number;
  sites: Record<string, SiteSettings>;
  retention: "transient";
}

export const HARD_LIMITS: ExtractionLimits = {
  maxMessages: 500,
  maxCharacters: 2 * 1024 * 1024,
  maxFormulas: 500,
  maxCodeBytes: 2 * 1024 * 1024,
  maxTableCells: 10_000,
  maxDomNodes: 50_000,
  contextCharacters: 512,
};
export function validateSelector(selector: string): string {
  const value = selector.trim();
  if (!value || value.length > 512) throw new Error("INVALID_SELECTOR_LENGTH");
  if (/javascript:|<|>|\beval\b|\bfunction\b/i.test(value))
    throw new Error("UNSAFE_SELECTOR");
  try {
    document.createDocumentFragment().querySelector(value);
  } catch {
    throw new Error("INVALID_SELECTOR_SYNTAX");
  }
  if (/input\s*\[?[^\]]*(password|token|secret|private)/i.test(value))
    throw new Error("SENSITIVE_SELECTOR");
  return value;
}

export function validateSettings(input: BrowserSettings): BrowserSettings {
  if (input.schemaVersion !== 1) throw new Error("UNSUPPORTED_SETTINGS_SCHEMA");
  for (const key of Object.keys(HARD_LIMITS) as Array<keyof ExtractionLimits>) {
    if (
      !Number.isFinite(input.limits[key]) ||
      input.limits[key] < 1 ||
      input.limits[key] > HARD_LIMITS[key]
    )
      throw new Error(`INVALID_LIMIT_${key}`);
  }
  for (const site of Object.values(input.sites)) {
    if (site.lastN < 1 || site.lastN > 500) throw new Error("INVALID_LAST_N");
    if (site.selectors)
      for (const selectors of Object.values(site.selectors))
        selectors.forEach(validateSelector);
  }
  return input;
}

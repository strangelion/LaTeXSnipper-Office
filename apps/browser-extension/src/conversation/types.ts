import type { FormulaCandidate } from "../formulas/types";
import type { ExtractionDiagnostic, MessageRole, ProviderId } from "../providers/types";
import type { ReadScopeMode } from "../settings/schema";

export interface ReadScopeSnapshot { mode: ReadScopeMode; roles: MessageRole[]; messageIds: string[]; explicitUserConfirmation: boolean; }
export interface TruncationInfo { reason: string; originalCount: number; returnedCount: number; }
export type InlineRun = { type: "text" | "bold" | "italic" | "code" | "link" | "formula"; text?: string; href?: string; formula?: FormulaCandidate };
export type ConversationImportBlock =
  | { type: "paragraph" | "heading" | "quote" | "link-paragraph" | "attachment-label"; level?: number; runs: InlineRun[] }
  | { type: "list"; ordered: boolean; level: number; items: InlineRun[][] }
  | { type: "formula"; formula: FormulaCandidate; originalNumberLabel?: string }
  | { type: "code"; language?: string; text: string }
  | { type: "table"; rows: string[][]; headerRows: number; columnCount: number }
  | { type: "horizontal-rule" };
export interface ConversationImportMessage { id: string; role: MessageRole; sequence: number; language?: string; blocks: ConversationImportBlock[]; }
export interface ConversationImportDocument {
  schemaVersion: 1; importId: string; provider: ProviderId; providerAdapterVersion: string;
  sourceUrl: string; sourceTitle?: string; sourceLanguage?: string; extractedAt: string;
  scope: ReadScopeSnapshot; messages: ConversationImportMessage[]; truncated: boolean;
  truncation?: TruncationInfo; diagnostics: ExtractionDiagnostic[];
}
export interface FormulaImportPayload { schemaVersion: 1; formulas: FormulaCandidate[]; scope: ReadScopeSnapshot; truncated: boolean; }
export interface BrowserImportAction {
  schemaVersion: 1; actionType: "ImportWebFormula" | "ImportConversationSelection";
  origin: "browser"; target: "desktop";
  source: { browser: "chrome" | "firefox"; provider?: ProviderId; pageUrl: string; pageTitle?: string };
  payload: FormulaImportPayload | ConversationImportDocument;
}

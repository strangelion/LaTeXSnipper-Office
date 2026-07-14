import type { FormulaCandidate } from "../formulas/types";

export type ProviderId =
  | "chatgpt" | "gemini" | "deepseek" | "claude" | "copilot"
  | "perplexity" | "grok" | "kimi" | "doubao" | "qwen"
  | "yuanbao" | "wenxin" | "zhipu" | "generic";
export type MessageRole = "user" | "assistant" | "system-visible" | "tool-visible" | "unknown";
export type ProviderMaturity = "supported" | "limited" | "domChanged" | "permissionRequired" | "notDetected";

export interface ProviderCapabilities {
  maturity: ProviderMaturity;
  readSelection: boolean;
  readCurrentMessage: boolean;
  readVisibleConversation: boolean;
  readLoadedConversation: boolean;
  extractFormulas: boolean;
  extractCode: boolean;
  extractTables: boolean;
  insertIntoComposer: boolean;
  streamObservation: boolean;
}

export interface ExtractionDiagnostic { code: string; strategy?: string; message: string; }
export interface ExtractedContentBlock { type: "paragraph" | "heading" | "list" | "blockquote" | "formula" | "code" | "table" | "link-group" | "attachment-label" | "unknown"; text: string; }
export interface ExtractedCodeBlock { language?: string; code: string; }
export interface ExtractedTable { rows: string[][]; }
export interface ExtractedLink { label: string; href: string; }
export interface ExtractedMessage {
  id: string;
  providerMessageId?: string;
  role: MessageRole;
  sequence: number;
  visible: boolean;
  language?: string;
  text: string;
  markdown?: string;
  blocks: ExtractedContentBlock[];
  formulas: FormulaCandidate[];
  codeBlocks: ExtractedCodeBlock[];
  tables: ExtractedTable[];
  links: ExtractedLink[];
  elementFingerprint?: string;
}

export interface ExtractionContext { pageUrl: string; sequence: number; }
export interface EditableTarget { element: HTMLElement; kind: string; }
export interface Disposable { dispose(): void; }
export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly displayNameKey: string;
  readonly hostPatterns: readonly string[];
  readonly version: string;
  readonly verifiedLive: boolean;
  matches(location: Location | URL): boolean;
  detectCapabilities(document: Document): ProviderCapabilities;
  findConversationRoot(document: Document): Element | null;
  listVisibleMessageElements(root: Element): Element[];
  extractMessage(element: Element, context: ExtractionContext): ExtractedMessage | null;
  identifyRole(element: Element): MessageRole;
  findComposer(document: Document): EditableTarget | null;
  diagnostics(document: Document): ExtractionDiagnostic[];
  observeStreaming(root: Element, callback: (elements: Element[]) => void): Disposable;
}

import type { MessageRole } from "../providers/types";

export type FormulaSource =
  | "tex-delimiter"
  | "katex"
  | "mathjax"
  | "mathml"
  | "latex-code-block"
  | "dom-attribute"
  | "ai-message"
  | "selection"
  | "image-ocr";

export interface FormulaCandidate {
  id: string;
  rawSource: string;
  normalizedLatex?: string;
  mathml?: string;
  displayMode: "inline" | "display" | "unknown";
  source: FormulaSource;
  renderer: "plain-text" | "katex" | "mathjax" | "mathml" | "unknown";
  confidence: number;
  contextBefore?: string;
  contextAfter?: string;
  messageId?: string;
  messageRole?: MessageRole;
  pageUrl: string;
  elementFingerprint?: string;
  conversionRequired?: boolean;
}

export interface FormulaScanOptions {
  pageUrl?: string;
  messageId?: string;
  messageRole?: MessageRole;
  contextCharacters?: number;
  maxFormulas?: number;
  confidenceThreshold?: number;
}

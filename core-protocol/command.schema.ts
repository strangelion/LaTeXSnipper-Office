// LaTeXSnipper Unified Protocol v3.0 — Command Schema
// All hosts implement this interface.

export type Command =
  | { type: "InsertFormula"; payload: { latex: string; display?: "inline" | "block" | "numbered"; formulaId?: string; layoutProfileId?: string; equationLabel?: string } }
  | { type: "GetSelectedFormula"; payload?: {} }
  | { type: "ReplaceSelectedFormula"; payload: { latex: string; display?: "inline" | "block" | "numbered"; formulaId?: string; layoutProfileId?: string; equationLabel?: string } }
  | { type: "DeleteSelectedFormula"; payload?: {} }
  | { type: "InsertEquationReference"; payload: { formulaId: string } }
  | { type: "GetHostCapabilities"; payload?: {} }
  | { type: "RenderFormula"; payload: { latex: string; display?: "inline" | "block" | "numbered"; format?: "svg" | "png" } }
  | { type: "ReplaceSelection"; payload: { content: string } }
  | { type: "GetSelection"; payload?: {} }
  | { type: "ConvertToOMML"; payload: { latex: string } }
  | { type: "ConvertToLaTeX"; payload: { omml: string } }
  | { type: "RenderPreview"; payload: { latex: string; format?: "svg" | "mathml" } }
  | { type: "DetectTable"; payload?: {} }
  | { type: "FormatContent"; payload: { fontFamily?: string; fontSize?: number; color?: string } }
  | { type: "OpenEditor"; payload?: {} }
  | { type: "OpenSettings"; payload?: {} };

export type CommandResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string; code?: string };

export interface VstoInsertResult {
  type: "INSERT_RESULT";
  requestId: string;
  sessionId: string;
  success: boolean;
  formulaId?: string;
  rangeStart?: number;
  rangeEnd?: number;
  requestedStorageMode?: string;
  actualStorageMode?: string;
  fallbackReason?: string;
  error?: string;
  errorCode?: string;
}

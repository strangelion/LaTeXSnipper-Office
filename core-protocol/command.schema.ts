// LaTeXSnipper Unified Protocol v3.0 — Command Schema
// All hosts implement this interface.

export type Command =
  | { type: "InsertFormula"; payload: { latex: string; display?: "inline" | "block" | "numbered" } }
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
  | { ok: true; data?: string }
  | { ok: false; error: string };

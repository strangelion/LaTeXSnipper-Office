export type InsertionFormat = "raw-latex" | "dollar-inline" | "dollar-display" | "paren-inline" | "bracket-display";
export interface BrowserInsertionPayload { latex: string; displayMode: "inline" | "display"; insertionFormat: InsertionFormat; }
export interface InsertionResult { ok: boolean; adapter?: string; fallback?: "clipboard"; verified: boolean; errorCode?: string; message?: string; }
export function formatFormula(payload: BrowserInsertionPayload): string {
  switch (payload.insertionFormat) {
    case "raw-latex": return payload.latex;
    case "dollar-inline": return `$${payload.latex}$`;
    case "dollar-display": return `$$\n${payload.latex}\n$$`;
    case "paren-inline": return `\\(${payload.latex}\\)`;
    case "bracket-display": return `\\[${payload.latex}\\]`;
  }
}

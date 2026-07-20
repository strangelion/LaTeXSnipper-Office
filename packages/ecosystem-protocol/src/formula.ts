import type {
  EcosystemActionEnvelope,
  FormulaPayload,
  LiveEditPayload,
  LiveEditActionType,
} from "./actions";

// ─── Enqueue ──────────────────────────────────────────────────────────

export interface EnqueueRequest {
  actionType: string;
  origin: string;
  target: string;
  targetClientId?: string;
  payload: FormulaPayload;
  priority?: "normal" | "high";
  timeoutMs?: number;
}

export interface EnqueueResponse {
  ok: true;
  actionId: string;
}

// ─── Next ─────────────────────────────────────────────────────────────

export interface NextRequest {
  clientId: string;
  target?: string;
}

export type NextResponse =
  | { action: EcosystemActionEnvelope; found: true }
  | { action: null; found: false };

// ─── Ack ──────────────────────────────────────────────────────────────

export interface AckRequest {
  actionId: string;
  clientId: string;
  status: "acked";
}

export interface AckResponse {
  ok: true;
}

// ─── Complete ─────────────────────────────────────────────────────────

export interface CompleteRequest {
  actionId: string;
  clientId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string } | null;
}

export interface CompleteResponse {
  ok: true;
}

// ─── Status ───────────────────────────────────────────────────────────

export interface StatusResponse {
  actionId: string;
  status: string;
  updatedAt: string;
  result?: unknown;
  error?: { code: string; message: string } | null;
}

// ─── Formula Edit ─────────────────────────────────────────────────────

export interface FormulaEditRequest {
  origin: string;
  clientId?: string;
  latex: string;
  display?: boolean;
  mode?: string;
  sourceUrl?: string;
  replaceStrategy?: string;
}

export interface FormulaEditResponse {
  ok: true;
  actionId: string;
  message: string;
}

// ─── Clipboard Write ──────────────────────────────────────────────────

export interface ClipboardWriteRequest {
  text: string;
  format?: "latex" | "markdown" | "svg";
}

export interface ClipboardWriteResponse {
  ok: true;
}

// ─── Helpers ──────────────────────────────────────────────────────────

export function makeMarkdownMath(latex: string, display: boolean): string {
  if (display) return `$$\n${latex}\n$$`;
  return `$${latex}$`;
}

let _counter = 0;

function generateId(prefix: string): string {
  _counter++;
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}_${rand}_${_counter}`;
}

export function makeInsertFormulaAction(args: {
  origin: string;
  target: string;
  clientId?: string;
  latex: string;
  display: boolean;
}): EcosystemActionEnvelope<FormulaPayload> {
  const now = new Date();
  const expires = new Date(now.getTime() + 30_000);

  return {
    actionId: generateId("act"),
    actionType: "InsertFormula",
    origin: args.origin as any,
    target: args.target as any,
    targetClientId: args.clientId,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    timeoutMs: 30_000,
    nonce: generateId("non"),
    requireAck: true,
    allowFallback: true,
    priority: "normal",
    payload: {
      latex: args.latex,
      display: args.display,
      mode: args.display ? "display" : "inline",
      markdown: makeMarkdownMath(args.latex, args.display),
      schemaVersion: 1,
    },
    traceId: generateId("tr"),
    protocolVersion: 1,
  };
}

// ─── Live Edit Actions ────────────────────────────────────────────────

/**
 * Create a BeginEdit action — enqueued when user opens a formula for editing.
 * This is a lifecycle event, NOT a per-keystroke event.
 */
export function makeBeginEditAction(args: {
  origin: string;
  target: string;
  clientId?: string;
  transactionId: string;
  formulaId: string;
  documentId?: string;
  baseRevision?: number;
  displayMode?: "inline" | "block" | "numbered";
  storageMode?: string;
}): EcosystemActionEnvelope<LiveEditPayload> {
  const now = new Date();
  const expires = new Date(now.getTime() + 30_000);

  return {
    actionId: generateId("act"),
    actionType: "BeginEdit",
    origin: args.origin as any,
    target: args.target as any,
    targetClientId: args.clientId,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    timeoutMs: 30_000,
    nonce: generateId("non"),
    requireAck: true,
    allowFallback: false,
    priority: "high",
    payload: {
      transactionId: args.transactionId,
      formulaId: args.formulaId,
      documentId: args.documentId,
      baseRevision: args.baseRevision,
      displayMode: args.displayMode,
      storageMode: args.storageMode,
    },
    traceId: generateId("tr"),
    protocolVersion: 1,
  };
}

/**
 * Create a CommitEdit action — enqueued when user saves/commits the edit.
 * This triggers the final write to the Office host.
 * The payload includes the final LaTeX and OMML.
 */
export function makeCommitEditAction(args: {
  origin: string;
  target: string;
  clientId?: string;
  transactionId: string;
  formulaId: string;
  documentId?: string;
  latex: string;
  omml?: string;
  displayMode?: "inline" | "block" | "numbered";
  storageMode?: string;
  baseRevision?: number;
}): EcosystemActionEnvelope<LiveEditPayload> {
  const now = new Date();
  const expires = new Date(now.getTime() + 60_000); // Longer timeout for commit

  return {
    actionId: generateId("act"),
    actionType: "CommitEdit",
    origin: args.origin as any,
    target: args.target as any,
    targetClientId: args.clientId,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    timeoutMs: 60_000,
    nonce: generateId("non"),
    requireAck: true,
    allowFallback: false,
    priority: "high",
    payload: {
      transactionId: args.transactionId,
      formulaId: args.formulaId,
      documentId: args.documentId,
      latex: args.latex,
      omml: args.omml,
      displayMode: args.displayMode,
      storageMode: args.storageMode,
      baseRevision: args.baseRevision,
    },
    traceId: generateId("tr"),
    protocolVersion: 1,
  };
}

/**
 * Create a CancelEdit action — enqueued when user cancels the editing session.
 * Cleans up the transaction without writing to Office.
 */
export function makeCancelEditAction(args: {
  origin: string;
  target: string;
  clientId?: string;
  transactionId: string;
  formulaId: string;
}): EcosystemActionEnvelope<LiveEditPayload> {
  const now = new Date();
  const expires = new Date(now.getTime() + 15_000);

  return {
    actionId: generateId("act"),
    actionType: "CancelEdit",
    origin: args.origin as any,
    target: args.target as any,
    targetClientId: args.clientId,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    timeoutMs: 15_000,
    nonce: generateId("non"),
    requireAck: false,
    allowFallback: true,
    priority: "normal",
    payload: {
      transactionId: args.transactionId,
      formulaId: args.formulaId,
    },
    traceId: generateId("tr"),
    protocolVersion: 1,
  };
}

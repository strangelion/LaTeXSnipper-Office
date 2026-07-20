// ─── Targets ──────────────────────────────────────────────────────────

export type EcosystemTarget =
  | "desktop"
  | "vscode"
  | "obsidian"
  | "browser"
  | "typora"
  | "notion"
  | "clipboard";

// ─── Action Types ─────────────────────────────────────────────────────

/**
 * Action types for the ecosystem protocol.
 *
 * IMPORTANT: High-frequency keystroke events must NOT use this queue.
 * Only lifecycle events (open, begin, commit, cancel) should be enqueued.
 * Real-time draft editing stays in the local session (OfficeLiveEditSession).
 */
export type EcosystemActionType =
  | "InsertFormula"
  | "ReplaceSelection"
  | "ReadSelection"
  | "EditFormula"
  | "RenderFormula"
  | "CopyMarkdown"
  | "OpenEditor"
  | "BeginEdit"
  | "CommitEdit"
  | "CancelEdit"
  | "Ping"
  | "ShowMessage";

/**
 * Live edit action types — these are the ONLY actions that should be
 * enqueued for real-time editing workflows. They represent lifecycle
 * boundaries, not per-keystroke events.
 *
 * Usage:
 *   BeginEdit  → user opens formula for editing (creates transaction)
 *   CommitEdit → user saves/commits the edit (final write to Office)
 *   CancelEdit → user cancels the editing session
 *
 * Per-keystroke draft updates stay in LiveOfficeEditSession (volatile memory)
 * and are NEVER sent through the ecosystem action queue.
 */
export type LiveEditActionType = "BeginEdit" | "CommitEdit" | "CancelEdit";

// ─── Formula Payload ──────────────────────────────────────────────────

export interface FormulaPayload {
  formulaId?: string;
  latex: string;
  display?: boolean;
  mode?: "inline" | "display";
  omml?: string | null;
  svg?: string | null;
  png?: string | null;
  markdown?: string | null;
  source?: string;
  schemaVersion?: number;
}

// ─── Live Edit Payload ────────────────────────────────────────────────

/**
 * Payload for live edit lifecycle actions (BeginEdit, CommitEdit, CancelEdit).
 * These carry transaction-level metadata, not per-keystroke draft data.
 */
export interface LiveEditPayload {
  /** Transaction ID linking to OfficeEditTransactionStore */
  transactionId: string;
  /** Formula being edited */
  formulaId: string;
  /** The host document context (e.g., "word:/path/to/doc.docx") */
  documentId?: string;
  /** The final LaTeX at commit time (only for CommitEdit) */
  latex?: string;
  /** The final OMML at commit time (only for CommitEdit) */
  omml?: string;
  /** Display mode */
  displayMode?: "inline" | "block" | "numbered";
  /** Storage mode (native-omml, ole, image, vector) */
  storageMode?: string;
  /** Revision before edit began (for optimistic concurrency) */
  baseRevision?: number;
  /** Revision after commit succeeded (only in CommitEdit result) */
  newRevision?: number;
}

// ─── Action Envelope ──────────────────────────────────────────────────

export interface EcosystemActionEnvelope<TPayload = unknown> {
  actionId: string;
  actionType: EcosystemActionType;

  origin: EcosystemTarget;
  target: EcosystemTarget;
  targetClientId?: string;

  createdAt: string;
  expiresAt: string;
  timeoutMs: number;
  nonce: string;
  requireAck: boolean;

  allowFallback: boolean;
  priority: "normal" | "high";
  replyTo?: string;

  payload: TPayload;

  traceId: string;
  appVersion?: string;
  protocolVersion: number;
}

// ─── Action Status ────────────────────────────────────────────────────

export type EcosystemActionStatus =
  | "queued"
  | "dispatched"
  | "acked"
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "expired";

export interface EcosystemActionRecord {
  action: EcosystemActionEnvelope;
  status: EcosystemActionStatus;
  updatedAt: string;
  result?: unknown;
  error?: { code: string; message: string } | null;
}

// ─── Client ───────────────────────────────────────────────────────────

export interface EcosystemClient {
  clientId: string;
  clientType: string;
  clientName: string;
  capabilities: string[];
  version: string;
  lastSeen: string;
  connectedAt: string;
}

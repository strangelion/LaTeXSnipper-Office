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

export type EcosystemActionType =
  | "InsertFormula"
  | "ReplaceSelection"
  | "ReadSelection"
  | "EditFormula"
  | "RenderFormula"
  | "CopyMarkdown"
  | "OpenEditor"
  | "Ping"
  | "ShowMessage";

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

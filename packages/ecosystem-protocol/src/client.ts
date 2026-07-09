import type { EcosystemClient } from "./actions";

// ─── Register ─────────────────────────────────────────────────────────

export interface RegisterClientRequest {
  clientId: string;
  clientType: string;
  clientName: string;
  capabilities: string[];
  version: string;
}

export interface RegisterClientResponse {
  ok: true;
  protocolVersion: number;
  serverVersion: string;
  heartbeatIntervalMs: number;
}

// ─── Heartbeat ────────────────────────────────────────────────────────

export interface HeartbeatRequest {
  clientId: string;
}

export interface HeartbeatResponse {
  ok: true;
  lastSeen: string;
}

// ─── List Clients ─────────────────────────────────────────────────────

export interface ListClientsResponse {
  ok: true;
  clients: EcosystemClient[];
}

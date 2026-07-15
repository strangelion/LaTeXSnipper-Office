import { Plugin } from "obsidian";
import { normalizeBridgeUrl } from "./settings";

export class BridgeClient {
  constructor(
    private plugin: Plugin,
    private clientId: string,
  ) {}

  get bridgeUrl(): string {
    const settings = (this.plugin as any).settings;
    return normalizeBridgeUrl(settings?.bridgeUrl);
  }

  get token(): string {
    return "";
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.bridgeUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        ...(init.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`Bridge error: ${res.status}`);
    return (await res.json()) as T;
  }

  async ping(): Promise<boolean> {
    try { await this.request("/api/ecosystem/ping"); return true; }
    catch { return false; }
  }

  async register(clientName: string) {
    return this.request("/api/ecosystem/clients/register", {
      method: "POST",
      body: JSON.stringify({
        clientId: this.clientId,
        clientType: "obsidian",
        clientName,
        capabilities: [
          "insert_formula",
          "replace_selection",
          "read_selection",
          "open_editor",
        ],
        version: "0.1.0",
      }),
    });
  }

  async enqueue(action: unknown) {
    return this.request("/api/ecosystem/actions/enqueue", {
      method: "POST",
      body: JSON.stringify(action),
    });
  }

  async next(target = "obsidian") {
    return this.request(
      `/api/ecosystem/actions/next?clientId=${encodeURIComponent(
        this.clientId,
      )}&target=${encodeURIComponent(target)}`,
    );
  }

  async complete(
    actionId: string,
    ok: boolean,
    result?: unknown,
    error?: { code: string; message: string } | null,
  ) {
    return this.request("/api/ecosystem/actions/complete", {
      method: "POST",
      body: JSON.stringify({
        actionId,
        clientId: this.clientId,
        ok,
        result,
        error,
      }),
    });
  }

  async heartbeat() {
    return this.request("/api/ecosystem/clients/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        clientId: this.clientId,
      }),
    });
  }
}

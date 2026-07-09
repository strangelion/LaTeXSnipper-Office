import { Plugin, Platform } from "obsidian";

export class BridgeClient {
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  get bridgeUrl(): string {
    return "http://127.0.0.1:19876";
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

  async register(clientId: string, clientName: string) {
    return this.request("/api/ecosystem/clients/register", {
      method: "POST",
      body: JSON.stringify({
        clientId,
        clientType: "obsidian",
        clientName,
        capabilities: ["insert_formula", "replace_selection", "read_selection", "open_editor"],
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

  async next(clientId: string, target: string) {
    return this.request(
      `/api/ecosystem/actions/next?clientId=${encodeURIComponent(clientId)}&target=${encodeURIComponent(target)}`
    );
  }

  async complete(actionId: string, ok: boolean, result?: unknown, error?: { code: string; message: string } | null) {
    return this.request("/api/ecosystem/actions/complete", {
      method: "POST",
      body: JSON.stringify({ actionId, clientId: "obsidian-default", ok, result, error }),
    });
  }

  async heartbeat(clientId: string) {
    return this.request("/api/ecosystem/clients/heartbeat", {
      method: "POST",
      body: JSON.stringify({ clientId }),
    });
  }
}

import * as vscode from "vscode";

export class BridgeClient {
  get bridgeUrl(): string {
    return vscode.workspace
      .getConfiguration("latexsnipper")
      .get<string>("bridgeUrl", "http://127.0.0.1:19877");
  }

  get token(): string {
    return vscode.workspace
      .getConfiguration("latexsnipper")
      .get<string>("bridgeToken", "");
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
    if (!res.ok) throw new Error(`Bridge request failed: ${res.status}`);
    return (await res.json()) as T;
  }

  async ping(): Promise<boolean> {
    try {
      await this.request("/api/ecosystem/ping");
      return true;
    } catch {
      return false;
    }
  }

  async register(clientId: string, clientName: string) {
    return this.request("/api/ecosystem/clients/register", {
      method: "POST",
      body: JSON.stringify({
        clientId,
        clientType: "vscode",
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

  async next(clientId: string) {
    return this.request(
      `/api/ecosystem/actions/next?clientId=${encodeURIComponent(clientId)}&target=vscode`
    );
  }

  async complete(actionId: string, ok: boolean, result?: unknown, error?: { code: string; message: string } | null) {
    return this.request("/api/ecosystem/actions/complete", {
      method: "POST",
      body: JSON.stringify({ actionId, clientId: "vscode-default", ok, result, error }),
    });
  }

  async heartbeat(clientId: string) {
    return this.request("/api/ecosystem/clients/heartbeat", {
      method: "POST",
      body: JSON.stringify({ clientId }),
    });
  }
}

import { Plugin, requestUrl, RequestUrlResponse } from "obsidian";
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

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.bridgeUrl}${path}`;
    const method = init.method ?? "GET";

    let response: RequestUrlResponse;
    try {
      response = await requestUrl({
        url,
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: typeof init.body === "string" ? init.body : undefined,
      });
    } catch (error) {
      console.error("[LaTeXSnipper] Bridge request failed:", url, error);
      throw error;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Bridge error: ${response.status}`);
    }

    return response.json as T;
  }

  async ping(): Promise<boolean> {
    try {
      await this.request("/api/ecosystem/ping");
      return true;
    } catch {
      return false;
    }
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
      `/api/ecosystem/actions/next?clientId=${encodeURIComponent(this.clientId)}&target=${encodeURIComponent(target)}`,
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

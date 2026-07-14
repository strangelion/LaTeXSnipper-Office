import type { BrowserClientRegistration, NextActionResponse } from "./types";

export const BRIDGE_BASE_URL = "http://127.0.0.1:19877";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;

export class BridgeClient {
  constructor(
    private readonly clientId: string,
    private readonly browser: "chrome" | "firefox",
  ) {}

  async request<T>(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${BRIDGE_BASE_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { "Content-Type": "application/json", ...(init.headers || {}) },
      });
      if (!response.ok) {
        throw Object.assign(new Error(`Bridge returned HTTP ${response.status}`), {
          code: "BRIDGE_HTTP_ERROR",
          status: response.status,
        });
      }
      const declaredLength = Number(response.headers.get("content-length") || "0");
      if (declaredLength > MAX_RESPONSE_BYTES) {
        throw Object.assign(new Error("Bridge response exceeded the size limit"), {
          code: "BRIDGE_RESPONSE_TOO_LARGE",
        });
      }
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
        throw Object.assign(new Error("Bridge response exceeded the size limit"), {
          code: "BRIDGE_RESPONSE_TOO_LARGE",
        });
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw Object.assign(new Error("Bridge returned malformed JSON"), {
          code: "BRIDGE_INVALID_RESPONSE",
        });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw Object.assign(new Error("Bridge request timed out"), { code: "BRIDGE_TIMEOUT" });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  ping(): Promise<unknown> {
    return this.request("/api/ecosystem/ping");
  }

  register(version: string): Promise<unknown> {
    const payload: BrowserClientRegistration = {
      clientId: this.clientId,
      clientType: "browser-extension",
      clientName: `LaTeXSnipper ${this.browser}`,
      capabilities: ["extract-formula", "extract-conversation", "insert-formula"],
      target: "browser",
      browser: this.browser,
      version,
    };
    return this.request("/api/ecosystem/clients/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  heartbeat(): Promise<unknown> {
    return this.request("/api/ecosystem/clients/heartbeat", {
      method: "POST",
      body: JSON.stringify({ clientId: this.clientId, target: "browser" }),
    });
  }

  enqueue(action: unknown): Promise<unknown> {
    return this.request("/api/ecosystem/actions/enqueue", {
      method: "POST",
      body: JSON.stringify(action),
    });
  }

  next(): Promise<NextActionResponse> {
    return this.request(
      `/api/ecosystem/actions/next?clientId=${encodeURIComponent(this.clientId)}&target=browser`,
    );
  }

  complete(actionId: string, ok: boolean, result?: unknown, error?: unknown): Promise<unknown> {
    return this.request("/api/ecosystem/actions/complete", {
      method: "POST",
      body: JSON.stringify({ actionId, clientId: this.clientId, ok, result, error }),
    });
  }
}

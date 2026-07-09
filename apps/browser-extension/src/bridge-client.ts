const BRIDGE_URL = "http://127.0.0.1:19876";

export class BridgeClient {
  token: string = "";

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${BRIDGE_URL}${path}`, {
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

  async enqueue(action: unknown) {
    return this.request("/api/ecosystem/actions/enqueue", {
      method: "POST",
      body: JSON.stringify(action),
    });
  }

  async next(clientId: string) {
    return this.request(`/api/ecosystem/actions/next?clientId=${encodeURIComponent(clientId)}&target=browser`);
  }

  async complete(actionId: string, ok: boolean, result?: unknown) {
    return this.request("/api/ecosystem/actions/complete", {
      method: "POST",
      body: JSON.stringify({ actionId, clientId: "browser-default", ok, result }),
    });
  }
}

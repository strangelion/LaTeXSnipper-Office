import type { FormulaDisplayMode } from "../model/formula-payload";

export interface BridgeConversionResult {
  success: boolean;
  content: string;
  format: "omml" | "latex" | "svg" | "png";
  widthPt?: number;
  heightPt?: number;
  fallbackFormat?: string;
  diagnostic?: string | null;
}

export class OfficeBridgeClient {
  readonly baseUrl: string;

  constructor(baseUrl?: string) {
    if (baseUrl) {
      this.baseUrl = baseUrl;
      return;
    }
    const { hostname, port } = window.location;
    this.baseUrl = (hostname === "127.0.0.1" || hostname === "localhost") && port === "19876"
      ? ""
      : "https://127.0.0.1:19876";
  }

  async heartbeat(host: string): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout("/api/office/heartbeat", { host }, 3000);
      return response.ok;
    } catch {
      return false;
    }
  }

  async convert(
    sourceFormat: "latex" | "omml",
    targetFormat: "latex" | "omml" | "svg" | "png",
    content: string,
    displayMode: FormulaDisplayMode,
  ): Promise<BridgeConversionResult> {
    if (!content.trim()) throw new Error("Conversion content is empty");
    let response: Response;
    try {
      response = await this.fetchWithTimeout("/api/office/convert/v1", {
        sourceFormat,
        targetFormat,
        content,
        displayMode,
      }, 15000);
    } catch (error) {
      throw new Error(`LaTeXSnipper desktop Bridge is not available. Start the desktop application and retry. (${String(error)})`);
    }
    if (!response.ok) throw new Error(`Bridge request failed with HTTP ${response.status}`);
    const data = await response.json() as Partial<BridgeConversionResult>;
    if (!data.success || typeof data.content !== "string" || !data.content) {
      throw new Error(data.diagnostic || `Bridge could not convert ${sourceFormat} to ${targetFormat}`);
    }
    return data as BridgeConversionResult;
  }

  private fetchWithTimeout(path: string, body: unknown, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    return fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => window.clearTimeout(timeout));
  }
}

export interface BridgeError {
  code: string;
  message: string;
  status?: number;
}

export interface EcosystemAction {
  actionId: string;
  actionType: string;
  payload?: Record<string, unknown>;
}

export interface NextActionResponse {
  found: boolean;
  action?: EcosystemAction;
}

export interface BrowserClientRegistration {
  clientId: string;
  clientType: "browser-extension";
  clientName: string;
  capabilities: string[];
  target: "browser";
  browser: "chrome" | "firefox";
  version: string;
}

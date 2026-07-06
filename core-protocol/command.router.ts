// LaTeXSnipper Unified Protocol v3.0 — Command Router
// Dispatches commands to the correct host adapter.

import { Command, CommandResult } from "./command.schema";

export type HostType = "office" | "wps" | "vsto" | "obsidian";

export interface HostAdapter {
  execute(cmd: Command): Promise<CommandResult>;
}

export class CommandRouter {
  private adapters = new Map<HostType, HostAdapter>();

  register(host: HostType, adapter: HostAdapter) {
    this.adapters.set(host, adapter);
  }

  async dispatch(host: HostType, cmd: Command): Promise<CommandResult> {
    const adapter = this.adapters.get(host);
    if (!adapter) return { ok: false, error: `No adapter for host: ${host}` };
    try {
      return await adapter.execute(cmd);
    } catch (e: any) {
      return { ok: false, error: e.message || String(e) };
    }
  }
}

// Singleton
export const router = new CommandRouter();

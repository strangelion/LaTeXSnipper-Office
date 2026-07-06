// LaTeXSnipper v3.0 — WPS Bridge (unified entry point)
// Registered as window.WPSBridge

import { Command } from "../../core-protocol/command.schema";
import { router } from "../../core-protocol/command.router";
import { WPSAdapter } from "./wps.adapter";

router.register("wps", new WPSAdapter());

(window as any).WPSBridge = {
  execute(cmd: Command) {
    return router.dispatch("wps", cmd);
  }
};

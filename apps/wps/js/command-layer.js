(function () {
  "use strict";

  var adapters = Object.create(null);
  var hostAdapterKeys = {
    wps: "wps-writer",
    et: "wps-spreadsheets",
    wpp: "wps-presentation",
  };

  function structuredError(code, message, detail) {
    return {
      ok: false,
      errorCode: code,
      error: message,
      detail: detail || null,
    };
  }

  function activeAdapterKey() {
    var host = window.WpsHostDetection
      ? window.WpsHostDetection.detectHost(window.Application)
      : "unknown";
    return hostAdapterKeys[host] || null;
  }

  function resolveAdapter(requested) {
    var key = requested && adapters[requested] ? requested : activeAdapterKey();
    return key ? { key: key, adapter: adapters[key] } : null;
  }

  function dispatch(requested, command) {
    var resolved = resolveAdapter(requested);
    if (!resolved || !resolved.adapter) {
      return Promise.resolve(
        structuredError("UNSUPPORTED_HOST", "No adapter is available for this WPS host."),
      );
    }
    try {
      return Promise.resolve(resolved.adapter.execute(command)).catch(function (error) {
        return structuredError(
          error.code || "COMMAND_FAILED",
          error.message || String(error),
        );
      });
    } catch (error) {
      return Promise.resolve(
        structuredError(
          error.code || "COMMAND_FAILED",
          error.message || String(error),
        ),
      );
    }
  }

  function registerAdapter(key, adapter) {
    if (!key || !adapter || typeof adapter.execute !== "function") {
      throw new Error("Adapter registration requires a key and execute(command).");
    }
    adapters[key] = adapter;
  }

  function getCapabilities() {
    var resolved = resolveAdapter();
    return resolved && resolved.adapter
      ? resolved.adapter.capabilities
      : {
          host: "unknown",
          insertFormula: false,
          readFormula: false,
          updateFormula: false,
          deleteFormula: false,
          numberedEquation: false,
          imageFormula: false,
          nativeMath: false,
        };
  }

  window.CommandLayer = {
    dispatch: dispatch,
    registerAdapter: registerAdapter,
    getActiveAdapterKey: activeAdapterKey,
    getCapabilities: getCapabilities,
    structuredError: structuredError,
  };
})();

(function () {
  "use strict";

  var config = null;
  var heartbeatTimer = null;

  function baseUrl() {
    return window.location.origin;
  }

  function bridgeError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function request(path, options) {
    var init = options || {};
    init.headers = Object.assign({}, init.headers || {});
    if (config && config.token) {
      init.headers.Authorization = "Bearer " + config.token;
    }
    // Auto-add Content-Type for JSON requests
    if (init.body && !init.headers["Content-Type"]) {
      init.headers["Content-Type"] = "application/json";
    }
    return fetch(baseUrl() + path, init).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || body.success === false || body.ok === false) {
          throw bridgeError(
            body.error || "BRIDGE_REQUEST_FAILED",
            body.diagnostic || body.message || body.error || "Bridge request failed.",
          );
        }
        return body;
      });
    });
  }

  function connect() {
    return fetch(baseUrl() + "/config")
      .then(function (response) {
        if (!response.ok) throw bridgeError("BRIDGE_OFFLINE", "Bridge config failed.");
        return response.json();
      })
      .then(function (body) {
        config = body.result || body;
        if (!config.token) {
          throw bridgeError("BRIDGE_AUTH_UNAVAILABLE", "Bridge did not provide a session token.");
        }
        return config;
      })
      .catch(function (error) {
        if (!error.code) error.code = "BRIDGE_OFFLINE";
        throw error;
      });
  }

  function ensureConnected() {
    return config ? Promise.resolve(config) : connect();
  }

  function convert(latex, displayMode, targetFormat) {
    return ensureConnected()
      .then(function () {
        return request("/api/office/convert/v1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceFormat: "latex",
            targetFormat: targetFormat || "png",
            content: latex,
            displayMode: displayMode || "block",
          }),
        });
      })
      .then(function (result) {
        if (!result.content || result.success !== true) {
          throw bridgeError("CONVERSION_FAILED", result.diagnostic || "Conversion failed.");
        }
        return result;
      });
  }

  function createTempAsset(format, base64, formulaId) {
    return ensureConnected().then(function () {
      return request("/api/wps/temp-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: format, base64: base64, formulaId: formulaId }),
      });
    });
  }

  function deleteTempAsset(assetId) {
    return ensureConnected().then(function () {
      return request("/api/wps/temp-assets/" + encodeURIComponent(assetId), {
        method: "DELETE",
      });
    });
  }

  function hostRegistration(host, capabilities) {
    var values = {
      wps: ["writer", "LaTeXSnipper WPS Writer"],
      et: ["spreadsheets", "LaTeXSnipper WPS Spreadsheets"],
      wpp: ["presentation", "LaTeXSnipper WPS Presentation"],
    }[host];
    if (!values) throw bridgeError("UNSUPPORTED_HOST", "Unknown WPS host.");
    return {
      clientId: "latexsnipper-wps-" + values[0],
      clientType: "wps",
      clientName: values[1],
      capabilities: Object.keys(capabilities).filter(function (key) {
        return key !== "host" && capabilities[key] === true;
      }),
      version: "1.3.0",
    };
  }

  function doRegister(registration) {
    return ensureConnected()
      .then(function () {
        return request("/api/ecosystem/clients/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(registration),
        });
      })
      .then(function () {
        return registration;
      });
  }

  function doHeartbeat(registration) {
    return ensureConnected().then(function () {
      return request("/api/ecosystem/clients/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: registration.clientId }),
      });
    });
  }

  function startHeartbeat(host, capabilities, onStatus) {
    if (heartbeatTimer) window.clearInterval(heartbeatTimer);

    // Create stable registration object - persists clientId regardless of desktop state
    var registration = hostRegistration(host, capabilities);
    var isRegistered = false;

    // Try to register with desktop
    function tryRegister() {
      return doRegister(registration)
        .then(function () {
          isRegistered = true;
          if (onStatus) onStatus(true, null);
        })
        .catch(function () {
          // Desktop offline, will retry on next heartbeat
          isRegistered = false;
          if (onStatus) onStatus(false, new Error("BRIDGE_OFFLINE"));
        });
    }

    var send = function () {
      if (!isRegistered) {
        // Not registered, try to register
        return tryRegister();
      }

      return doHeartbeat(registration)
        .then(function (result) {
          // If desktop restarted (registered === false), re-register
          if (result && result.registered === false) {
            isRegistered = false;
            return tryRegister();
          }
          if (onStatus) onStatus(true, null);
        })
        .catch(function () {
          // Desktop offline, will retry on next tick
          isRegistered = false;
          if (onStatus) onStatus(false, new Error("BRIDGE_OFFLINE"));
        });
    };

    // Initial register attempt
    heartbeatTimer = window.setInterval(send, 12000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) send();
    });

    return tryRegister().then(function () {
      return registration;
    });
  }

  var actionPollTimer = null;
  var actionPollRunning = false;

  function nextAction(registration) {
    return request(
      "/api/ecosystem/actions/next?clientId=" +
        encodeURIComponent(registration.clientId) +
        "&target=wps",
    );
  }

  function completeAction(
    registration,
    actionId,
    ok,
    result,
    error,
  ) {
    return request(
      "/api/ecosystem/actions/complete",
      {
        method: "POST",
        body: JSON.stringify({
          actionId: actionId,
          clientId: registration.clientId,
          ok: !!ok,
          result: result || null,
          error: error || null,
        }),
      },
    );
  }

  function startActionPoller(
    getRegistration,
    dispatch,
  ) {
    if (actionPollTimer) {
      window.clearInterval(actionPollTimer);
    }

    function tick() {
      if (actionPollRunning) return;

      var registration = typeof getRegistration === "function"
        ? getRegistration()
        : getRegistration;

      // If not registered yet, skip this tick
      if (!registration) return;

      actionPollRunning = true;

      nextAction(registration)
        .then(function (data) {
          if (
            !data ||
            !data.found ||
            !data.action ||
            !data.action.actionId
          ) {
            return null;
          }

          var action = data.action;
          var payload = action.payload || {};

          if (action.actionType !== "InsertFormula") {
            return completeAction(
              registration,
              action.actionId,
              false,
              null,
              {
                code: "UNSUPPORTED_WPS_ACTION",
                message:
                  "Unsupported WPS ecosystem action: " +
                  action.actionType,
              },
            );
          }

          var mode =
            payload.mode ||
            (payload.display ? "block" : "inline");

          return Promise.resolve(
            dispatch({
              type: "InsertFormula",
              payload: {
                latex: payload.latex || "",
                mode: mode,
                display: mode,
                formulaId: payload.formulaId || null,
              },
            }),
          ).then(function (result) {
            return completeAction(
              registration,
              action.actionId,
              result && result.ok === true,
              result && result.ok
                ? {
                    inserted: true,
                    data: result.data || null,
                  }
                : null,
              result && result.ok
                ? null
                : {
                    code:
                      (result && result.errorCode) ||
                      "WPS_ACTION_FAILED",
                    message:
                      (result && result.error) ||
                      "WPS rejected the action.",
                  },
            );
          });
        })
        .catch(function (error) {
          console.warn(
            "[LaTeXSnipper WPS] action poll failed",
            error,
          );
        })
        .then(function () {
          actionPollRunning = false;
        });
    }

    actionPollTimer = window.setInterval(
      tick,
      1500,
    );

    tick();

    return function () {
      if (actionPollTimer) {
        window.clearInterval(actionPollTimer);
        actionPollTimer = null;
      }
    };
  }

  window.WpsBridgeClient = {
    baseUrl: baseUrl,
    connect: connect,
    convert: convert,
    createTempAsset: createTempAsset,
    deleteTempAsset: deleteTempAsset,
    register: doRegister,
    heartbeat: doHeartbeat,
    startHeartbeat: startHeartbeat,
    nextAction: nextAction,
    completeAction: completeAction,
    startActionPoller: startActionPoller,
    hostRegistration: hostRegistration,
  };
})();

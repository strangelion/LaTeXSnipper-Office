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

  function register(host, capabilities) {
    var registration = hostRegistration(host, capabilities);
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

  function heartbeat(registration) {
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
    return register(host, capabilities).then(function (registration) {
      var send = function () {
        return heartbeat(registration)
          .then(function () {
            if (onStatus) onStatus(true, null);
          })
          .catch(function (error) {
            if (onStatus) onStatus(false, error);
          });
      };
      send();
      heartbeatTimer = window.setInterval(send, 12000);
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) send();
      });
      return registration;
    });
  }

  window.WpsBridgeClient = {
    baseUrl: baseUrl,
    connect: connect,
    convert: convert,
    createTempAsset: createTempAsset,
    deleteTempAsset: deleteTempAsset,
    register: register,
    heartbeat: heartbeat,
    startHeartbeat: startHeartbeat,
  };
})();

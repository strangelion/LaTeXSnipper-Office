// LaTeXSnipper WPS JSAddIn production entry.
// The production runtime is served by the Tauri Bridge and does not require Node.js.
(function () {
  "use strict";
  var scripts = [
    "js/util.js",
    "js/host-detect.js",
    "js/bridge-client.js",
    "js/command-layer.js",
    "js/adapters.js",
    "js/ribbon.js",
  ];
  scripts.forEach(function (source) {
    document.write('<script src="' + source + '"><\/script>');
  });
})();

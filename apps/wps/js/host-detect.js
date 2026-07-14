(function () {
  "use strict";

  function readable(value) {
    try {
      return value != null;
    } catch (_error) {
      return false;
    }
  }

  function detectHost(application) {
    if (!application) return "unknown";
    try {
      if (readable(application.ActiveDocument)) return "wps";
    } catch (_error) {
      // Continue with positive checks for the other hosts.
    }
    try {
      if (
        readable(application.ActiveWorkbook) &&
        readable(application.ActiveSheet)
      ) {
        return "et";
      }
    } catch (_error) {
      // Continue with the Presentation capability check.
    }
    try {
      if (readable(application.ActivePresentation)) return "wpp";
    } catch (_error) {
      return "unknown";
    }
    return "unknown";
  }

  window.WpsHostDetection = { detectHost: detectHost };
})();

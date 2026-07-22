(function () {
  "use strict";

  var METADATA_PREFIX = "latexsnipper:";
  var INDEX_VARIABLE = "LaTeXSnipperFormulaIndex";
  var SEQUENCE_VARIABLE = "LaTeXSnipperEquationSequence";
  var idCounter = 0;

  function app() {
    return window.Application;
  }

  function failure(code, message, detail) {
    return window.CommandLayer.structuredError(code, message, detail);
  }

  function logFailure(operation, formulaIdValue, error) {
    var host = window.WpsHostDetection
      ? window.WpsHostDetection.detectHost(window.Application)
      : "unknown";
    var errorCode = (error && error.code) || "WPS_API_ERROR";
    var message = (error && error.message) || String(error || "unknown error");

    console.warn("[LaTeXSnipper WPS] operation failed", {
      operation: operation,
      host: host,
      formulaId: formulaIdValue || null,
      errorCode: errorCode,
      message: message,
    });

    // Fire-and-forget report to Desktop Bridge for persistent logging
    if (
      window.WpsBridgeClient &&
      typeof window.WpsBridgeClient.request === "function"
    ) {
      window.WpsBridgeClient
        .request("/api/wps/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            level: "error",
            host: host,
            operation: operation,
            formulaId: formulaIdValue || "",
            errorCode: errorCode,
            message: message,
          }),
        })
        .catch(function () {
          // Best-effort — Bridge may be offline
        });
    }
  }

  function formulaId() {
    idCounter += 1;
    var random = Math.floor(Math.random() * 0x100000000).toString(36);
    return "wps-" + new Date().getTime().toString(36) + "-" + random + "-" + idCounter;
  }

  function bookmarkName(id, suffix) {
    return ("LSN_" + id + (suffix || "")).replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
  }

  // Find a document variable by name with index-iteration fallback.
  // Some WPS versions only support numeric index on Variables.Item(),
  // so we iterate by index when the name-based lookup fails.
  function findVariable(document, name) {
    try {
      var v = document.Variables.Item(name);
      if (v) return v;
    } catch (_e) {
      // Name-based lookup failed — try index iteration
    }

    try {
      for (var i = 1; i <= document.Variables.Count; i++) {
        var item = document.Variables.Item(i);
        if (item && String(item.Name) === name) {
          return item;
        }
      }
    } catch (_iterError) {
      logFailure("iterate-document-variables", null, _iterError);
    }

    return null;
  }

  function getVariable(document, name) {
    try {
      var variable = findVariable(document, name);
      return variable ? String(variable.Value || "") : "";
    } catch (_error) {
      logFailure("read-document-variable", null, _error);
      return "";
    }
  }

  function setVariable(document, name, value) {
    try {
      var existing = findVariable(document, name);
      if (existing) {
        existing.Value = String(value);
        return true;
      }
    } catch (_error) {
      // Existing variable not found — try Add below
    }

    try {
      document.Variables.Add(name, String(value));
      return true;
    } catch (_addError) {
      logFailure("add-document-variable", null, _addError);
      return false;
    }
  }

  function metadataIndex(document) {
    var raw = getVariable(document, INDEX_VARIABLE);
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      logFailure("parse-formula-metadata", null, _error);
      return [];
    }
  }

  function saveMetadata(document, metadata) {
    var index = metadataIndex(document).filter(function (item) {
      return item.formulaId !== metadata.formulaId;
    });
    index.push(metadata);
    if (!setVariable(document, INDEX_VARIABLE, JSON.stringify(index))) {
      throw Object.assign(new Error("Document metadata is unavailable."), {
        code: "METADATA_UNAVAILABLE",
      });
    }
  }

  function removeMetadata(document, id) {
    return setVariable(
      document,
      INDEX_VARIABLE,
      JSON.stringify(
        metadataIndex(document).filter(function (item) {
          return item.formulaId !== id;
        }),
      ),
    );
  }

  function documentMetadataAvailable(document) {
    return !!(
      document &&
      document.Variables &&
      typeof document.Variables.Add === "function" &&
      document.Bookmarks &&
      typeof document.Bookmarks.Add === "function"
    );
  }

  function selectionIntersects(selectionRange, ownedRange) {
    return (
      selectionRange &&
      ownedRange &&
      selectionRange.End >= ownedRange.Start &&
      selectionRange.Start <= ownedRange.End
    );
  }

  function selectedWriterMetadata(document, selectionRange) {
    var index = metadataIndex(document);
    for (var i = 0; i < index.length; i += 1) {
      try {
        var range = document.Bookmarks.Item(index[i].bookmark).Range;
        if (selectionIntersects(selectionRange, range)) return index[i];
      } catch (_error) {
        // Stale bookmarks are ignored and can be repaired by the next update.
      }
    }
    return null;
  }

  function restoreRange(document, start, end) {
    try {
      document.Range(start, end).Select();
    } catch (_error) {
      logFailure("restore-writer-selection", null, _error);
    }
  }

  // Insert a formula into WPS Writer using the documented native math API.
  //
  // Standard WPS JSAPI path (see WPS开放平台):
  //   Range.Text = linear math
  //   → OMaths.Add(Range)       — returns Range, per WPS docs
  //   → Range.OMaths.Item(1)    — get the OMath
  //   → OMath.BuildUp()         — convert linear to professional
  //
  // The Bridge (when available) converts LaTeX to Office Linear Math
  // (UnicodeMath) via Core. When the Bridge is unreachable, a local
  // subset converter handles basic formulas.
  function addNativeMath(document, range, latex, display) {
    // TODO: When Core supports latex→linear-math, use Bridge here:
    //   WpsBridgeClient.convert(latex, display, "linear-math")
    // For now, the Bridge does not serve this format — go directly to
    // the local fallback to avoid a guaranteed-failed HTTP round-trip.
    return Promise.resolve().then(function () {
      return insertLinearMath(
        document,
        range,
        latexToUnicodeMath(latex),
        display,
      );
    });
  }

  function insertLinearMath(document, range, linear, display) {
    var start = range.Start;
    range.Text = linear;

    var inserted = document.Range(start, start + linear.length);
    var collection = document.OMaths || app().Selection.OMaths;

    if (!collection || typeof collection.Add !== "function") {
      inserted.Delete();
      throw Object.assign(
        new Error("WPS native math API is unavailable."),
        { code: "NATIVE_MATH_UNAVAILABLE" },
      );
    }

    // OMaths.Add() returns a Range (per WPS official JSAPI docs)
    var mathRange = collection.Add(inserted);
    if (!mathRange) {
      inserted.Delete();
      throw Object.assign(
        new Error("WPS did not return the created formula range."),
        { code: "OMATH_CREATE_FAILED" },
      );
    }

    var math = null;
    if (mathRange.OMaths && mathRange.OMaths.Count > 0) {
      math = mathRange.OMaths.Item(1);
    } else if (inserted.OMaths && inserted.OMaths.Count > 0) {
      math = inserted.OMaths.Item(1);
    }

    if (!math) {
      inserted.Delete();
      throw Object.assign(
        new Error("WPS did not expose the created OMath object."),
        { code: "OMATH_CREATE_FAILED" },
      );
    }

    if (display && "Justification" in math) {
      math.Justification = 1;
    }

    if (typeof math.BuildUp === "function") {
      math.BuildUp();
    } else {
      inserted.Delete();
      throw Object.assign(
        new Error("WPS OMath BuildUp API is unavailable."),
        { code: "OMATH_BUILD_UNAVAILABLE" },
      );
    }

    return math.Range || mathRange || inserted;
  }

  // Minimal LaTeX → UnicodeMath converter for offline fallback.
  // Covers Greek letters, common symbols, and math-font commands.
  // Complex structures (\frac, \sqrt, \sum, \int, matrices) require
  // the Bridge-based OMML path for full fidelity.
  function latexToUnicodeMath(latex) {
    var greek = {
      "\\alpha": "\u03B1", "\\beta": "\u03B2", "\\gamma": "\u03B3",
      "\\delta": "\u03B4", "\\epsilon": "\u03B5", "\\zeta": "\u03B6",
      "\\eta": "\u03B7", "\\theta": "\u03B8", "\\iota": "\u03B9",
      "\\kappa": "\u03BA", "\\lambda": "\u03BB", "\\mu": "\u03BC",
      "\\nu": "\u03BD", "\\xi": "\u03BE", "\\pi": "\u03C0",
      "\\rho": "\u03C1", "\\sigma": "\u03C3", "\\tau": "\u03C4",
      "\\upsilon": "\u03C5", "\\phi": "\u03C6", "\\chi": "\u03C7",
      "\\psi": "\u03C8", "\\omega": "\u03C9",
      "\\Gamma": "\u0393", "\\Delta": "\u0394", "\\Theta": "\u0398",
      "\\Lambda": "\u039B", "\\Xi": "\u039E", "\\Pi": "\u03A0",
      "\\Sigma": "\u03A3", "\\Phi": "\u03A6", "\\Psi": "\u03A8",
      "\\Omega": "\u03A9",
    };

    var symbols = {
      "\\times": "\u00D7", "\\cdot": "\u22C5", "\\pm": "\u00B1",
      "\\infty": "\u221E", "\\partial": "\u2202", "\\nabla": "\u2207",
      "\\forall": "\u2200", "\\exists": "\u2203", "\\neg": "\u00AC",
      "\\rightarrow": "\u2192", "\\leftarrow": "\u2190",
      "\\Rightarrow": "\u21D2", "\\Leftarrow": "\u21D0",
      "\\mapsto": "\u21A6", "\\to": "\u2192", "\\sim": "\u223C",
      "\\approx": "\u2248", "\\equiv": "\u2261", "\\neq": "\u2260",
      "\\leq": "\u2264", "\\geq": "\u2265", "\\ll": "\u226A",
      "\\gg": "\u226B", "\\propto": "\u221D",
      "\\otimes": "\u2297", "\\oplus": "\u2295",
      "\\odot": "\u2299", "\\bullet": "\u2219",
    };

    var result = latex;

    // Replace commands (longest-match first)
    var all = {};
    var keys = [];
    var k;
    for (k in greek) { if (greek.hasOwnProperty(k)) all[k] = greek[k]; }
    for (k in symbols) { if (symbols.hasOwnProperty(k)) all[k] = symbols[k]; }
    for (k in all) { if (all.hasOwnProperty(k)) keys.push(k); }
    keys.sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < keys.length; i++) {
      result = result.split(keys[i]).join(all[keys[i]]);
    }

    // Convert \mathbf{...} etc. to UnicodeMath form (parentheses, not braces)
    var fontCommands = [
      "\\mathbf", "\\mathit", "\\mathsf", "\\mathtt",
      "\\mathcal", "\\mathbb", "\\mathfrak", "\\mathscr",
      "\\boldsymbol", "\\mathrm",
    ];

    for (var fi = 0; fi < fontCommands.length; fi++) {
      var fcmd = fontCommands[fi];
      var pattern = fcmd + "{";
      var idx = result.indexOf(pattern);
      while (idx !== -1) {
        var depth = 1;
        var close = idx + pattern.length;
        while (close < result.length && depth > 0) {
          if (result[close] === "{") depth++;
          else if (result[close] === "}") depth--;
          close++;
        }
        if (depth === 0) {
          var content = result.slice(idx + pattern.length, close - 1);
          var replacement;
          if (
            content.length <= 1 ||
            content.indexOf(" ") !== -1 ||
            content.indexOf("^") !== -1 ||
            content.indexOf("_") !== -1
          ) {
            replacement = fcmd + " " + content;
          } else {
            replacement = fcmd + "(" + content + ")";
          }
          result = result.slice(0, idx) + replacement + result.slice(close);
        } else {
          break;
        }
        idx = result.indexOf(pattern, idx + 1);
      }
    }

    return result;
  }

  function nextSequence(document) {
    var current = parseInt(getVariable(document, SEQUENCE_VARIABLE) || "0", 10);
    var next = isFinite(current) ? current + 1 : 1;
    if (!setVariable(document, SEQUENCE_VARIABLE, String(next))) {
      throw Object.assign(new Error("Equation sequence metadata is unavailable."), {
        code: "METADATA_UNAVAILABLE",
      });
    }
    return next;
  }

  function insertWriterNative(payload, existingMetadata) {
    var application = app();
    var document = application && application.ActiveDocument;
    if (!document) return failure("NO_ACTIVE_DOCUMENT", "No active WPS Writer document.");
    if (!documentMetadataAvailable(document)) {
      return failure(
        "METADATA_UNAVAILABLE",
        "This WPS Writer version cannot persist LaTeXSnipper formula ownership.",
      );
    }
    var selection = application.Selection;
    if (!selection || !selection.Range) {
      return failure("NO_SELECTION", "No Writer insertion range is available.");
    }
    var originalStart = selection.Range.Start;
    var originalEnd = selection.Range.End;
    var id = (existingMetadata && existingMetadata.formulaId) || payload.formulaId || formulaId();
    var mode = payload.mode || payload.display || "inline";
    var insertion = document.Range(originalStart, originalStart);

    // Merge all WPS API calls into a single undo step.
    // Without this, the user sees VBA-Range.InsertXML, VBA-Range.Text,
    // and VBA-OMaths.Add as separate undo entries.
    var undoRecord =
      application.UndoRecord ||
      (application.ActiveWindow && application.ActiveWindow.UndoRecord);
    if (undoRecord && typeof undoRecord.StartCustomRecord === "function") {
      undoRecord.StartCustomRecord("插入 LaTeXSnipper 公式");
    }
    function endUndoRecord() {
      if (undoRecord && typeof undoRecord.EndCustomRecord === "function") {
        try {
          undoRecord.EndCustomRecord();
        } catch (_e) {
          // Best-effort — UndoRecord may not be available in all WPS versions
        }
      }
    }

    function rollback(error) {
      try {
        var rollbackEnd = Math.max(originalStart, application.Selection.Range.End);
        document.Range(originalStart, rollbackEnd).Delete();
      } catch (_rollbackError) {
        logFailure("rollback-writer-insert", id, _rollbackError);
      }
      restoreRange(document, originalStart, originalEnd);
      return failure(error.code || "WRITER_INSERT_FAILED", error.message || String(error));
    }

    if (mode === "numbered") {
      // Wrap synchronous setup in Promise so UndoRecord.EndCustomRecord
      // is always called even if Tables.Add or column setup throws.
      return Promise.resolve().then(function () {
      var sequence =
        (existingMetadata && existingMetadata.sequence) || payload.sequence || nextSequence(document);
      var table = document.Tables.Add(insertion, 1, 3);
      table.Borders.Enable = 0;
      if ("AllowAutoFit" in table) table.AllowAutoFit = false;
      var page = document.PageSetup;
      var contentWidth =
        Number(page.PageWidth || 612) -
        Number(page.LeftMargin || 72) -
        Number(page.RightMargin || 72);
      var side = Math.max(48, contentWidth / 6);
      table.Columns.Item(1).Width = side;
      table.Columns.Item(2).Width = Math.max(96, contentWidth - side * 2);
      table.Columns.Item(3).Width = side;

      var equationCell = table.Cell(1, 2).Range;
      equationCell.Text = "";
      return addNativeMath(document, equationCell, payload.latex, true).then(
        function () {
          equationCell.ParagraphFormat.Alignment = 1;

          var numberCell = table.Cell(1, 3).Range;
          numberCell.Text = "(" + sequence + ")";
          numberCell.ParagraphFormat.Alignment = 2;
          var numberBookmark = bookmarkName(id, "_number");
          document.Bookmarks.Add(numberBookmark, numberCell);

          var ownedRange = table.Range;
          var ownedBookmark = bookmarkName(id);
          document.Bookmarks.Add(ownedBookmark, ownedRange);
          var numberedMetadata = {
            schema: "urn:latexsnipper:wps-formula:v1",
            schemaVersion: 1,
            formulaId: id,
            revision: Number((existingMetadata && existingMetadata.revision) || 0) + 1,
            latex: payload.latex,
            displayMode: "numbered",
            sequence: sequence,
            label: payload.label || null,
            bookmark: ownedBookmark,
            numberBookmark: numberBookmark,
          };
          saveMetadata(document, numberedMetadata);
          ownedRange.Collapse(0);
          ownedRange.Select();
          return { ok: true, data: numberedMetadata };
        },
      ).catch(function (error) {
        return rollback(error);
      }).then(function (result) {
        endUndoRecord();
        return result;
      }, function (error) {
        endUndoRecord();
        throw error;
      });
      });  // close Promise.resolve().then() wrapper
    }

    return addNativeMath(
      document,
      insertion,
      payload.latex,
      mode !== "inline",
    ).then(function (mathRange) {
      var bookmark = bookmarkName(id);
      document.Bookmarks.Add(bookmark, mathRange);
      var metadata = {
        schema: "urn:latexsnipper:wps-formula:v1",
        schemaVersion: 1,
        formulaId: id,
        revision: Number((existingMetadata && existingMetadata.revision) || 0) + 1,
        latex: payload.latex,
        displayMode: mode === "inline" ? "inline" : "block",
        bookmark: bookmark,
      };
      saveMetadata(document, metadata);
      mathRange.Collapse(0);
      mathRange.Select();
      return { ok: true, data: metadata };
    }).catch(function (error) {
      return rollback(error);
    }).then(function (result) {
      endUndoRecord();
      return result;
    }, function (error) {
      endUndoRecord();
      throw error;
    });
  }

  function writerRead() {
    var application = app();
    var document = application && application.ActiveDocument;
    if (!document) return failure("NO_ACTIVE_DOCUMENT", "No active WPS Writer document.");
    var metadata = selectedWriterMetadata(document, application.Selection.Range);
    return metadata
      ? { ok: true, data: metadata }
      : failure("NO_FORMULA_SELECTED", "Select a LaTeXSnipper-owned formula.");
  }

  function writerDelete() {
    var application = app();
    var document = application && application.ActiveDocument;
    if (!document) return failure("NO_ACTIVE_DOCUMENT", "No active WPS Writer document.");
    var metadata = selectedWriterMetadata(document, application.Selection.Range);
    if (!metadata) return failure("NO_FORMULA_SELECTED", "Select a LaTeXSnipper-owned formula.");
    try {
      document.Bookmarks.Item(metadata.bookmark).Range.Delete();
      removeMetadata(document, metadata.formulaId);
      return { ok: true, data: metadata };
    } catch (error) {
      return failure("WRITER_DELETE_FAILED", error.message || String(error));
    }
  }

  function writerUpdate(payload) {
    var application = app();
    var document = application && application.ActiveDocument;
    if (!document) return failure("NO_ACTIVE_DOCUMENT", "No active WPS Writer document.");
    var metadata = selectedWriterMetadata(document, application.Selection.Range);
    if (!metadata) return failure("NO_FORMULA_SELECTED", "Select a LaTeXSnipper-owned formula.");
    var originalIndex = metadataIndex(document);
    var originalRange;
    var originalStart;
    var originalEnd;
    try {
      originalRange = document.Bookmarks.Item(metadata.bookmark).Range;
      originalStart = originalRange.Start;
      originalEnd = originalRange.End;
    } catch (_e) {
      return failure("BOOKMARK_STALE", "The formula bookmark is no longer valid.");
    }
    document.Range(originalEnd, originalEnd).Select();

    var candidateId = formulaId();
    var candidateMetadata = null;  // outer scope for catch cleanup

    // insertWriterNative returns a Promise since addNativeMath is async.
    // Chain the entire candidate-first transaction as a Promise.
    return insertWriterNative({
      formulaId: candidateId,
      latex: payload.latex,
      mode: payload.mode || metadata.displayMode,
      sequence: metadata.sequence,
      label: metadata.label,
    }).then(function (candidate) {
      if (!candidate || !candidate.ok) {
        restoreRange(document, originalStart, originalEnd);
        return candidate;
      }
      candidateMetadata = candidate.data;

      var candidateRange;
      try {
        candidateRange = document.Bookmarks.Item(candidateMetadata.bookmark).Range;
      } catch (_crError) {
        throw Object.assign(new Error("Candidate bookmark is unreadable."), {
          code: "CANDIDATE_VALIDATION_FAILED",
        });
      }
      if (!candidateRange || candidateRange.End <= candidateRange.Start) {
        throw Object.assign(new Error("Candidate formula could not be read back."), {
          code: "CANDIDATE_VALIDATION_FAILED",
        });
      }

      var finalMetadata = {
        formulaId: metadata.formulaId,
        latex: payload.latex,
        displayMode: candidateMetadata.displayMode,
        sequence: candidateMetadata.sequence,
        label: metadata.label || null,
        bookmark: candidateMetadata.bookmark,
        numberBookmark: candidateMetadata.numberBookmark || null,
        schema: "urn:latexsnipper:wps-formula:v1",
        schemaVersion: 1,
        revision: Number(metadata.revision || 0) + 1,
      };
      var stagedIndex = metadataIndex(document).filter(function (item) {
        return (
          item.formulaId !== metadata.formulaId &&
          item.formulaId !== candidateMetadata.formulaId
        );
      });
      stagedIndex.push(finalMetadata);
      if (!setVariable(document, INDEX_VARIABLE, JSON.stringify(stagedIndex))) {
        throw Object.assign(new Error("Candidate metadata could not be staged."), {
          code: "METADATA_UNAVAILABLE",
        });
      }
      var verified = metadataIndex(document).filter(function (item) {
        return item.formulaId === metadata.formulaId;
      })[0];
      if (!verified || verified.bookmark !== candidateMetadata.bookmark) {
        throw Object.assign(new Error("Candidate metadata readback failed."), {
          code: "METADATA_READBACK_FAILED",
        });
      }

      // Commit only after the candidate and its ownership metadata are readable.
      document.Range(originalStart, originalEnd).Delete();
      try {
        candidateRange.Select();
      } catch (selectionError) {
        logFailure("select-writer-replacement", metadata.formulaId, selectionError);
      }
      return { ok: true, data: finalMetadata };
    }).catch(function (error) {
      logFailure("candidate-first-writer-update", metadata.formulaId, error);
      if (candidateMetadata && candidateMetadata.bookmark) {
        try {
          document.Bookmarks.Item(candidateMetadata.bookmark).Range.Delete();
        } catch (cleanupError) {
          logFailure("cleanup-writer-candidate", metadata.formulaId, cleanupError);
        }
      }
      if (!setVariable(document, INDEX_VARIABLE, JSON.stringify(originalIndex))) {
        logFailure(
          "restore-writer-metadata",
          metadata.formulaId,
          new Error("Document variable restore failed."),
        );
      }
      restoreRange(document, originalStart, originalEnd);
      return failure(error.code || "WRITER_UPDATE_FAILED", error.message || String(error));
    });
  }

  function writerRenumber() {
    var application = app();
    var document = application && application.ActiveDocument;
    if (!document) return failure("NO_ACTIVE_DOCUMENT", "No active WPS Writer document.");
    var numbered = metadataIndex(document)
      .filter(function (item) {
        return item.displayMode === "numbered" && item.numberBookmark;
      })
      .map(function (item) {
        try {
          item.position = document.Bookmarks.Item(item.bookmark).Range.Start;
          return item;
        } catch (_error) {
          return null;
        }
      })
      .filter(Boolean)
      .sort(function (left, right) {
        return left.position - right.position;
      });
    try {
      numbered.forEach(function (item, index) {
        item.sequence = index + 1;
        document.Bookmarks.Item(item.numberBookmark).Range.Text = "(" + item.sequence + ")";
      });
      var all = metadataIndex(document).filter(function (item) {
        return item.displayMode !== "numbered";
      });
      setVariable(document, INDEX_VARIABLE, JSON.stringify(all.concat(numbered)));
      setVariable(document, SEQUENCE_VARIABLE, String(numbered.length));
      return { ok: true, data: { count: numbered.length } };
    } catch (error) {
      return failure("RENUMBER_FAILED", error.message || String(error));
    }
  }

  function encodeShapeMetadata(metadata) {
    return METADATA_PREFIX + encodeURIComponent(JSON.stringify(metadata));
  }

  function decodeShapeMetadata(shape) {
    var raw = "";
    try {
      raw = String(shape.AlternativeText || "");
    } catch (_error) {
      try {
        raw = String(shape.Description || "");
      } catch (_descriptionError) {
        return null;
      }
    }
    if (raw.indexOf(METADATA_PREFIX) !== 0) return null;
    try {
      return JSON.parse(decodeURIComponent(raw.slice(METADATA_PREFIX.length)));
    } catch (_error) {
      return null;
    }
  }

  function setShapeMetadata(shape, metadata) {
    var encoded = encodeShapeMetadata(metadata);
    try {
      shape.Name = "LaTeXSnipper_" + metadata.formulaId;
    } catch (_error) {
      return false;
    }
    try {
      shape.AlternativeText = encoded;
      return true;
    } catch (_error) {
      try {
        shape.Description = encoded;
        return true;
      } catch (_descriptionError) {
        return false;
      }
    }
  }

  function selectedShape(application) {
    var candidates = [];
    try {
      candidates.push(application.Selection);
    } catch (_error) {
      logFailure("read-application-selection", null, _error);
    }
    try {
      candidates.push(application.ActiveWindow.Selection);
    } catch (_error) {
      logFailure("read-active-window-selection", null, _error);
    }
    for (var i = 0; i < candidates.length; i += 1) {
      var selection = candidates[i];
      try {
        if (selection.ShapeRange) return selection.ShapeRange.Item(1);
      } catch (_shapeRangeError) {
        logFailure("read-shape-range", null, _shapeRangeError);
      }
      try {
        if (selection.Type && selection.Item) return selection.Item(1);
      } catch (_itemError) {
        logFailure("read-selection-item", null, _itemError);
      }
    }
    return null;
  }

  function renderImage(payload) {
    return window.WpsBridgeClient.convert(payload.latex, "block", "png").then(function (rendered) {
      var id = payload.formulaId || formulaId();
      return window.WpsBridgeClient.createTempAsset("png", rendered.content, id).then(function (asset) {
        return { id: id, rendered: rendered, asset: asset };
      });
    });
  }

  function spreadsheetInsert(payload, existing) {
    var application = app();
    if (!application || !application.ActiveWorkbook) {
      return Promise.resolve(failure("NO_ACTIVE_WORKBOOK", "No active WPS workbook."));
    }
    var sheet = application.ActiveSheet;
    if (!sheet) return Promise.resolve(failure("NO_ACTIVE_SHEET", "No active worksheet."));
    if (!sheet.Shapes || typeof sheet.Shapes.AddPicture !== "function") {
      return Promise.resolve(failure("SHAPE_API_UNAVAILABLE", "Worksheet picture API is unavailable."));
    }
    return renderImage(payload)
      .then(function (image) {
        var anchor = application.Selection;
        var left = existing ? existing.left : Number(anchor.Left || 0);
        var top = existing ? existing.top : Number(anchor.Top || 0);
        var width = existing && !payload.naturalSize ? existing.width : image.rendered.widthPt;
        var height = existing && !payload.naturalSize ? existing.height : image.rendered.heightPt;
        var shape = sheet.Shapes.AddPicture(image.asset.path, false, true, left, top, width, height);
        try {
          if ("LockAspectRatio" in shape) shape.LockAspectRatio = true;
          if ("Placement" in shape) shape.Placement = 1;
          if (existing && isFinite(existing.rotation) && "Rotation" in shape) {
            shape.Rotation = existing.rotation;
          }
        } catch (_error) {
          logFailure("configure-spreadsheet-shape", image.id, _error);
        }
        var metadata = {
          schema: "urn:latexsnipper:wps-formula:v1",
          schemaVersion: 1,
          formulaId: image.id,
          revision: Number((existing && existing.metadata && existing.metadata.revision) || 0) + 1,
          latex: payload.latex,
          displayMode: "block",
          host: "et",
          anchoring: "active-cell",
        };
        if (!setShapeMetadata(shape, metadata)) {
          try {
            shape.Delete();
          } catch (_error) {
            logFailure("cleanup-spreadsheet-candidate", image.id, _error);
          }
          throw Object.assign(new Error("Shape metadata is unavailable."), {
            code: "METADATA_UNAVAILABLE",
          });
        }
        var verified = decodeShapeMetadata(shape);
        if (!verified || verified.formulaId !== image.id) {
          try {
            shape.Delete();
          } catch (cleanupError) {
            logFailure("cleanup-spreadsheet-candidate", image.id, cleanupError);
          }
          throw Object.assign(new Error("Shape metadata readback failed."), {
            code: "METADATA_READBACK_FAILED",
          });
        }
        return window.WpsBridgeClient
          .deleteTempAsset(image.asset.assetId)
          .catch(function (cleanupError) {
            logFailure("delete-spreadsheet-temp-asset", image.id, cleanupError);
          })
          .then(function () {
            return { ok: true, data: metadata, candidateShape: shape };
          });
      })
      .catch(function (error) {
        return failure(error.code || "BRIDGE_OFFLINE", error.message || String(error));
      });
  }

  function presentationSlide(application) {
    try {
      return application.ActiveWindow.View.Slide;
    } catch (_error) {
      return null;
    }
  }

  function presentationInsert(payload, existing) {
    var application = app();
    if (!application || !application.ActivePresentation) {
      return Promise.resolve(
        failure("NO_ACTIVE_PRESENTATION", "No active WPS presentation."),
      );
    }
    var slide = presentationSlide(application);
    if (!slide) return Promise.resolve(failure("NO_ACTIVE_SLIDE", "No active slide."));
    if (!slide.Shapes || typeof slide.Shapes.AddPicture !== "function") {
      return Promise.resolve(failure("SHAPE_API_UNAVAILABLE", "Slide picture API is unavailable."));
    }
    return renderImage(payload)
      .then(function (image) {
        var setup = application.ActivePresentation.PageSetup;
        var slideWidth = Number(setup.SlideWidth);
        var slideHeight = Number(setup.SlideHeight);
        if (!isFinite(slideWidth) || !isFinite(slideHeight)) {
          throw Object.assign(new Error("Slide bounds are unavailable."), {
            code: "NO_ACTIVE_SLIDE",
          });
        }
        var inset = 24;
        var width = existing && !payload.naturalSize ? existing.width : image.rendered.widthPt;
        var height = existing && !payload.naturalSize ? existing.height : image.rendered.heightPt;
        var left = existing ? existing.left : Math.max(inset, (slideWidth - width) / 2);
        var top = existing ? existing.top : Math.max(inset, (slideHeight - height) / 2);
        var shape = slide.Shapes.AddPicture(image.asset.path, false, true, left, top, width, height);
        try {
          if ("LockAspectRatio" in shape) shape.LockAspectRatio = true;
          if (existing && isFinite(existing.rotation) && "Rotation" in shape) {
            shape.Rotation = existing.rotation;
          }
        } catch (_error) {
          logFailure("configure-presentation-shape", image.id, _error);
        }
        var metadata = {
          schema: "urn:latexsnipper:wps-formula:v1",
          schemaVersion: 1,
          formulaId: image.id,
          revision: Number((existing && existing.metadata && existing.metadata.revision) || 0) + 1,
          latex: payload.latex,
          displayMode: "block",
          host: "wpp",
        };
        if (!setShapeMetadata(shape, metadata)) {
          try {
            shape.Delete();
          } catch (_error) {
            logFailure("cleanup-presentation-candidate", image.id, _error);
          }
          throw Object.assign(new Error("Shape metadata is unavailable."), {
            code: "METADATA_UNAVAILABLE",
          });
        }
        var verified = decodeShapeMetadata(shape);
        if (!verified || verified.formulaId !== image.id) {
          try {
            shape.Delete();
          } catch (cleanupError) {
            logFailure("cleanup-presentation-candidate", image.id, cleanupError);
          }
          throw Object.assign(new Error("Shape metadata readback failed."), {
            code: "METADATA_READBACK_FAILED",
          });
        }
        return window.WpsBridgeClient
          .deleteTempAsset(image.asset.assetId)
          .catch(function (cleanupError) {
            logFailure("delete-presentation-temp-asset", image.id, cleanupError);
          })
          .then(function () {
            return { ok: true, data: metadata, candidateShape: shape };
          });
      })
      .catch(function (error) {
        return failure(error.code || "BRIDGE_OFFLINE", error.message || String(error));
      });
  }

  function imageRead() {
    var shape = selectedShape(app());
    if (!shape) return failure("NO_FORMULA_SELECTED", "Select a LaTeXSnipper formula image.");
    var metadata = decodeShapeMetadata(shape);
    return metadata
      ? { ok: true, data: metadata }
      : failure("NO_FORMULA_SELECTED", "The selected shape is not owned by LaTeXSnipper.");
  }

  function imageDelete() {
    var shape = selectedShape(app());
    if (!shape || !decodeShapeMetadata(shape)) {
      return failure("NO_FORMULA_SELECTED", "Select a LaTeXSnipper formula image.");
    }
    try {
      shape.Delete();
      return { ok: true };
    } catch (error) {
      return failure("SHAPE_DELETE_FAILED", error.message || String(error));
    }
  }

  function imageUpdate(payload, insert) {
    var shape = selectedShape(app());
    var metadata = shape && decodeShapeMetadata(shape);
    if (!shape || !metadata) {
      return Promise.resolve(
        failure("NO_FORMULA_SELECTED", "Select a LaTeXSnipper formula image."),
      );
    }
    var existing = {
      left: Number(shape.Left),
      top: Number(shape.Top),
      width: Number(shape.Width),
      height: Number(shape.Height),
      rotation: Number(shape.Rotation || 0),
      metadata: metadata,
    };
    payload.formulaId = metadata.formulaId;
    return insert(payload, existing).then(function (result) {
      if (!result.ok) return result;
      try {
        shape.Delete();
      } catch (error) {
        logFailure("delete-original-image-after-candidate", metadata.formulaId, error);
        try {
          if (result.candidateShape) result.candidateShape.Delete();
        } catch (cleanupError) {
          logFailure("cleanup-image-candidate", metadata.formulaId, cleanupError);
        }
        return failure(
          "ORIGINAL_DELETE_FAILED",
          error.message || String(error),
        );
      }
      delete result.candidateShape;
      return result;
    });
  }

  var writerAdapter = {
    capabilities: {
      host: "wps",
      insertFormula: true,
      readFormula: true,
      updateFormula: true,
      deleteFormula: true,
      numberedEquation: true,
      imageFormula: false,
      nativeMath: true,
    },
    execute: function (command) {
      switch (command.type) {
        case "InsertFormula":
          return insertWriterNative(command.payload || {});
        case "ReadFormula":
        case "GetSelection":
          return writerRead();
        case "UpdateFormula":
        case "ReplaceSelection":
          return writerUpdate(command.payload || {});
        case "DeleteFormula":
          return writerDelete();
        case "RenumberEquations":
          return writerRenumber();
        case "OpenEditor":
        case "OpenSettings":
          return showTaskPane();
        default:
          return failure("UNSUPPORTED_COMMAND", "Unsupported Writer command: " + command.type);
      }
    },
  };

  var spreadsheetAdapter = {
    capabilities: {
      host: "et",
      insertFormula: true,
      readFormula: true,
      updateFormula: true,
      deleteFormula: true,
      numberedEquation: false,
      imageFormula: true,
      nativeMath: false,
    },
    execute: function (command) {
      switch (command.type) {
        case "InsertFormula":
          return spreadsheetInsert(command.payload || {});
        case "ReadFormula":
        case "GetSelection":
          return imageRead();
        case "UpdateFormula":
        case "ReplaceSelection":
          return imageUpdate(command.payload || {}, spreadsheetInsert);
        case "DeleteFormula":
          return imageDelete();
        case "OpenEditor":
        case "OpenSettings":
          return showTaskPane();
        default:
          return failure("UNSUPPORTED_COMMAND", "Unsupported Spreadsheets command: " + command.type);
      }
    },
  };

  var presentationAdapter = {
    capabilities: {
      host: "wpp",
      insertFormula: true,
      readFormula: true,
      updateFormula: true,
      deleteFormula: true,
      numberedEquation: false,
      imageFormula: true,
      nativeMath: false,
    },
    execute: function (command) {
      switch (command.type) {
        case "InsertFormula":
          return presentationInsert(command.payload || {});
        case "ReadFormula":
        case "GetSelection":
          return imageRead();
        case "UpdateFormula":
        case "ReplaceSelection":
          return imageUpdate(command.payload || {}, presentationInsert);
        case "DeleteFormula":
          return imageDelete();
        case "OpenEditor":
        case "OpenSettings":
          return showTaskPane();
        default:
          return failure("UNSUPPORTED_COMMAND", "Unsupported Presentation command: " + command.type);
      }
    },
  };

  function showTaskPane() {
    try {
      var application = app();
      var paneId = application.PluginStorage.getItem("taskpane_id");
      if (!paneId) {
        var pane = application.CreateTaskPane(GetUrlPath() + "/ui/taskpane.html");
        paneId = pane.ID;
        application.PluginStorage.setItem("taskpane_id", paneId);
        pane.Visible = true;
      } else {
        var existing = application.GetTaskPane(paneId);
        existing.Visible = !existing.Visible;
      }
      return { ok: true };
    } catch (error) {
      return failure("TASKPANE_UNAVAILABLE", error.message || String(error));
    }
  }

  window.CommandLayer.registerAdapter("wps-writer", writerAdapter);
  window.CommandLayer.registerAdapter("wps-spreadsheets", spreadsheetAdapter);
  window.CommandLayer.registerAdapter("wps-presentation", presentationAdapter);
})();

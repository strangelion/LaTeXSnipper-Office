# Platform capability architecture

LaTeXSnipper uses one domain UI and negotiates platform/host capabilities through
`src/platform/platform-context.js`, adapters, and `feature-registry.js`. Business
features resolve `formula.insert`, `table.insert`, or `document.insert` through
the registry; they do not scatter operating-system checks through workflow code.

Capability levels are `unsupported`, `available`, `experimental`,
`requiresSetup`, and `blocked`. `experimental` is never presented as stable.
Runtime/provider availability is sourced only from Core `EngineReadiness`.
Library files, directories, `CUDA_PATH`, and the operating system are installation
hints and never prove that a session or smoke inference works.

| Context | Native implementation | Explicit downgrade |
| --- | --- | --- |
| Windows Word | VSTO, OMML, ContentControl, Native OLE, Named Pipe | None when Core/handler contracts pass |
| Windows Excel | Anchored shape and Native OLE | No Word OMML/numbering controls |
| Windows PowerPoint | Slide shape and Native OLE | No Word OMML/selection semantics |
| macOS Office | Office.js OOXML/text/image through HTTPS Bridge | No COM, registry, Named Pipe, or Native OLE |
| Linux desktop | X11 capture or Wayland portal | No COM/OLE; Office insertion unsupported |
| WPS Writer | JSAddIn OMath path, experimental lifecycle | No Native OLE |
| WPS Spreadsheets/Presentation | Package may connect to the Bridge | Formula lifecycle remains unsupported |
| Obsidian | Markdown/LaTeX adapter | No Office selection, OMML, or OLE |
| Browser import | Browser action adapter | No direct Office mutation |

Settings have formal `global`, `os`, `host`, `document`, and `session` scopes.
Resolution proceeds from session to global. Legacy flat settings can be copied
to a scoped key without discarding the old value; the screenshot auto-insert
legacy key is preserved when explicitly present, while a new installation
defaults to disabled.

Screenshot capture retains the physical RGBA image in Rust for the final crop.
Each overlay receives a temporary JPEG preview whose longest edge is at most
2560 pixels through Tauri's scoped asset protocol. Preview coordinates are
mapped back to physical pixels before commit. Job source files use a 24-hour,
512 MiB oldest-first lease policy and are deleted after recognition completes,
fails, or is cancelled.

OLE vector previews must satisfy both geometry and ink integrity. The handler
checks the SVG viewBox and element counts, validates EMF records/frame/bounds,
counts drawing records, renders an independent bitmap oracle, checks non-empty
ink bounds and coverage, and enforces a 2% frame/oracle aspect-ratio limit.
Failure returns to the existing PNG-to-EMF compatibility route.

Existing OLE objects retain their cached presentation. Opening an old document
does not silently re-render or upgrade those objects; edit/regenerate the object
explicitly after installing the new handler.

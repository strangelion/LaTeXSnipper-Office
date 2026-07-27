# RC2 runtime, screenshot, and OLE diagnostics

## Recognition

The Recognition settings page audits capabilities, runtimes, installed models, and readiness independently. A failure in one area does not suppress the other results. Readiness is a non-loading audit: it does not initialize the recognition engine or every model.

Stable error codes include `CAPABILITY_TIMEOUT`, `RUNTIME_LIST_TIMEOUT`, `MODEL_LIST_TIMEOUT`, `READINESS_TIMEOUT`, `RUNTIME_PROBE_TIMEOUT`, `RUNTIME_OPEN_DIRECTORY_FAILED`, `MODEL_PACKAGE_INCOMPATIBLE`, `MODEL_IMPORT_FAILED`, and `MODEL_REMOVE_FAILED`.

The screenshot auto-insert setting is user-owned. The effective value is true only when an Office session requested the capture, the user setting is enabled, and the protocol request enables auto-insert.

## Screenshot transaction

Only one screenshot session may be active. `screenshot_begin` reserves it before hiding the main window, captures all monitors, writes every frame into the session, creates hidden overlays, and waits up to three seconds for every overlay to decode its preview and report ready. Only then are overlays shown.

All begin/commit failures close created overlays, remove or release the session, restore and focus the main window, and emit `screenshot://failed`. The event contains `operationId`, `stage`, `host`, `sessionId`, `elapsedMs`, `success`, `errorCode`, and `errorMessage`.

Permission and backend failures surface as stable `SCREENSHOT_*` codes. `SCREENSHOT_ALREADY_ACTIVE` rejects concurrent begin calls.

## Native Office OLE

OLE status reports the active registry view, `InprocServer32`, registered file hash/version, expected install path/hash/version, and whether the registered handler matches the current installation. A desktop process does not guess what module an already-running Office process loaded; after an upgrade, fully exit all `WINWORD`, `EXCEL`, and `POWERPNT` processes.

New OLE objects expose `GetDiagnosticsJson`, including preview route, render point dimensions, SVG viewBox, EMF frame/bounds/record counts, natural/display/last-set extents, last draw bounds, and handler path/version. Word persists this diagnostic after insertion.

Word treats geometry as a closed contract. OLE extent and Word `InlineShape` dimensions must be within 0.75 pt of the requested size, and aspect ratio error must be at most 2%. A mismatch deletes the candidate and returns `OLE_GEOMETRY_CONTRACT_FAILED`; it is never silently reported as success.

Vector EMF routes remain conditional on header, record, frame, and bounds validation. PNG-to-EMF remains the reliable editable fallback because the payload retains LaTeX, SVG, dimensions, and diagnostics.

Old objects keep their cached presentation until explicitly edited or regenerated. This release does not claim that opening an old document automatically repairs old OLE presentations.

# Browser companion architecture

The Chrome and Firefox builds share one source tree. Page access is user-triggered through `activeTab` and `scripting`; provider origins are optional permissions. The extension reads visible DOM only and sends versioned `ImportWebFormula` or `ImportConversationSelection` actions to the local HTTP Bridge on port 19877.

All browser-originated content returns to the desktop before Office/WPS insertion. The extension never calls COM, VSTO, OLE, Office.js document APIs, WPS APIs, or emits OOXML. The desktop validates and previews the neutral AST, binds an exact host session/document, creates a trusted target plan, and commits through the selected adapter. Port 19876 remains HTTPS-only for Office.js and Native Office remains on the authenticated Named Pipe.

Desktop-to-browser insertion is a separate direction using `InsertFormulaIntoBrowser` or `ReplaceBrowserSelection`; it never submits the editor.

# Conversation import security boundary

Browser HTML, DOM nodes, selectors, scripts, event handlers, provider state, and OOXML are not accepted by the Word import model. Rust validates schema version, total bytes, message IDs/roles, operation count, text, formulas, table geometry, and HTTP/HTTPS/mailto links. Formula OMML is generated locally; the Word adapter rejects package relationships, scripts, and doctypes.

Preview and planning never mutate Word. Commit requires the same connected Word session and document identity captured during preview. Unsupported destinations fail before dispatch with a structured error.

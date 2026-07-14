# Advanced read scope

Supported modes are selection-only, current message, current assistant message, visible conversation, loaded conversation, last N, selected range, custom container, and formula-only. Role/content filters and per-site overrides are versioned and bounded.

Defaults are 20 messages, 50,000 characters, 100 formulas, 512 KiB code, 2,000 table cells, and 50,000 scanned nodes. Hard ceilings are enforced again by the desktop. Virtualized history is reported as truncated; loaded conversation never implies complete remote history.

# Browser privacy and permissions

The default scope is `selection-only`. No provider origin is granted persistently at install time. Optional access must follow a user gesture, private browsing is disabled, and transient extraction is cleared with the UI/tab lifecycle.

Only visible rendered content is processed. The extension does not inspect cookies, credentials, private APIs, hidden reasoning, provider state, password fields, or remote attachments. It does not auto-scroll history or send extracted data until the user confirms the preview. Production logs contain operation codes, never full conversation text.

Custom scopes accept bounded CSS selectors only. JavaScript, token/password selectors, remote selector downloads, and untrusted `innerHTML` rendering are rejected.

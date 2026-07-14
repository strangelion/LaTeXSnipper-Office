# Browser testing and live-site checklist

CI runs TypeScript checking, provider/formula/scope/insertion fixtures, both production builds, manifest/CSP/provenance validation, and incomplete-package rejection. Synthetic fixtures contain no private conversations.

Before a provider is marked Stable, manually verify permission request, detection, current/visible/loaded scope, roles, inline/display formulas, code, table, streaming stabilization, composer insertion, and absence of automatic submission. ChatGPT, Gemini, and DeepSeek require live verification for Stable. No live provider verification is recorded by this change.

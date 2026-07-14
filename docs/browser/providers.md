# Provider capability matrix

ChatGPT, Gemini, DeepSeek, Claude, Copilot, Kimi, Doubao, Qwen, and Yuanbao have independent DOM adapters and synthetic fixtures. Perplexity, Grok, Wenxin, and Zhipu use dedicated but explicitly `limited` adapters. Every adapter prefers semantic/data/ARIA selectors, reports the matched strategy, and degrades to selection-only when its audited roots fail.

All adapters are currently fixture-verified, not live-site verified. Therefore none is reported Stable. A provider may be promoted only after the checklist in `testing.md` is run against the live official site.

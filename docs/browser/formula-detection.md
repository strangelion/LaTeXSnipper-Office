# Formula detection

The bounded scanner handles dollar/paren/bracket delimiters and equation, align, gather, multline, and cases environments. It skips escaped dollars, Markdown code, malformed delimiters, and common currency patterns. DOM extraction prefers KaTeX annotations, MathJax source attributes/scripts, and native MathML. MathML is retained as MathML and marked for desktop conversion rather than mislabeled as LaTeX.

Candidates retain raw source, normalized LaTeX when available, renderer, confidence, display mode, message origin, page URL, context, and element fingerprint. Identical formulas in different messages remain distinct for conversation-preserving export.

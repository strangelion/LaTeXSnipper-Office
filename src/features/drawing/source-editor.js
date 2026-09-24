import { autocompletion } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { xml } from "@codemirror/lang-xml";
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import {
  getChunks,
  presentableDiff,
  unifiedMergeView,
} from "@codemirror/merge";
import {
  highlightSelectionMatches,
  openSearchPanel,
  searchKeymap,
} from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

const SOURCE_LANGUAGE_NAMES = Object.freeze({
  svg_source: "SVG / XML",
  tikz: "TikZ / LaTeX",
  pgf_plots: "PGFPlots / LaTeX",
  graphviz_dot: "Graphviz DOT",
  mermaid: "Mermaid",
});

const COMPLETIONS = Object.freeze({
  svg_source: [
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "defs",
    "marker",
  ],
  tikz: [
    "\\draw",
    "\\node",
    "\\path",
    "\\coordinate",
    "\\fill",
    "\\filldraw",
    "\\begin{scope}",
    "\\end{scope}",
  ],
  pgf_plots: [
    "\\begin{axis}",
    "\\end{axis}",
    "\\addplot",
    "\\addlegendentry",
    "\\legend",
    "xlabel",
    "ylabel",
    "domain",
    "samples",
  ],
  graphviz_dot: [
    "digraph",
    "graph",
    "subgraph",
    "node",
    "edge",
    "label",
    "shape",
    "rankdir",
    "color",
  ],
  mermaid: [
    "flowchart",
    "graph",
    "sequenceDiagram",
    "classDiagram",
    "stateDiagram-v2",
    "subgraph",
    "end",
    "style",
    "classDef",
  ],
});

function relationLanguage() {
  return StreamLanguage.define({
    startState: () => ({ blockComment: false }),
    token(stream, state) {
      if (state.blockComment) {
        if (stream.skipTo("*/")) {
          stream.match("*/");
          state.blockComment = false;
        } else {
          stream.skipToEnd();
        }
        return "comment";
      }
      if (stream.match("/*")) {
        state.blockComment = true;
        return "comment";
      }
      if (stream.match(/^\s+/)) return null;
      if (stream.match(/^\/\/.*$/) || stream.match(/^#.*$/)) return "comment";
      if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return "string";
      if (stream.match(/^-?\d+(?:\.\d+)?/)) return "number";
      if (
        stream.match(
          /^(?:strict|digraph|graph|subgraph|node|edge|flowchart|sequenceDiagram|classDiagram|stateDiagram-v2|subgraph|end|style|classDef)\b/,
        )
      )
        return "keyword";
      if (stream.match(/^(?:-->|---|-.->|==>|->|--|:::)\|?/)) return "operator";
      if (stream.match(/^[A-Za-z_][\w-]*/)) return "variableName";
      if (stream.match(/^[\[\]{}()<>|:=;,]+/)) return "punctuation";
      stream.next();
      return null;
    },
  });
}

const latexLanguage = StreamLanguage.define(stex);
const graphLanguage = relationLanguage();

function languageExtension(profile) {
  if (profile === "svg_source") return xml();
  if (profile === "tikz" || profile === "pgf_plots") return latexLanguage;
  return graphLanguage;
}

function completionSource(getProfile) {
  return (context) => {
    const match = context.matchBefore(/[\\\w-]*/);
    if (!match || (!context.explicit && match.from === match.to)) return null;
    return {
      from: match.from,
      options: (COMPLETIONS[getProfile()] || []).map((label) => ({
        label,
        type: label.startsWith("\\") ? "function" : "keyword",
      })),
    };
  };
}

const sourceHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier], color: "var(--code-keyword)" },
  { tag: [tags.name, tags.variableName], color: "var(--code-name)" },
  { tag: [tags.tagName, tags.typeName], color: "var(--code-type)" },
  {
    tag: [tags.attributeName, tags.propertyName],
    color: "var(--code-property)",
  },
  {
    tag: [tags.string, tags.special(tags.string)],
    color: "var(--code-string)",
  },
  { tag: [tags.number, tags.bool], color: "var(--code-number)" },
  {
    tag: [tags.comment, tags.docComment],
    color: "var(--code-comment)",
    fontStyle: "italic",
  },
  { tag: [tags.operator, tags.punctuation], color: "var(--code-operator)" },
  {
    tag: tags.invalid,
    color: "var(--code-error)",
    textDecoration: "underline wavy",
  },
]);

export function sourceLanguageName(profile) {
  return SOURCE_LANGUAGE_NAMES[profile] || String(profile || "源码");
}

export function summarizeSourceDiff(original, current) {
  const changes = presentableDiff(
    String(original || ""),
    String(current || ""),
    {
      scanLimit: 1000,
      timeout: 120,
    },
  );
  return {
    changed: changes.length > 0,
    changes: changes.length,
    addedCharacters: changes.reduce(
      (total, change) => total + (change.toB - change.fromB),
      0,
    ),
    removedCharacters: changes.reduce(
      (total, change) => total + (change.toA - change.fromA),
      0,
    ),
  };
}

export function createDrawingSourceEditor({
  textarea,
  host,
  languageLabel,
  diffToggle,
  snapshotButton,
  diffStatus,
  initialProfile = "svg_source",
}) {
  if (!textarea || !host) return null;

  let profile = initialProfile;
  let synchronizing = false;
  let diffEnabled = true;
  const baselines = new Map([[profile, textarea.value]]);
  const language = new Compartment();
  const diff = new Compartment();

  const baseline = () => baselines.get(profile) ?? "";
  const diffExtension = () =>
    diffEnabled
      ? unifiedMergeView({
          original: baseline(),
          highlightChanges: true,
          gutter: true,
          allowInlineDiffs: true,
          mergeControls: false,
          syntaxHighlightDeletions: true,
          diffConfig: { scanLimit: 1000, timeout: 120 },
        })
      : [];

  const updateStatus = (view) => {
    if (languageLabel) languageLabel.textContent = sourceLanguageName(profile);
    if (!diffStatus) return;
    const summary = summarizeSourceDiff(baseline(), view.state.doc.toString());
    const chunks = diffEnabled ? getChunks(view.state)?.chunks?.length : 0;
    diffStatus.textContent = summary.changed
      ? `相对基线：${chunks || summary.changes} 处修改，+${summary.addedCharacters} / -${summary.removedCharacters}`
      : "与基线一致";
    diffStatus.dataset.state = summary.changed ? "changed" : "clean";
  };

  const state = EditorState.create({
    doc: textarea.value,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentUnit.of("  "),
      bracketMatching(),
      codeFolding(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      syntaxHighlighting(sourceHighlightStyle),
      autocompletion({ override: [completionSource(() => profile)] }),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        "aria-label": "绘图源码编辑器",
        "aria-multiline": "true",
        spellcheck: "false",
      }),
      language.of(languageExtension(profile)),
      diff.of(diffExtension()),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !synchronizing) {
          textarea.value = update.state.doc.toString();
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (
          update.docChanged ||
          update.transactions.some((item) => item.reconfigured)
        ) {
          updateStatus(update.view);
        }
      }),
    ],
  });

  const view = new EditorView({ state, parent: host });
  textarea.hidden = true;
  updateStatus(view);

  const setValue = (
    value,
    { nextProfile = profile, resetBaseline = false } = {},
  ) => {
    const text = String(value ?? "");
    profile = nextProfile;
    if (resetBaseline || !baselines.has(profile)) baselines.set(profile, text);
    synchronizing = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      effects: [
        language.reconfigure(languageExtension(profile)),
        diff.reconfigure(diffExtension()),
      ],
    });
    synchronizing = false;
    textarea.value = text;
    updateStatus(view);
  };

  diffToggle?.addEventListener("click", () => {
    diffEnabled = !diffEnabled;
    diffToggle.setAttribute("aria-pressed", String(diffEnabled));
    diffToggle.textContent = diffEnabled ? "隐藏差异" : "显示差异";
    view.dispatch({ effects: diff.reconfigure(diffExtension()) });
    updateStatus(view);
  });
  snapshotButton?.addEventListener("click", () => {
    baselines.set(profile, view.state.doc.toString());
    view.dispatch({ effects: diff.reconfigure(diffExtension()) });
    updateStatus(view);
  });

  return {
    getValue: () => view.state.doc.toString(),
    setValue,
    setProfile(nextProfile, value, options = {}) {
      setValue(value, { ...options, nextProfile });
    },
    replaceSelection(text) {
      const range = view.state.selection.main;
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: String(text) },
        selection: { anchor: range.from + String(text).length },
        scrollIntoView: true,
      });
      view.focus();
    },
    focus: () => view.focus(),
    openSearch: () => openSearchPanel(view),
    setBaseline(value = view.state.doc.toString()) {
      baselines.set(profile, String(value));
      view.dispatch({ effects: diff.reconfigure(diffExtension()) });
      updateStatus(view);
    },
    destroy() {
      view.destroy();
      textarea.hidden = false;
    },
  };
}

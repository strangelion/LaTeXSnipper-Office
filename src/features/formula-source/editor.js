import {
  autocompletion,
  closeCompletion,
  pickedCompletion,
} from "@codemirror/autocomplete";
import { completionPrefix, contextCompletions } from "./context-completions.js";
import { createCompletionSelector } from "./completion-selector.js";
import {
  inlineCompletion,
  refreshInlineCompletion,
} from "./inline-completion.js";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  syntaxHighlighting,
} from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

const latexLanguage = StreamLanguage.define(stex);

const latexHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword],
    color: "var(--code-keyword)",
    fontWeight: "650",
  },
  {
    tag: [tags.function(tags.name), tags.function(tags.variableName)],
    color: "var(--code-function)",
  },
  {
    tag: [tags.typeName, tags.className, tags.tagName],
    color: "var(--code-type)",
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
  {
    tag: [tags.operator, tags.arithmeticOperator, tags.logicOperator],
    color: "var(--code-operator)",
  },
  {
    tag: [tags.bracket, tags.paren, tags.squareBracket, tags.brace],
    color: "var(--code-bracket)",
  },
  { tag: [tags.name, tags.variableName], color: "var(--code-name)" },
  {
    tag: tags.invalid,
    color: "var(--code-error)",
    textDecoration: "underline wavy",
  },
]);

const latexCompletions = [
  "\\frac{}{}",
  "\\sqrt{}",
  "\\sum_{}^{}",
  "\\int_{}^{}",
  "\\lim_{}",
  "\\partial",
  "\\nabla",
  "\\mathbf{}",
  "\\mathrm{}",
  "\\text{}",
  "\\begin{aligned}\n  \\end{aligned}",
  "\\begin{matrix}\n  \\end{matrix}",
  "\\begin{cases}\n  \\end{cases}",
];

function findClosingBrace(source, openingIndex) {
  let depth = 0;
  let comment = false;
  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    if (comment) {
      if (character === "\n") comment = false;
      continue;
    }
    if (character === "%" && source[index - 1] !== "\\") {
      comment = true;
      continue;
    }
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function formulaStructureDecorations(view) {
  const source = view.state.doc.toString();
  const ranges = [];
  const braceDepth = [];
  let comment = false;
  let pendingScript = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (comment) {
      if (character === "\n") comment = false;
      continue;
    }
    if (character === "%" && source[index - 1] !== "\\") {
      comment = true;
      pendingScript = null;
      continue;
    }
    if (character === "\\") {
      if (pendingScript) {
        const command = source.slice(index).match(/^\\(?:[A-Za-z]+|.)/u)?.[0];
        const length = command?.length || 1;
        ranges.push(
          Decoration.mark({
            class: `formula-source-${pendingScript}`,
          }).range(index, Math.min(source.length, index + length)),
        );
        pendingScript = null;
        index += length - 1;
      } else {
        const command = source.slice(index).match(/^\\(?:[A-Za-z]+|.)/u)?.[0];
        if (command) index += command.length - 1;
      }
      continue;
    }
    if (character === "^" || character === "_") {
      pendingScript = character === "^" ? "superscript" : "subscript";
      ranges.push(
        Decoration.mark({
          class: `formula-source-${pendingScript}-operator`,
        }).range(index, index + 1),
      );
      continue;
    }
    if (character === "{") {
      const depth = braceDepth.length;
      braceDepth.push(depth);
      ranges.push(
        Decoration.mark({
          class: `formula-source-brace-depth-${depth % 6}`,
        }).range(index, index + 1),
      );
      if (pendingScript) {
        const closingIndex = findClosingBrace(source, index);
        if (closingIndex > index + 1) {
          ranges.push(
            Decoration.mark({
              class: `formula-source-${pendingScript}`,
            }).range(index + 1, closingIndex),
          );
        }
        pendingScript = null;
      }
      continue;
    }
    if (character === "}") {
      const depth = Math.max(0, (braceDepth.pop() ?? 0) % 6);
      ranges.push(
        Decoration.mark({
          class: `formula-source-brace-depth-${depth}`,
        }).range(index, index + 1),
      );
      pendingScript = null;
      continue;
    }
    if (pendingScript && !/\s/u.test(character)) {
      ranges.push(
        Decoration.mark({
          class: `formula-source-${pendingScript}`,
        }).range(index, index + 1),
      );
      pendingScript = null;
    }
  }
  return Decoration.set(ranges, true);
}

const formulaStructureHighlighting = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = formulaStructureDecorations(view);
    }

    update(update) {
      if (update.docChanged) {
        this.decorations = formulaStructureDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function completionSource(context, provider) {
  const match = context.matchBefore(completionPrefix);
  if (!match || (!context.explicit && match.from === match.to)) return null;
  return {
    from: match.from,
    options: provider.rank(context.state, context.pos).map((option) => ({
      ...option,
      type: option.label.startsWith("\\begin") ? "class" : "function",
    })),
  };
}

/**
 * Upgrade the plain formula textarea to a syntax-coloured CodeMirror surface.
 *
 * The textarea remains the canonical compatibility channel. Existing callers,
 * browser automation and the MathLive synchronisation may keep reading or
 * assigning `textarea.value`; the editor mirrors those changes in both
 * directions and emits the same bubbling input event as the old textarea.
 */
export function createFormulaSourceEditor({
  textarea,
  host,
  getSymbols = () => [],
}) {
  if (!textarea || !host) return null;

  let synchronizingFromEditor = false;
  let synchronizingFromTextarea = false;
  let storage;
  try {
    storage = window.localStorage;
  } catch {
    /* Suggestions remain available without storage. */
  }
  // Persist only public catalog IDs, never private symbol names or editing context.
  const catalog = contextCompletions(
    "",
    latexCompletions.map((label) => ({ label, detail: "固定候选", boost: 0 })),
  ).map((option) => option.label);
  const selector = createCompletionSelector(catalog, storage);
  let symbols = getSymbols();
  const provider = {
    rank: (state, position = state.selection.main.head) =>
      contextCompletions(
        state.doc.sliceString(Math.max(0, position - 8192), position),
        selector.rank(),
        symbols,
      ),
  };
  let acceptance = null;
  const controls = document.createElement("div");
  controls.className = "formula-completion-controls";
  const label = document.createElement("label");
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = selector.enabled;
  label.append(toggle, document.createTextNode("本地偏好排序（实验）"));
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "清空偏好";
  const note = document.createElement("small");
  note.textContent = "偏好排序默认关闭；仅记录候选接受/撤销，不上传公式";
  note.textContent += "；淡字候选 Tab 接受 / Esc 隐藏";
  toggle.addEventListener("change", () => {
    selector.setEnabled(toggle.checked);
    acceptance = null;
    view.dispatch({ effects: refreshInlineCompletion.of("refresh") });
  });
  reset.addEventListener("click", () => {
    selector.reset();
    toggle.checked = false;
    acceptance = null;
    view.dispatch({ effects: refreshInlineCompletion.of("refresh") });
  });
  controls.append(label, reset, note);
  host.append(controls);
  const valueDescriptor = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  );
  const getTextareaValue = () => valueDescriptor.get.call(textarea);
  const setTextareaValue = (value) =>
    valueDescriptor.set.call(textarea, String(value ?? ""));

  const state = EditorState.create({
    doc: getTextareaValue(),
    extensions: [
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      bracketMatching(),
      highlightActiveLine(),
      syntaxHighlighting(latexHighlightStyle),
      formulaStructureHighlighting,
      inlineCompletion(provider),
      autocompletion({
        override: [(context) => completionSource(context, provider)],
      }),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      latexLanguage,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        "aria-label": "LaTeX 源码编辑器",
        "aria-multiline": "true",
        autocapitalize: "off",
        autocomplete: "off",
        spellcheck: "false",
      }),
      EditorView.updateListener.of((update) => {
        for (const transaction of update.transactions) {
          const completion = transaction.annotation(pickedCompletion);
          if (completion)
            acceptance = {
              before: transaction.startState.doc,
              token: selector.accept(completion.label),
            };
          else if (
            acceptance &&
            transaction.isUserEvent("undo") &&
            transaction.state.doc.eq(acceptance.before)
          ) {
            selector.undo(acceptance.token);
            acceptance = null;
          } else if (transaction.docChanged) acceptance = null;
        }
        if (!update.docChanged || synchronizingFromTextarea) return;
        synchronizingFromEditor = true;
        setTextareaValue(update.state.doc.toString());
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        synchronizingFromEditor = false;
      }),
    ],
  });

  const view = new EditorView({ state, parent: host });
  const refreshSymbols = () => {
    symbols = getSymbols();
    closeCompletion(view);
    view.dispatch({ effects: refreshInlineCompletion.of("refresh") });
  };
  window.addEventListener(
    "latexsnipper:custom-symbol-library-changed",
    refreshSymbols,
  );

  const replaceDocument = (value) => {
    const text = String(value ?? "");
    if (text === view.state.doc.toString()) return;
    synchronizingFromTextarea = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
    synchronizingFromTextarea = false;
  };

  const handleTextareaInput = () => {
    if (!synchronizingFromEditor) replaceDocument(getTextareaValue());
  };
  textarea.addEventListener("input", handleTextareaInput);

  Object.defineProperty(textarea, "value", {
    configurable: true,
    enumerable: true,
    get: getTextareaValue,
    set(value) {
      setTextareaValue(value);
      if (!synchronizingFromEditor) replaceDocument(value);
    },
  });

  textarea.hidden = true;
  host.hidden = false;
  host.dataset.editorReady = "true";

  return {
    getValue: () => view.state.doc.toString(),
    setValue(value) {
      textarea.value = value;
    },
    focus: () => view.focus(),
    destroy() {
      window.removeEventListener(
        "latexsnipper:custom-symbol-library-changed",
        refreshSymbols,
      );
      controls.remove();
      textarea.removeEventListener("input", handleTextareaInput);
      const currentValue = view.state.doc.toString();
      view.destroy();
      delete textarea.value;
      setTextareaValue(currentValue);
      textarea.hidden = false;
      host.hidden = true;
      delete host.dataset.editorReady;
    },
  };
}

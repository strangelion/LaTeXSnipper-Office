import { autocompletion } from "@codemirror/autocomplete";
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

function completionSource(context) {
  const match = context.matchBefore(/\\[A-Za-z]*|[A-Za-z]+/);
  if (!match || (!context.explicit && match.from === match.to)) return null;
  return {
    from: match.from,
    options: latexCompletions.map((label) => ({
      label,
      type: label.startsWith("\\begin") ? "class" : "function",
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
export function createFormulaSourceEditor({ textarea, host }) {
  if (!textarea || !host) return null;

  let synchronizingFromEditor = false;
  let synchronizingFromTextarea = false;
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
      autocompletion({ override: [completionSource] }),
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
        if (!update.docChanged || synchronizingFromTextarea) return;
        synchronizingFromEditor = true;
        setTextareaValue(update.state.doc.toString());
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        synchronizingFromEditor = false;
      }),
    ],
  });

  const view = new EditorView({ state, parent: host });

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

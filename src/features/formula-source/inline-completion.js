import {
  closeCompletion,
  pickedCompletion,
  selectedCompletion,
} from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { Prec, StateEffect, Transaction } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType, keymap } from "@codemirror/view";

export const refreshInlineCompletion = StateEffect.define();

// Exact command prefixes only; never infer prose, comments or unknown macros.
export function inlineCandidate(before, after, options, selected) {
  const match = /(?:\\(?:begin|end)\{[A-Za-z]*|\\[A-Za-z@]*|[\^_])$/.exec(
    before,
  );
  if (
    !match ||
    before[match.index - 1] === "\\" ||
    /(^|[^\\])%/.test(before) ||
    (after && !/^[\s+\-=,;)\]}]/.test(after))
  )
    return null;
  const candidates = options.filter(
    (option) =>
      option.label.startsWith(match[0]) &&
      option.label.length > match[0].length,
  );
  const option =
    candidates.find((option) => option.label === selected?.label) ||
    candidates.reduce(
      (best, option) => (!best || option.boost > best.boost ? option : best),
      null,
    );
  return option
    ? {
        option,
        prefix: match[0],
        from: match.index,
        tail: option.label.slice(match[0].length),
      }
    : null;
}

class InlineSuggestion extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }
  eq(other) {
    return this.text === other.text;
  }
  toDOM() {
    const node = document.createElement("span");
    node.className = "formula-inline-suggestion";
    node.setAttribute("aria-hidden", "true");
    node.textContent = this.text.replace(/\n[\s\S]*/, " ↵ …");
    const hint = document.createElement("span");
    hint.className = "formula-inline-key";
    hint.textContent = "Tab";
    node.append(hint);
    return node;
  }
  ignoreEvent() {
    return true;
  }
}

export function inlineCompletion(selector) {
  const choice = (view) => {
    const selection = view.state.selection;
    if (
      !view.hasFocus ||
      view.composing ||
      selection.ranges.length !== 1 ||
      !selection.main.empty
    )
      return null;
    const position = selection.main.head;
    const line = view.state.doc.lineAt(position);
    const candidate = inlineCandidate(
      line.text.slice(0, position - line.from),
      line.text.slice(position - line.from),
      selector.rank(view.state),
      selectedCompletion(view.state),
    );
    return candidate
      ? { ...candidate, from: line.from + candidate.from, to: position }
      : null;
  };
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.dismissed = false;
        this.render(view);
      }
      render(view) {
        this.candidate = this.dismissed ? null : choice(view);
        this.decorations = this.candidate
          ? Decoration.set([
              Decoration.widget({
                widget: new InlineSuggestion(this.candidate.tail),
                side: 1,
              }).range(this.candidate.to),
            ])
          : Decoration.none;
      }
      update(update) {
        if (update.docChanged || update.selectionSet) this.dismissed = false;
        for (const transaction of update.transactions)
          for (const effect of transaction.effects)
            if (effect.is(refreshInlineCompletion))
              this.dismissed = effect.value === "dismiss";
        this.render(update.view);
      }
    },
    { decorations: (value) => value.decorations },
  );
  return [
    plugin,
    Prec.highest(
      keymap.of([
        {
          key: "Tab",
          run(view) {
            if (view.composing || !view.plugin(plugin)?.candidate) return false;
            const candidate = choice(view);
            if (!candidate) return false;
            view.dispatch({
              changes: {
                from: candidate.from,
                to: candidate.to,
                insert: candidate.option.label,
              },
              selection: {
                anchor: candidate.from + candidate.option.label.length,
              },
              annotations: [
                pickedCompletion.of(candidate.option),
                Transaction.userEvent.of("input.complete"),
                isolateHistory.of("full"),
              ],
            });
            closeCompletion(view);
            return true;
          },
        },
        {
          key: "Escape",
          run(view) {
            if (!view.plugin(plugin)?.candidate) return false;
            view.dispatch({ effects: refreshInlineCompletion.of("dismiss") });
            closeCompletion(view);
            return true;
          },
        },
        {
          key: "Ctrl-Space",
          run(view) {
            view.dispatch({ effects: refreshInlineCompletion.of("refresh") });
            return false;
          },
        },
      ]),
    ),
  ];
}

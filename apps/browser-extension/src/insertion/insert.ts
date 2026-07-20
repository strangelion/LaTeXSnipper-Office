import {
  formatFormula,
  type BrowserInsertionPayload,
  type InsertionResult,
} from "./types";

function dispatchInput(element: HTMLElement, text: string): void {
  element.dispatchEvent(
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: text,
    }),
  );
  element.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text,
    }),
  );
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("NATIVE_VALUE_SETTER_UNAVAILABLE");
  setter.call(element, value);
}

function insertInput(
  element: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): boolean {
  if (element.type === "password" || element.disabled || element.readOnly)
    return false;
  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? start;
  const before = element.value;
  const next = before.slice(0, start) + text + before.slice(end);
  setNativeValue(element, next);
  element.setSelectionRange(start + text.length, start + text.length);
  dispatchInput(element, text);
  return element.value === next;
}

function insertContentEditable(element: HTMLElement, text: string): boolean {
  if (
    !element.isContentEditable ||
    element.getAttribute("aria-disabled") === "true"
  )
    return false;
  const selection = document.getSelection();
  if (!selection) return false;
  let range = selection.rangeCount
    ? selection.getRangeAt(0).cloneRange()
    : document.createRange();
  if (!element.contains(range.commonAncestorContainer)) {
    range.selectNodeContents(element);
    range.collapse(false);
  }
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  dispatchInput(element, text);
  return element.textContent?.includes(text) ?? false;
}

export async function insertIntoActiveTarget(
  payload: BrowserInsertionPayload,
): Promise<InsertionResult> {
  const text = formatFormula(payload);
  const target = document.activeElement;
  try {
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      return insertInput(target, text)
        ? { ok: true, adapter: "native-input", verified: true }
        : { ok: false, verified: false, errorCode: "INPUT_REJECTED" };
    }
    if (target instanceof HTMLElement && target.isContentEditable) {
      const framework = target.closest(".ProseMirror")
        ? "prosemirror"
        : target.closest("[data-lexical-editor=true]")
          ? "lexical"
          : target.closest(".CodeMirror, .cm-editor")
            ? "codemirror"
            : "contenteditable";
      return insertContentEditable(target, text)
        ? { ok: true, adapter: framework, verified: true }
        : {
            ok: false,
            verified: false,
            errorCode: "CONTENTEDITABLE_VERIFICATION_FAILED",
          };
    }
  } catch (error) {
    return {
      ok: false,
      verified: false,
      errorCode: "INSERTION_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return { ok: false, verified: false, errorCode: "NO_EDITABLE_TARGET" };
}

export async function insertWithExplicitClipboardFallback(
  payload: BrowserInsertionPayload,
): Promise<InsertionResult> {
  const result = await insertIntoActiveTarget(payload);
  if (result.ok) return result;
  try {
    await navigator.clipboard.writeText(formatFormula(payload));
    return {
      ok: true,
      verified: true,
      fallback: "clipboard",
      adapter: result.adapter,
      message: result.errorCode,
    };
  } catch (error) {
    return {
      ...result,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

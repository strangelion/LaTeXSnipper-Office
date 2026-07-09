export function insertTextAtCursor(text: string): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;

  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? start;
    active.value = active.value.slice(0, start) + text + active.value.slice(end);
    active.selectionStart = active.selectionEnd = start + text.length;
    active.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return true;
  }

  if (active.isContentEditable) {
    document.execCommand("insertText", false, text);
    active.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return true;
  }

  return false;
}

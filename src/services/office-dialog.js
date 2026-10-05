// Own only the read-only conversion/confirmation dialogs, not execution jobs.
const selector =
  "dialog.office-format-dialog[open], dialog.office-selection-dialog[open]";

export function mountOfficeDialog(dialog, title, content, actions) {
  const body = dialog.ownerDocument.createElement("div");
  body.className = "office-dialog-body";
  body.append(...content);
  dialog.append(title, body, actions);
  dialog.ownerDocument.body.append(dialog);
}

export function showOfficeDialog(dialog, focusTarget) {
  for (const previous of dialog.ownerDocument.querySelectorAll(selector)) {
    if (previous !== dialog) previous.close("cancelled");
  }
  let outsidePointer = null;
  const outside = (event) => {
    const rect = dialog.getBoundingClientRect();
    return (
      event.target === dialog &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    );
  };
  dialog.addEventListener("pointerdown", (event) => {
    outsidePointer =
      event.button === 0 && outside(event) ? event.pointerId : null;
  });
  dialog.addEventListener("pointerup", (event) => {
    if (outsidePointer === event.pointerId && outside(event))
      dialog.close("cancelled");
    outsidePointer = null;
  });
  dialog.addEventListener("pointercancel", () => {
    outsidePointer = null;
  });
  dialog.showModal();
  focusTarget?.focus({ preventScroll: true });
}

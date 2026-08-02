export function bindWorkspaceInteractions({
  root = document,
  onCommand,
  onOfficeRead,
  onOfficeReplace,
  onOfficeBatch,
}) {
  for (const button of root.querySelectorAll("[data-command]")) {
    button.addEventListener("click", () => onCommand(button.dataset.command));
  }
  root
    .getElementById("officeWorkspaceRead")
    ?.addEventListener("click", onOfficeRead);
  root
    .getElementById("officeWorkspaceReplace")
    ?.addEventListener("click", onOfficeReplace);
  root
    .getElementById("officeWorkspaceBatch")
    ?.addEventListener("click", onOfficeBatch);
}

export type MessageKey =
  | "extensionName"
  | "extensionDescription"
  | "checkingConnection"
  | "connected"
  | "desktopOffline"
  | "scanSelection"
  | "scanMessage"
  | "scanPage"
  | "sendSelection"
  | "openPanel"
  | "noFormulas"
  | "scanFailed"
  | "noSelection"
  | "sentToDesktop"
  | "previewRequired"
  | "clear"
  | "formulas"
  | "conversation"
  | "diagnostics"
  | "options"
  | "save"
  | "cancel"
  | "permissionRequired"
  | "defaultReadScope"
  | "maximumMessages"
  | "maximumCharacters"
  | "formulaConfidence"
  | "selectionOnly"
  | "currentMessage"
  | "currentAssistantMessage"
  | "visibleConversation"
  | "loadedConversation"
  | "lastNMessages"
  | "selectedMessageRange"
  | "customContainer"
  | "formulaOnly"
  | "messagesCount"
  | "formulasCount";
export function t(key: MessageKey, substitutions?: string | string[]): string {
  const value = chrome.i18n.getMessage(key, substitutions);
  if (!value) throw new Error(`MISSING_I18N_KEY:${key}`);
  return value;
}
export function localizeDocument(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n as MessageKey;
    if (element.tagName === "OPTION") {
      // For option elements, set the text content directly
      element.textContent = t(key);
    } else {
      element.textContent = t(key);
    }
  });
}

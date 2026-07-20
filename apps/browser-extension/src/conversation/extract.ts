import { providerFor } from "../providers/registry";
import type { ExtractedMessage } from "../providers/types";
import type { BrowserSettings, ReadScopeMode } from "../settings/schema";
import type {
  ConversationImportBlock,
  ConversationImportDocument,
  ConversationImportMessage,
} from "./types";

function makeId(source: string): string {
  let hash = 2166136261;
  for (const char of source)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `import-${Date.now().toString(36)}-${(hash >>> 0).toString(16)}`;
}

function toBlocks(message: ExtractedMessage): ConversationImportBlock[] {
  const result: ConversationImportBlock[] = [];
  for (const block of message.blocks) {
    if (block.type === "code")
      result.push({ type: "code", text: block.text.slice(0, 512 * 1024) });
    else if (block.type === "table") continue;
    else if (block.type === "formula") continue;
    else
      result.push({
        type:
          block.type === "blockquote"
            ? "quote"
            : block.type === "link-group"
              ? "link-paragraph"
              : block.type === "attachment-label"
                ? "attachment-label"
                : block.type === "heading"
                  ? "heading"
                  : "paragraph",
        runs: [{ type: "text", text: block.text }],
      });
  }
  for (const table of message.tables)
    result.push({
      type: "table",
      rows: table.rows,
      headerRows: 0,
      columnCount: Math.max(0, ...table.rows.map((row) => row.length)),
    });
  for (const formula of message.formulas)
    result.push({ type: "formula", formula });
  return result;
}

function inViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.bottom >= 0 && rect.top <= innerHeight;
}

export function extractConversation(
  document: Document,
  settings: BrowserSettings,
  mode: ReadScopeMode,
  selectedIds: string[] = [],
): ConversationImportDocument {
  const provider = providerFor(new URL(document.location.href));
  const root = provider.findConversationRoot(document);
  if (!root) throw new Error("PROVIDER_DOM_CHANGED");
  const all = provider
    .listVisibleMessageElements(root)
    .slice(0, settings.limits.maxMessages * 4);
  let elements = all;
  if (mode === "visible-conversation") elements = all.filter(inViewport);
  if (mode === "last-n-messages")
    elements = all.slice(-Math.min(settings.limits.maxMessages, 20));
  if (mode === "selected-message-range")
    elements = all.filter((element, index) =>
      selectedIds.includes(
        element.getAttribute("data-message-id") || `message-${index}`,
      ),
    );
  if (mode === "current-assistant-message" || mode === "current-message")
    elements = all.slice(-1);
  if (mode === "selection-only") elements = [];
  elements = elements.slice(0, settings.limits.maxMessages);
  let characters = 0;
  const messages: ConversationImportMessage[] = [];
  for (let index = 0; index < elements.length; index += 1) {
    const extracted = provider.extractMessage(elements[index], {
      pageUrl: document.location.href,
      sequence: index,
    });
    if (!extracted || !settings.roles.includes(extracted.role)) continue;
    characters += extracted.text.length;
    if (characters > settings.limits.maxCharacters) break;
    messages.push({
      id: extracted.id,
      role: extracted.role,
      sequence: extracted.sequence,
      language: extracted.language,
      blocks: toBlocks(extracted),
    });
  }
  const truncated =
    elements.length < all.length || characters > settings.limits.maxCharacters;
  return {
    schemaVersion: 1,
    importId: makeId(
      `${document.location.href}:${messages.map((m) => m.id).join(":")}`,
    ),
    provider: provider.id,
    providerAdapterVersion: provider.version,
    sourceUrl: document.location.href,
    sourceTitle: document.title,
    sourceLanguage: document.documentElement.lang || undefined,
    extractedAt: new Date().toISOString(),
    scope: {
      mode,
      roles: settings.roles,
      messageIds: messages.map((m) => m.id),
      explicitUserConfirmation: false,
    },
    messages,
    truncated,
    truncation: truncated
      ? {
          reason:
            characters > settings.limits.maxCharacters
              ? "maxCharacters"
              : "maxMessagesOrVirtualized",
          originalCount: all.length,
          returnedCount: messages.length,
        }
      : undefined,
    diagnostics: provider.diagnostics(document),
  };
}

export function defaultQuestionAndAnswer(
  document: ConversationImportDocument,
): ConversationImportDocument {
  const assistantIndex = document.messages
    .map((message) => message.role)
    .lastIndexOf("assistant");
  if (assistantIndex < 0)
    return { ...document, messages: document.messages.slice(-1) };
  let start = assistantIndex;
  for (let index = assistantIndex - 1; index >= 0; index -= 1)
    if (document.messages[index].role === "user") {
      start = index;
      break;
    }
  return {
    ...document,
    messages: document.messages.slice(start, assistantIndex + 1),
    scope: {
      ...document.scope,
      messageIds: document.messages
        .slice(start, assistantIndex + 1)
        .map((message) => message.id),
    },
  };
}

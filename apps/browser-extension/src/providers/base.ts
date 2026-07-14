import { extractFormulaCandidates } from "../formulas/pipeline";
import type { Disposable, EditableTarget, ExtractedContentBlock, ExtractedMessage, ExtractionContext, MessageRole, ProviderAdapter, ProviderCapabilities, ProviderId } from "./types";

export interface ProviderDefinition {
  id: ProviderId;
  displayNameKey: string;
  hosts: readonly string[];
  roots: readonly string[];
  messages: readonly string[];
  user: readonly string[];
  assistant: readonly string[];
  composer: readonly string[];
  maturity?: "supported" | "limited";
}

function matchesAny(element: Element, selectors: readonly string[]): boolean {
  return selectors.some((selector) => { try { return element.matches(selector) || !!element.closest(selector); } catch { return false; } });
}

function visible(element: Element): boolean {
  if (element.getAttribute("aria-hidden") === "true" || element.closest("[hidden]")) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && rect.width + rect.height > 0;
}

function elementId(element: Element, sequence: number): string {
  const providerId = element.getAttribute("data-message-id") || element.id;
  if (providerId) return providerId.slice(0, 256);
  let hash = 2166136261;
  const source = `${sequence}:${element.tagName}:${element.getAttribute("data-testid") || ""}:${(element.textContent || "").slice(0, 128)}`;
  for (const char of source) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `message-${(hash >>> 0).toString(16)}`;
}

function blocks(element: Element): ExtractedContentBlock[] {
  const result: ExtractedContentBlock[] = [];
  for (const child of Array.from(element.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,table"))) {
    if (!visible(child)) continue;
    const tag = child.tagName.toLowerCase();
    const type: ExtractedContentBlock["type"] = tag === "pre" ? "code" : tag === "table" ? "table" : tag === "li" ? "list" : tag === "blockquote" ? "blockquote" : tag.startsWith("h") ? "heading" : "paragraph";
    result.push({ type, text: (child.textContent || "").slice(0, 64 * 1024) });
  }
  return result.length ? result : [{ type: "paragraph", text: (element.textContent || "").slice(0, 64 * 1024) }];
}

export function createProviderAdapter(definition: ProviderDefinition): ProviderAdapter {
  const findRoot = (document: Document): Element | null => {
    for (const selector of definition.roots) {
      try { const found = document.querySelector(selector); if (found) return found; } catch { /* audited selector */ }
    }
    return null;
  };
  const listMessages = (root: Element): Element[] => {
    for (const selector of definition.messages) {
      try { const found = Array.from(root.querySelectorAll(selector)).filter(visible); if (found.length) return found.slice(0, 500); } catch { /* audited selector */ }
    }
    return [];
  };
  const identifyRole = (element: Element): MessageRole => {
    if (matchesAny(element, definition.user)) return "user";
    if (matchesAny(element, definition.assistant)) return "assistant";
    const label = `${element.getAttribute("data-message-author-role") || ""} ${element.getAttribute("aria-label") || ""}`.toLowerCase();
    if (/user|you|human|用户|我/.test(label)) return "user";
    if (/assistant|model|bot|回答|助手/.test(label)) return "assistant";
    return "unknown";
  };
  return {
    id: definition.id,
    displayNameKey: definition.displayNameKey,
    hostPatterns: definition.hosts,
    version: "1.0.0",
    verifiedLive: false,
    matches(location: Location | URL): boolean { return definition.hosts.some((host) => location.hostname === host || location.hostname.endsWith(`.${host}`)); },
    detectCapabilities(document: Document): ProviderCapabilities {
      const root = findRoot(document);
      const count = root ? listMessages(root).length : 0;
      return {
        maturity: !root ? "domChanged" : definition.maturity ?? "supported",
        readSelection: true, readCurrentMessage: count > 0, readVisibleConversation: count > 0,
        readLoadedConversation: count > 0, extractFormulas: count > 0, extractCode: count > 0,
        extractTables: count > 0, insertIntoComposer: !!this.findComposer(document), streamObservation: !!root,
      };
    },
    findConversationRoot: findRoot,
    listVisibleMessageElements: listMessages,
    identifyRole,
    extractMessage(element: Element, context: ExtractionContext): ExtractedMessage | null {
      if (!visible(element)) return null;
      const role = identifyRole(element);
      const id = elementId(element, context.sequence);
      const text = (element.textContent || "").slice(0, 256 * 1024);
      const codeBlocks = Array.from(element.querySelectorAll("pre code, pre")).filter(visible).slice(0, 50).map((node) => ({ language: node.getAttribute("data-language") || undefined, code: (node.textContent || "").slice(0, 128 * 1024) }));
      const tables = Array.from(element.querySelectorAll("table")).filter(visible).slice(0, 20).map((table) => ({ rows: Array.from(table.querySelectorAll("tr")).slice(0, 200).map((row) => Array.from(row.querySelectorAll("th,td")).slice(0, 50).map((cell) => (cell.textContent || "").trim())) }));
      const links = Array.from(element.querySelectorAll("a[href]")).filter(visible).slice(0, 100).map((link) => ({ label: (link.textContent || "").trim(), href: (link as HTMLAnchorElement).href }));
      return {
        id, providerMessageId: element.getAttribute("data-message-id") || undefined, role,
        sequence: context.sequence, visible: true,
        language: element.getAttribute("lang") || element.closest("[lang]")?.getAttribute("lang") || document.documentElement.lang || undefined,
        text, blocks: blocks(element), formulas: extractFormulaCandidates(element, { pageUrl: context.pageUrl, messageId: id, messageRole: role }),
        codeBlocks, tables, links,
        elementFingerprint: elementId(element, context.sequence),
      };
    },
    findComposer(document: Document): EditableTarget | null {
      for (const selector of definition.composer) {
        try { const element = document.querySelector<HTMLElement>(selector); if (element && visible(element) && !element.matches("input[type=password]")) return { element, kind: selector }; } catch { /* audited selector */ }
      }
      return null;
    },
    diagnostics(document: Document) {
      const root = findRoot(document);
      return root ? [{ code: "PROVIDER_MATCHED", strategy: definition.roots.find((selector) => { try { return !!document.querySelector(selector); } catch { return false; } }), message: "Visible conversation root matched." }] : [{ code: "PROVIDER_DOM_CHANGED", message: "No audited conversation root matched; use selection-only mode." }];
    },
    observeStreaming(root: Element, callback: (elements: Element[]) => void): Disposable {
      let timer = 0;
      const pending = new Set<Element>();
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
          if (target && !target.closest("[data-latexsnipper-overlay]")) pending.add(target);
          for (const node of Array.from(mutation.addedNodes)) if (node instanceof Element) pending.add(node);
        }
        clearTimeout(timer);
        timer = window.setTimeout(() => { callback(Array.from(pending).slice(0, 5000)); pending.clear(); }, 350);
      });
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      return { dispose() { clearTimeout(timer); observer.disconnect(); pending.clear(); } };
    },
  };
}

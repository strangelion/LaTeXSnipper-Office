import { validateSelector } from "./settings/schema";

function stableSelector(element: Element): string {
  const id = element.id && !/\d{4,}/.test(element.id) ? `#${CSS.escape(element.id)}` : "";
  if (id) return validateSelector(id);
  for (const attribute of ["data-testid", "data-message-id", "role", "aria-label"]) {
    const value = element.getAttribute(attribute);
    if (value && value.length <= 80 && !/(token|secret|password|private)/i.test(value)) return validateSelector(`${element.localName}[${attribute}="${CSS.escape(value)}"]`);
  }
  return validateSelector(element.localName);
}

export function pickElement(): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div"); overlay.dataset.latexsnipperOverlay = "true";
    const shadow = overlay.attachShadow({ mode: "closed" });
    const outline = document.createElement("div");
    outline.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #4f46e5;background:rgba(79,70,229,.08)";
    shadow.append(outline); document.documentElement.append(overlay);
    let current: Element | null = null;
    const move = (event: MouseEvent) => { const target = document.elementFromPoint(event.clientX, event.clientY); if (!target || target === overlay) return; current = target; const rect = target.getBoundingClientRect(); Object.assign(outline.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }); };
    const finish = (value: string | null) => { removeEventListener("mousemove", move, true); removeEventListener("click", click, true); removeEventListener("keydown", key, true); overlay.remove(); resolve(value); };
    const click = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); finish(current ? stableSelector(current) : null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); finish(null); } };
    addEventListener("mousemove", move, true); addEventListener("click", click, true); addEventListener("keydown", key, true);
  });
}

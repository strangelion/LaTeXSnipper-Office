import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings/defaults";
import { validateSelector, validateSettings } from "../src/settings/schema";
describe("scope and privacy settings", () => {
  it("defaults to user-triggered selection-only", () => {
    expect(DEFAULT_SETTINGS.defaultScope).toBe("selection-only");
    expect(DEFAULT_SETTINGS.retention).toBe("transient");
  });
  it("supports all required modes", () => {
    const modes = [
      "selection-only",
      "current-message",
      "current-assistant-message",
      "visible-conversation",
      "loaded-conversation",
      "last-n-messages",
      "selected-message-range",
      "custom-container",
      "formula-only",
    ];
    for (const mode of modes)
      expect(() =>
        validateSettings({
          ...structuredClone(DEFAULT_SETTINGS),
          defaultScope: mode as any,
        }),
      ).not.toThrow();
  });
  it("rejects scripts and sensitive selectors", () => {
    expect(() => validateSelector("javascript:alert(1)")).toThrow();
    expect(() => validateSelector("input[type=password]")).toThrow();
    expect(validateSelector("main article[data-message-id]")).toBe(
      "main article[data-message-id]",
    );
  });
});

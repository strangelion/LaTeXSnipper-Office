import { describe, expect, it, vi } from "vitest";
import { insertIntoActiveTarget } from "../src/insertion/insert";
describe("verified browser insertion", () => {
  it("uses the native value setter and preserves caret", async () => {
    const input = document.createElement("textarea");
    input.value = "ab";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(1, 1);
    const event = vi.fn();
    input.addEventListener("input", event);
    const result = await insertIntoActiveTarget({
      latex: "x",
      displayMode: "inline",
      insertionFormat: "dollar-inline",
    });
    expect(input.value).toBe("a$x$b");
    expect(input.selectionStart).toBe(4);
    expect(result.verified).toBe(true);
    expect(event).toHaveBeenCalled();
  });
  it("never submits a form", async () => {
    const form = document.createElement("form");
    const input = document.createElement("input");
    form.append(input);
    document.body.append(form);
    input.focus();
    const submit = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", submit);
    await insertIntoActiveTarget({
      latex: "x",
      displayMode: "inline",
      insertionFormat: "raw-latex",
    });
    expect(submit).not.toHaveBeenCalled();
  });
  it("rejects password fields", async () => {
    const input = document.createElement("input");
    input.type = "password";
    document.body.append(input);
    input.focus();
    expect(
      (
        await insertIntoActiveTarget({
          latex: "x",
          displayMode: "inline",
          insertionFormat: "raw-latex",
        })
      ).ok,
    ).toBe(false);
  });
});

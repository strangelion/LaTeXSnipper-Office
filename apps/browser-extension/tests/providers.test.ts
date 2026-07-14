import { describe, expect, it } from "vitest";
import { PROVIDERS, providerFor } from "../src/providers/registry";
import fixtures from "./fixtures/providers.json";

describe("provider adapters", () => {
  it("has independent dedicated adapters and honest unverified maturity", () => {
    expect(PROVIDERS.map((provider) => provider.id)).toEqual(expect.arrayContaining(["chatgpt", "gemini", "deepseek", "claude", "copilot", "kimi", "doubao", "qwen", "yuanbao"]));
    expect(PROVIDERS.every((provider) => provider.verifiedLive === false)).toBe(true);
  });
  for (const provider of PROVIDERS) {
    it(`${provider.id} matches its production host and extracts bounded visible fixtures`, () => {
      const host = provider.hostPatterns[0];
      expect(providerFor(new URL(`https://${host}/fixture`)).id).toBe(provider.id);
      document.body.innerHTML = fixtures[provider.id as keyof typeof fixtures];
      const root = provider.findConversationRoot(document);
      expect(root).not.toBeNull();
      const messages = provider.listVisibleMessageElements(root!);
      if (messages.length) expect(provider.extractMessage(messages[0], { pageUrl: `https://${host}/fixture`, sequence: 0 })?.text.length).toBeGreaterThan(0);
      expect(provider.diagnostics(document).length).toBeGreaterThan(0);
    });
  }
});

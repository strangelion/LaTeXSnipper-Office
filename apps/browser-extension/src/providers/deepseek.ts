import { createProviderAdapter } from "./base";
export const deepseekAdapter = createProviderAdapter({
  id: "deepseek",
  displayNameKey: "providerDeepseek",
  hosts: ["chat.deepseek.com"],
  roots: ["main", '[role="main"]'],
  messages: [
    "[data-message-id]",
    '[data-role="user"], [data-role="assistant"]',
    "article",
  ],
  user: ['[data-role="user"]', '[data-message-author-role="user"]'],
  assistant: [
    '[data-role="assistant"]',
    '[data-message-author-role="assistant"]',
  ],
  composer: ["textarea", '[contenteditable="true"]'],
});

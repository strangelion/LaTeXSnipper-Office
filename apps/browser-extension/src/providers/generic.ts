import { createProviderAdapter } from "./base";
export const genericAdapter = createProviderAdapter({
  id: "generic",
  displayNameKey: "providerGeneric",
  hosts: [],
  roots: ['[role="main"]', "main", "body"],
  messages: ["[data-message-id]", "[data-message-author-role]", "article"],
  user: ['[data-role="user"]', '[data-message-author-role="user"]'],
  assistant: [
    '[data-role="assistant"]',
    '[data-message-author-role="assistant"]',
  ],
  composer: [
    "textarea",
    "input:not([type=password])",
    '[contenteditable="true"]',
  ],
  maturity: "limited",
});

import { createProviderAdapter } from "./base";
export const kimiAdapter = createProviderAdapter({
  id: "kimi",
  displayNameKey: "providerKimi",
  hosts: ["kimi.moonshot.cn", "kimi.com"],
  roots: ["main", '[role="main"]'],
  messages: ["[data-message-id]", '[class*="message"]'],
  user: ['[data-role="user"]', '[class*="user"]'],
  assistant: ['[data-role="assistant"]', '[class*="assistant"]'],
  composer: ["textarea", '[contenteditable="true"]'],
});

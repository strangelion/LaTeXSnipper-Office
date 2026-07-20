import { createProviderAdapter } from "./base";
export const chatgptAdapter = createProviderAdapter({
  id: "chatgpt",
  displayNameKey: "providerChatgpt",
  hosts: ["chatgpt.com", "chat.openai.com"],
  roots: ["main", "[role=main]"],
  messages: ["[data-message-author-role]", "article"],
  user: ['[data-message-author-role="user"]'],
  assistant: ['[data-message-author-role="assistant"]'],
  composer: ["#prompt-textarea", "textarea", '[contenteditable="true"]'],
});

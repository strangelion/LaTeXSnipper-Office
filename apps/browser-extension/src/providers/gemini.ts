import { createProviderAdapter } from "./base";
export const geminiAdapter = createProviderAdapter({
  id: "gemini",
  displayNameKey: "providerGemini",
  hosts: ["gemini.google.com"],
  roots: ["main", "chat-window"],
  messages: ["user-query, model-response", '[data-test-id*="message"]'],
  user: ["user-query"],
  assistant: ["model-response"],
  composer: ["rich-textarea [contenteditable=true]", "textarea"],
});

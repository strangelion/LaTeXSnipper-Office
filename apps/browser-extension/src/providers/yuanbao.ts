import { createProviderAdapter } from "./base";
export const yuanbaoAdapter = createProviderAdapter({
  id: "yuanbao",
  displayNameKey: "providerYuanbao",
  hosts: ["yuanbao.tencent.com"],
  roots: ["main", '[role="main"]'],
  messages: ["[data-message-id]", '[class*="message"]', "article"],
  user: ['[data-role="user"]', '[class*="user"]'],
  assistant: ['[data-role="assistant"]', '[class*="assistant"]'],
  composer: ["textarea", '[contenteditable="true"]'],
});

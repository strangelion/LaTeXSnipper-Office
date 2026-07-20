import { createProviderAdapter } from "./base";
export const perplexityAdapter = createProviderAdapter({
  id: "perplexity",
  displayNameKey: "providerPerplexity",
  hosts: ["www.perplexity.ai", "perplexity.ai"],
  roots: ["main"],
  messages: ["article", '[data-testid*="message"]'],
  user: ['[data-role="user"]'],
  assistant: ["article"],
  composer: ["textarea"],
  maturity: "limited",
});
export const grokAdapter = createProviderAdapter({
  id: "grok",
  displayNameKey: "providerGrok",
  hosts: ["grok.com", "x.com"],
  roots: ["main"],
  messages: ["article"],
  user: ['[data-role="user"]'],
  assistant: ['[data-role="assistant"]'],
  composer: ["textarea"],
  maturity: "limited",
});
export const wenxinAdapter = createProviderAdapter({
  id: "wenxin",
  displayNameKey: "providerWenxin",
  hosts: ["yiyan.baidu.com"],
  roots: ["main"],
  messages: ["article", '[class*="message"]'],
  user: ['[data-role="user"]'],
  assistant: ['[data-role="assistant"]'],
  composer: ["textarea"],
  maturity: "limited",
});
export const zhipuAdapter = createProviderAdapter({
  id: "zhipu",
  displayNameKey: "providerZhipu",
  hosts: ["chatglm.cn", "z.ai"],
  roots: ["main"],
  messages: ["article", "[data-message-id]"],
  user: ['[data-role="user"]'],
  assistant: ['[data-role="assistant"]'],
  composer: ["textarea"],
  maturity: "limited",
});

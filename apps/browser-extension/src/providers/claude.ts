import { createProviderAdapter } from "./base";
export const claudeAdapter = createProviderAdapter({ id: "claude", displayNameKey: "providerClaude", hosts: ["claude.ai"], roots: ["main", '[role="main"]'], messages: ['[data-testid*="message"]', "article"], user: ['[data-testid*="user"]'], assistant: ['[data-testid*="assistant"]'], composer: ['div[contenteditable="true"]', "textarea"] });

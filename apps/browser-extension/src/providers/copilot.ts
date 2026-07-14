import { createProviderAdapter } from "./base";
export const copilotAdapter = createProviderAdapter({ id: "copilot", displayNameKey: "providerCopilot", hosts: ["copilot.microsoft.com"], roots: ["main", '[role="main"]'], messages: ['[data-testid*="message"]', "article"], user: ['[data-author="user"]'], assistant: ['[data-author="assistant"]'], composer: ["textarea", '[contenteditable="true"]'] });

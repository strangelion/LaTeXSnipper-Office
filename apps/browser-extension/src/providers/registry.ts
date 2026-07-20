import type { ProviderAdapter } from "./types";
import { chatgptAdapter } from "./chatgpt";
import { geminiAdapter } from "./gemini";
import { deepseekAdapter } from "./deepseek";
import { claudeAdapter } from "./claude";
import { copilotAdapter } from "./copilot";
import { kimiAdapter } from "./kimi";
import { doubaoAdapter } from "./doubao";
import { qwenAdapter } from "./qwen";
import { yuanbaoAdapter } from "./yuanbao";
import {
  perplexityAdapter,
  grokAdapter,
  wenxinAdapter,
  zhipuAdapter,
} from "./limited";
import { genericAdapter } from "./generic";

export const PROVIDERS: readonly ProviderAdapter[] = [
  chatgptAdapter,
  geminiAdapter,
  deepseekAdapter,
  claudeAdapter,
  copilotAdapter,
  kimiAdapter,
  doubaoAdapter,
  qwenAdapter,
  yuanbaoAdapter,
  perplexityAdapter,
  grokAdapter,
  wenxinAdapter,
  zhipuAdapter,
];
export function providerFor(location: Location | URL): ProviderAdapter {
  return (
    PROVIDERS.find((provider) => provider.matches(location)) || genericAdapter
  );
}

import { DEFAULT_SETTINGS } from "./defaults";
import { validateSettings, type BrowserSettings } from "./schema";
const KEY = "latexsnipper-browser-settings";
export async function loadSettings(): Promise<BrowserSettings> {
  const result = await chrome.storage.local.get(KEY);
  if (!result[KEY]) return structuredClone(DEFAULT_SETTINGS);
  try { return validateSettings({ ...structuredClone(DEFAULT_SETTINGS), ...result[KEY] } as BrowserSettings); }
  catch { return structuredClone(DEFAULT_SETTINGS); }
}
export async function saveSettings(settings: BrowserSettings): Promise<void> { await chrome.storage.local.set({ [KEY]: validateSettings(settings) }); }
export async function resetSettings(): Promise<BrowserSettings> { const value = structuredClone(DEFAULT_SETTINGS); await saveSettings(value); return value; }

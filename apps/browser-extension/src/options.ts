import { localizeDocument, t } from "./i18n";
import { loadSettings, saveSettings } from "./settings/storage";
import type { ReadScopeMode } from "./settings/schema";
const scope = document.getElementById("scope") as HTMLSelectElement;
const maxMessages = document.getElementById("maxMessages") as HTMLInputElement;
const maxCharacters = document.getElementById(
  "maxCharacters",
) as HTMLInputElement;
const confidence = document.getElementById("confidence") as HTMLInputElement;
const status = document.getElementById("status")!;
(async () => {
  localizeDocument();
  const settings = await loadSettings();
  scope.value = settings.defaultScope;
  maxMessages.value = String(settings.limits.maxMessages);
  maxCharacters.value = String(settings.limits.maxCharacters);
  confidence.value = String(settings.formulaConfidence);
})();
document.getElementById("save")!.addEventListener("click", async () => {
  const settings = await loadSettings();
  settings.defaultScope = scope.value as ReadScopeMode;
  settings.limits.maxMessages = Number(maxMessages.value);
  settings.limits.maxCharacters = Number(maxCharacters.value);
  settings.formulaConfidence = Number(confidence.value);
  await saveSettings(settings);
  status.textContent = t("save");
});

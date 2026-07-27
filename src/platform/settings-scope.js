export const SETTING_SCOPES = Object.freeze([
  "global",
  "os",
  "host",
  "document",
  "session",
]);

export function scopedSettingKey(scope, key, context = {}) {
  if (!SETTING_SCOPES.includes(scope)) {
    throw new TypeError(`Unknown settings scope: ${scope}`);
  }
  const qualifier =
    scope === "global"
      ? "global"
      : scope === "os"
        ? context.os
        : scope === "host"
          ? context.host
          : scope === "document"
            ? context.documentId
            : context.sessionId;
  if (!qualifier) {
    throw new Error(`SETTINGS_SCOPE_CONTEXT_MISSING: ${scope}`);
  }
  return `scoped.${scope}.${qualifier}.${key}`;
}

export function resolveScopedSetting(settings, key, context = {}) {
  const candidates = [
    ["session", context.sessionId],
    ["document", context.documentId],
    ["host", context.host],
    ["os", context.os],
    ["global", "global"],
  ];
  for (const [scope, qualifier] of candidates) {
    if (!qualifier) continue;
    const scopedKey = `scoped.${scope}.${qualifier}.${key}`;
    if (Object.hasOwn(settings, scopedKey)) return settings[scopedKey];
  }
  return undefined;
}

export function migrateLegacySetting(settings, legacyKey, scopedKey) {
  if (
    Object.hasOwn(settings, legacyKey) &&
    !Object.hasOwn(settings, scopedKey)
  ) {
    settings[scopedKey] = settings[legacyKey];
  }
  return settings;
}

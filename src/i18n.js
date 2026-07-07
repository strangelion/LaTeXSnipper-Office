// Lightweight i18n for LaTeXSnipper Office
// Supports data-i18n (text), data-i18n-placeholder, data-i18n-title, data-i18n-aria-label

const SUPPORTED = ['zh-CN', 'en-US'];
const FALLBACK = 'en-US';

let resolvedLocale = FALLBACK;
let messages = {};

function normalize(locale) {
  if (!locale || locale === 'auto') {
    const nav = (navigator.language || navigator.userLanguage || 'en-US').replace(/_/g, '-');
    // Match exact or prefix (e.g. "zh" → "zh-CN")
    if (SUPPORTED.includes(nav)) return nav;
    const prefix = nav.split('-')[0];
    const match = SUPPORTED.find(l => l.startsWith(prefix));
    return match || FALLBACK;
  }
  return SUPPORTED.includes(locale) ? locale : FALLBACK;
}

export async function setLocale(locale) {
  resolvedLocale = normalize(locale);
  try {
    const mod = await import(`./locales/${resolvedLocale}.json`);
    messages = mod.default || mod;
  } catch {
    // Fallback to empty messages
    messages = {};
  }
  applyTranslations(document);
}

export function getResolvedLocale() {
  return resolvedLocale;
}

export function t(key, variables = {}) {
  const keys = key.split('.');
  let val = messages;
  for (const k of keys) {
    if (val == null || typeof val !== 'object') return key;
    val = val[k];
  }
  if (typeof val !== 'string') return key;
  return val.replace(/\{(\w+)\}/g, (_, name) => variables[name] ?? `{${name}}`);
}

export function applyTranslations(root = document) {
  // data-i18n → textContent
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  // data-i18n-placeholder
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  // data-i18n-title
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  // data-i18n-aria-label
  root.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
  });
}

// Auto-initialize
setLocale('auto');

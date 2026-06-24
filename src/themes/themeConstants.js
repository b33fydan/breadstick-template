// Pure theme constants + helpers. No component exports → no react-refresh churn,
// and the unit test imports straight from here.

export const THEMES = ['modern', 'win95', 'system7'];
export const STORAGE_KEY = 'bs-theme';

export function normalizeTheme(v) {
  return THEMES.includes(v) ? v : 'modern';
}

export function readStoredTheme() {
  try {
    return normalizeTheme(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return 'modern';
  }
}

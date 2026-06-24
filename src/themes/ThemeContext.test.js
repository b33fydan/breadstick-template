import { describe, it, expect, beforeEach } from 'vitest';
import { readStoredTheme, normalizeTheme, THEMES, STORAGE_KEY } from './themeConstants';

// Minimal localStorage stub so the test needs no jsdom.
function stubStorage(initial = {}) {
  const store = { ...initial };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  return store;
}

describe('ThemeContext helpers', () => {
  beforeEach(() => stubStorage());

  it('exposes the three themes', () => {
    expect(THEMES).toEqual(['modern', 'win95', 'system7']);
  });

  it('normalizeTheme passes valid values and falls back to modern', () => {
    expect(normalizeTheme('win95')).toBe('win95');
    expect(normalizeTheme('system7')).toBe('system7');
    expect(normalizeTheme('modern')).toBe('modern');
    expect(normalizeTheme('bogus')).toBe('modern');
    expect(normalizeTheme(undefined)).toBe('modern');
  });

  it('readStoredTheme returns modern when nothing stored', () => {
    expect(readStoredTheme()).toBe('modern');
  });

  it('readStoredTheme returns a valid stored value', () => {
    stubStorage({ [STORAGE_KEY]: 'win95' });
    expect(readStoredTheme()).toBe('win95');
  });

  it('readStoredTheme ignores an invalid stored value', () => {
    stubStorage({ [STORAGE_KEY]: 'aqua' });
    expect(readStoredTheme()).toBe('modern');
  });

  it('readStoredTheme survives localStorage throwing', () => {
    globalThis.localStorage = { getItem: () => { throw new Error('blocked'); } };
    expect(readStoredTheme()).toBe('modern');
  });
});

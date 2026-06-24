// Theme state + persistence. The data-theme attribute itself is applied
// declaratively by App.jsx reading useTheme() — this module only owns state.
// Pure constants/helpers live in ./themeConstants so this file stays
// component-focused (one hook export, matching the ApiSettings house pattern).
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { THEMES, STORAGE_KEY, normalizeTheme, readStoredTheme } from './themeConstants';

const ThemeCtx = createContext({ theme: 'modern', setTheme: () => {}, themes: THEMES });

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStoredTheme);

  // Mirror the theme onto <html> so the variable overrides cascade to the
  // whole document — body background and content cards included, not just
  // elements under .app. DOM-attribute sync is the sanctioned effect here.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = useCallback((next) => {
    const valid = normalizeTheme(next);
    setThemeState(valid);
    try { globalThis.localStorage?.setItem(STORAGE_KEY, valid); } catch { /* ignore */ }
  }, []);
  return <ThemeCtx.Provider value={{ theme, setTheme, themes: THEMES }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() { return useContext(ThemeCtx); }

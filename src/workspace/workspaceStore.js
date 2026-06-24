// src/workspace/workspaceStore.js — pure cross-view workspace state.
//
// One namespaced localStorage object is the single source of truth for state
// that spans Classic / Canvas / Diorama. Pure read/merge/write helpers (no
// React, no DOM) so they unit-test with a storage stub, mirroring
// src/themes/themeConstants.js. WorkspaceContext.jsx is the thin React wrapper.

export const WORKSPACE_KEY = 'breadstick-workspace';
export const LEGACY_VIEW_KEY = 'breadstick-view'; // migrated from on first read
export const VIEWS = ['classic', 'canvas', 'diorama', 'studio'];
export const DEFAULTS = { activeView: 'classic', activeCharacterId: null };

export function normalizeView(v) {
  return VIEWS.includes(v) ? v : 'classic';
}

// Always returns a full { activeView, activeCharacterId }. Tolerates a missing
// key (seeding activeView from the legacy breadstick-view key), corrupt JSON,
// and a storage that throws.
export function readWorkspace(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(WORKSPACE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        activeView: normalizeView(parsed.activeView),
        activeCharacterId: parsed.activeCharacterId ?? null,
      };
    }
    const legacyView = storage?.getItem(LEGACY_VIEW_KEY);
    return { activeView: normalizeView(legacyView), activeCharacterId: null };
  } catch {
    return { ...DEFAULTS };
  }
}

// Pure merge; the view is always normalized so a bad patch can't corrupt state.
export function mergeWorkspace(prev, patch) {
  const next = { ...prev, ...patch };
  next.activeView = normalizeView(next.activeView);
  if (next.activeCharacterId === undefined) next.activeCharacterId = null;
  return next;
}

export function writeWorkspace(next, storage = globalThis.localStorage) {
  try { storage?.setItem(WORKSPACE_KEY, JSON.stringify(next)); } catch { /* ignore quota/blocked */ }
  return next;
}

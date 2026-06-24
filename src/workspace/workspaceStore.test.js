// src/workspace/workspaceStore.test.js — pure tests, storage stub, no jsdom
// (mirrors src/themes/ThemeContext.test.js).
import { describe, it, test, expect } from 'vitest';
import {
  WORKSPACE_KEY, LEGACY_VIEW_KEY, DEFAULTS, VIEWS,
  normalizeView, readWorkspace, mergeWorkspace, writeWorkspace,
} from './workspaceStore';

function stub(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

describe('normalizeView', () => {
  it('passes valid views and falls back to classic', () => {
    expect(normalizeView('canvas')).toBe('canvas');
    expect(normalizeView('diorama')).toBe('diorama');
    expect(normalizeView('classic')).toBe('classic');
    expect(normalizeView('bogus')).toBe('classic');
    expect(normalizeView(undefined)).toBe('classic');
  });
});

describe('readWorkspace', () => {
  it('returns defaults when nothing is stored', () => {
    expect(readWorkspace(stub())).toEqual(DEFAULTS);
  });
  it('parses and merges a stored object', () => {
    const s = stub({ [WORKSPACE_KEY]: JSON.stringify({ activeView: 'canvas', activeCharacterId: 'mia-chen' }) });
    expect(readWorkspace(s)).toEqual({ activeView: 'canvas', activeCharacterId: 'mia-chen' });
  });
  it('clamps an invalid stored view', () => {
    const s = stub({ [WORKSPACE_KEY]: JSON.stringify({ activeView: 'bogus', activeCharacterId: null }) });
    expect(readWorkspace(s).activeView).toBe('classic');
  });
  it('falls back to defaults on corrupt JSON', () => {
    expect(readWorkspace(stub({ [WORKSPACE_KEY]: '{not json' }))).toEqual(DEFAULTS);
  });
  it('falls back to defaults when storage throws', () => {
    expect(readWorkspace({ getItem: () => { throw new Error('blocked'); } })).toEqual(DEFAULTS);
  });
  it('migrates the legacy breadstick-view when the new key is absent', () => {
    expect(readWorkspace(stub({ [LEGACY_VIEW_KEY]: 'diorama' }))).toEqual({ activeView: 'diorama', activeCharacterId: null });
  });
});

describe('mergeWorkspace', () => {
  it('overrides prev with patch and normalizes the view', () => {
    const prev = { activeView: 'classic', activeCharacterId: null };
    expect(mergeWorkspace(prev, { activeView: 'canvas' })).toEqual({ activeView: 'canvas', activeCharacterId: null });
    expect(mergeWorkspace(prev, { activeView: 'bogus' }).activeView).toBe('classic');
  });
  it('sets and clears activeCharacterId', () => {
    const prev = { activeView: 'classic', activeCharacterId: null };
    expect(mergeWorkspace(prev, { activeCharacterId: 'mia-chen' }).activeCharacterId).toBe('mia-chen');
    expect(mergeWorkspace({ activeView: 'classic', activeCharacterId: 'mia-chen' }, { activeCharacterId: null }).activeCharacterId).toBeNull();
  });
});

describe('writeWorkspace + readWorkspace round-trip', () => {
  it('persists what it reads back', () => {
    const s = stub();
    writeWorkspace({ activeView: 'canvas', activeCharacterId: 'jake-rivera' }, s);
    expect(readWorkspace(s)).toEqual({ activeView: 'canvas', activeCharacterId: 'jake-rivera' });
  });
});

describe('studio view registration', () => {
  test('studio is a recognized view', () => {
    expect(VIEWS).toContain('studio');
  });
  test('normalizeView preserves studio instead of resetting to classic', () => {
    expect(normalizeView('studio')).toBe('studio');
  });
});

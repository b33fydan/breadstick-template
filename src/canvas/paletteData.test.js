// src/canvas/paletteData.test.js
import { describe, it, expect } from 'vitest';
import { PALETTE_NODES, paletteItemKey } from './paletteData.js';

// Mirrors characterPaletteItems in CanvasView.jsx: dynamic character cards
// carry data.characterId and NO data.label — the shape that collided pre-fix.
// Two share a display name on purpose so only characterId can tell them apart.
const characterItems = [
  { id: 'mia-chen', name: 'Mia Chen' },
  { id: 'jake-rivera', name: 'Jake Rivera' },
  { id: 'sam-lee', name: 'Sam Lee' },
  { id: 'alex-kim', name: 'Alex Kim' },
  { id: 'char-1765432100000', name: 'Mia Chen' }, // form-added duplicate name
].map((c) => ({
  type: 'character',
  label: c.name,
  icon: '👤',
  desc: 'AI influencer character',
  color: '#C9A227',
  category: 'Characters',
  data: { characterId: c.id },
}));

function duplicates(keys) {
  const seen = new Set();
  const dupes = new Set();
  for (const k of keys) (seen.has(k) ? dupes : seen).add(k);
  return [...dupes];
}

describe('paletteItemKey (duplicate React key regression, fixed 2026-06-12)', () => {
  it('gives every palette entry — static nodes plus dynamic character cards — a unique key', () => {
    // Same composition order NodePalette renders: [...extraItems, ...PALETTE_NODES]
    const keys = [...characterItems, ...PALETTE_NODES].map(paletteItemKey);
    expect(duplicates(keys)).toEqual([]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps entries that share a node type distinct (the original collision)', () => {
    const byType = new Map();
    for (const n of PALETTE_NODES) {
      if (!byType.has(n.type)) byType.set(n.type, []);
      byType.get(n.type).push(n);
    }
    const multi = [...byType.entries()].filter(([, items]) => items.length > 1);
    // Sanity: the shapes that collided pre-fix are still in the palette, so
    // this test keeps exercising the multi-entry path.
    const multiTypes = multi.map(([t]) => t);
    expect(multiTypes).toContain('output'); // 3 output windows, distinct via top-level label
    expect(multiTypes).toContain('prd-lens'); // 6 lenses (data only carries { lens })
    for (const [type, items] of multi) {
      const keys = items.map(paletteItemKey);
      expect(duplicates(keys), `palette type "${type}" produces colliding keys`).toEqual([]);
    }
  });

  it('distinguishes character cards by characterId, never by display name', () => {
    const twins = characterItems.filter((n) => n.label === 'Mia Chen');
    expect(twins).toHaveLength(2);
    const [a, b] = twins.map(paletteItemKey);
    expect(a).not.toBe(b);
  });
});

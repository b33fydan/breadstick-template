import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG, DELIVERABLE_TYPES } from './catalog';

describe('catalog', () => {
  it('has exactly the 22 v1 types', () => {
    expect(Object.keys(CATALOG).sort()).toEqual([
      'avatar-frame', 'blotato', 'carousel', 'character', 'clip-splitter',
      'ffmpeg-grade', 'frame-sandwich', 'gami-art', 'generator', 'hyperframes',
      'image-2', 'ingredient', 'kie-img2vid', 'niche-gen', 'postiz',
      'qc-gate', 'remotion-comp', 'title-card', 'type', 'ugc-gen',
      'ugc-video', 'vid-prompt',
    ]);
  });

  it('every entry carries purpose, lane, inputs, outputs', () => {
    for (const [type, e] of Object.entries(CATALOG)) {
      expect(e.purpose, type).toBeTruthy();
      expect(Array.isArray(e.lane), type).toBe(true);
      expect(Array.isArray(e.inputs), type).toBe(true);
      expect(Array.isArray(e.outputs), type).toBe(true);
    }
  });

  it('deliverable flags match the spec list', () => {
    expect([...DELIVERABLE_TYPES].sort()).toEqual(
      ['blotato', 'carousel', 'kie-img2vid', 'postiz', 'remotion-comp', 'ugc-video'].sort()
    );
  });

  // Drift tripwire: every catalog type must exist in the LIVE nodeTypes registry.
  // The registry is a non-exported const inside CanvasView.jsx, so we
  // text-scan rather than import the 16K-line component into the test env.
  it('every catalog type exists in the CanvasView nodeTypes registry', () => {
    // import.meta.url is a file:// URL; convert to path
    let testFile = import.meta.url;
    if (testFile.startsWith('file://')) {
      testFile = fileURLToPath(new URL(testFile));
    }
    const testDir = path.dirname(testFile);
    const canvasViewPath = path.join(testDir, '../CanvasView.jsx');
    const src = fs.readFileSync(canvasViewPath, 'utf8');
    // nodeTypes is a flat single-line object; this regex stops at the first };
    // If nodeTypes is ever split multiline or gains nested objects, update this match.
    const m = src.match(/const nodeTypes = \{([\s\S]*?)\};/);
    expect(m, 'nodeTypes registry not found — did it move?').toBeTruthy();
    const body = m[1];
    for (const type of Object.keys(CATALOG)) {
      const re = new RegExp(`(^|[\\s{,])'?${type}'?\\s*:`);
      expect(re.test(body), `catalog type "${type}" missing from registry`).toBe(true);
    }
  });

  it('ingredient hydrate returns null for a character with empty lists', () => {
    const result = CATALOG.ingredient.hydrate(
      { kind: 'pp', index: 0 },
      {},
      { upstreamCharacter: () => ({ painPoints: [], hooks: [], accentColor: '#fff' }) }
    );
    expect(result).toBeNull();
  });
});

// End-to-end checks for the capability manifest generator. These run against
// the REAL repo (server.js, Root.jsx, CanvasView.jsx, data modules) — counts
// assert loose floors, not exact numbers, so adding routes/nodes/comps never
// breaks the suite.


import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from './build_manifest.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SECTION_KEYS = [
  'serverRoutes', 'remotionCompositions', 'canvasNodes', 'recipes',
  'brollCatalog', 'carouselTemplates', 'characters', 'cliVerbs',
  'topics', 'skills',
];

describe('build_manifest', () => {
  let manifest;

  beforeAll(async () => {
    manifest = await buildManifest();
  });

  it('runs end-to-end as a script and writes valid JSON', () => {
    // --out keeps the e2e run from rewriting the tracked manifest (its
    // generated timestamp would dirty git status on every npm test).
    const outRel = join('.tmp', 'manifest-e2e.json');
    execFileSync(process.execPath, [join(ROOT, 'tools', 'build_manifest.js'), '--out', outRel], { cwd: ROOT });
    const written = JSON.parse(readFileSync(join(ROOT, outRel), 'utf-8'));
    expect(written.version).toBe(1);
    expect(Number.isNaN(Date.parse(written.generated))).toBe(false);
    expect(Array.isArray(written.warnings)).toBe(true);
    for (const key of SECTION_KEYS) expect(written.sections).toHaveProperty(key);
  });

  it('produces all 10 sections with sane non-zero counts', () => {
    const s = manifest.sections;
    for (const key of SECTION_KEYS) expect(s).toHaveProperty(key);
    expect(s.serverRoutes.length).toBeGreaterThan(50);
    expect(s.remotionCompositions.length).toBeGreaterThanOrEqual(20);
    expect(s.canvasNodes.length).toBeGreaterThanOrEqual(40);
    expect(s.recipes.length).toBeGreaterThanOrEqual(3);
    expect(s.brollCatalog.count).toBeGreaterThanOrEqual(90);
    expect(s.brollCatalog.items.length).toBe(s.brollCatalog.count);
    expect(s.carouselTemplates.length).toBeGreaterThanOrEqual(3);
    expect(s.characters.list.length).toBeGreaterThanOrEqual(2);
    expect(s.cliVerbs.length).toBeGreaterThanOrEqual(8);
    expect(s.topics.length).toBeGreaterThanOrEqual(2);
    expect(Object.values(s.skills).flat().length).toBeGreaterThan(0);
  });

  it('marks /api/exec as streaming and curates its description', () => {
    const exec = manifest.sections.serverRoutes.find((r) => r.path === '/api/exec');
    expect(exec).toBeDefined();
    expect(exec.method).toBe('POST');
    expect(exec.streaming).toBe(true);
    expect(typeof exec.description).toBe('string');
  });

  it('does not false-positive streaming on outbound Accept headers (/api/blotato)', () => {
    const blotato = manifest.sections.serverRoutes.find((r) => r.path === '/api/blotato');
    expect(blotato).toBeDefined();
    expect(blotato.streaming).toBeUndefined();
  });

  it('includes the demo character mia-chen with a niche in characters', () => {
    const mia = manifest.sections.characters.list.find((c) => c.id === 'mia-chen');
    expect(mia).toBeDefined();
    expect(mia.name).toBe('Mia Chen');
    expect(mia.niche).toBeTruthy();
    // No shipped character ships a cameo now — the manifest must report that.
    expect(mia.hasCameo).toBe(false);
  });

  it('flags dynamic remotion compositions and resolves DEFAULTS spreads', () => {
    const comps = manifest.sections.remotionCompositions;
    const cartesian = comps.find((c) => c.id === 'CartesianComposer');
    expect(cartesian?.dynamic).toBe(true);
    const overlay = comps.find((c) => c.id === 'SkyframeOverlay');
    expect(overlay).toMatchObject({ width: 1080, height: 1920, fps: 30, durationInFrames: 1500 });
  });

  it('follows the SF_CHUNK_TYPES spread in the canvas nodeTypes registry', () => {
    const nodes = manifest.sections.canvasNodes;
    expect(nodes).toContain('generator');
    expect(nodes).toContain('qc-gate');
    expect(nodes.some((n) => n.startsWith('sf-'))).toBe(true);
  });

  it('keeps broll items lean (id/slug/durationSec only) and cliVerbs curated', () => {
    const item = manifest.sections.brollCatalog.items[0];
    expect(Object.keys(item).sort()).toEqual(['durationSec', 'id', 'slug']);
    for (const v of manifest.sections.cliVerbs) {
      expect(v.source).toBe('curated');
      expect(v.description).toBeTruthy();
    }
  });

  it('emits recipes with id/name/description', () => {
    for (const r of manifest.sections.recipes) {
      expect(r.id).toBeTruthy();
      expect(r.name).toBeTruthy();
    }
    expect(manifest.sections.recipes.some((r) => r.description)).toBe(true);
  });
});

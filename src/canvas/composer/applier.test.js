import { describe, it, expect } from 'vitest';
import { validateSpec, applySpec, applyRevision } from './applier';
import { FEWSHOTS } from './fewshots';
import { defaultCharacters } from '../../data/characters';

// Pull the demo character straight from the shipped roster so the fixture stays
// in lockstep with characters.js (and matches the characterId the fewshots use).
const MIA = defaultCharacters.find((c) => c.id === 'mia-chen');

const okSpec = {
  intent: 't', lane: 'video',
  nodes: [
    { ref: 'n1', type: 'niche-gen', config: { topic: 'AI myths' } },
    { ref: 'n2', type: 'gami-art', config: {} },
  ],
  edges: [{ from: 'n1', to: 'n2' }],
};

describe('validateSpec', () => {
  it('accepts a clean spec — only the soft deliverable warning', () => {
    const r = validateSpec(okSpec);   // gami-art is not deliverable → 1 soft warning
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].toLowerCase()).toContain('deliverable');
    expect(r.nodes).toHaveLength(2);
  });

  it('drops unknown node types with a warning', () => {
    const r = validateSpec({ ...okSpec, nodes: [...okSpec.nodes, { ref: 'x', type: 'flux-capacitor', config: {} }] });
    expect(r.ok).toBe(true);
    expect(r.nodes).toHaveLength(2);
    expect(r.warnings.some((w) => w.includes('flux-capacitor'))).toBe(true);
  });

  it('drops unknown config fields with a warning', () => {
    const r = validateSpec({ ...okSpec, nodes: [{ ref: 'n1', type: 'niche-gen', config: { topic: 'x', fps: 60 } }, okSpec.nodes[1]] });
    expect(r.nodes[0].config.fps).toBeUndefined();
    expect(r.warnings.some((w) => w.includes('fps'))).toBe(true);
  });

  it('coerces invalid enum values to the default with a warning', () => {
    const r = validateSpec({ ...okSpec, nodes: [{ ref: 'n1', type: 'niche-gen', config: { topic: 'x', tone: 'sarcastic' } }, okSpec.nodes[1]] });
    expect(r.nodes[0].config.tone).toBe('educational');
    expect(r.warnings.some((w) => w.includes('tone'))).toBe(true);
  });

  it('warns when a required field is missing and drops the node', () => {
    const r = validateSpec({ ...okSpec, nodes: [{ ref: 'n1', type: 'character', config: {} }, okSpec.nodes[1]], edges: [] });
    expect(r.nodes.find((n) => n.ref === 'n1')).toBeUndefined();
    expect(r.warnings.some((w) => w.includes('characterId'))).toBe(true);
  });

  it('drops edges that reference missing refs, with a warning', () => {
    const r = validateSpec({ ...okSpec, edges: [...okSpec.edges, { from: 'n1', to: 'ghost' }] });
    expect(r.edges).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes('ghost'))).toBe(true);
  });

  it('rejects the whole spec on a cycle', () => {
    const r = validateSpec({ ...okSpec, edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n1' }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cycle/i);
  });

  it('warns (does not reject) when no deliverable-flagged node is present', () => {
    const r = validateSpec(okSpec); // gami-art is not deliverable
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.toLowerCase().includes('deliverable'))).toBe(true);
  });
});

const CTX = {
  characters: [{
    id: MIA.id, name: MIA.name, accentColor: MIA.accentColor,
    painPoints: MIA.painPoints,
    hooks: MIA.hooks,
  }],
  scriptTypes: [{ id: 'st-story', name: 'Story', duration: '45s' }],
  conversionLevels: [{ id: 'cv-soft', name: 'Soft', ratio: '70/25/5' }],
};

const ugcSpec = {
  intent: 'Mia UGC test', lane: 'ugc',
  nodes: [
    { ref: 'char', type: 'character', config: { characterId: 'mia-chen' } },
    { ref: 'pp', type: 'ingredient', config: { kind: 'pp', index: 1 } },
    { ref: 'gen', type: 'ugc-gen', config: {} },
  ],
  edges: [{ from: 'char', to: 'pp' }, { from: 'pp', to: 'gen' }],
};

describe('applySpec', () => {
  it('materializes ghost nodes with deterministic ids and positions', () => {
    const r = applySpec(ugcSpec, { ctx: CTX, batchId: 3, origin: { x: 1000, y: 80 } });
    expect(r.ok).toBe(true);
    const ids = r.nodes.map((n) => n.id);
    expect(ids).toEqual(['cmp-3-char', 'cmp-3-pp', 'cmp-3-gen']);
    expect(r.nodes.every((n) => n.data.ghost === true)).toBe(true);
    expect(r.nodes.every((n) => n.className === 'cv-ghost')).toBe(true);
    expect(r.nodes[0].position.x).toBe(1000);
  });

  it('hydrates character config into the full character object', () => {
    const r = applySpec(ugcSpec, { ctx: CTX, batchId: 1, origin: { x: 0, y: 0 } });
    const char = r.nodes.find((n) => n.id === 'cmp-1-char');
    expect(char.data.character.name).toBe(MIA.name);
  });

  it('hydrates ingredient text from the upstream character', () => {
    const r = applySpec(ugcSpec, { ctx: CTX, batchId: 1, origin: { x: 0, y: 0 } });
    const pp = r.nodes.find((n) => n.id === 'cmp-1-pp');
    expect(pp.data.text).toBe(MIA.painPoints[1]);   // ugcSpec selects index 1
    expect(pp.data.kind).toBe('pp');
  });

  it('drops nodes whose hydrate returns null, with a warning, and culls their edges', () => {
    const bad = { ...ugcSpec, nodes: [{ ref: 'char', type: 'character', config: { characterId: 'nobody' } }, ...ugcSpec.nodes.slice(1)] };
    const r = applySpec(bad, { ctx: CTX, batchId: 1, origin: { x: 0, y: 0 } });
    expect(r.nodes.find((n) => n.id === 'cmp-1-char')).toBeUndefined();
    expect(r.edges.find((e) => e.source === 'cmp-1-char')).toBeUndefined();
    expect(r.warnings.some((w) => w.includes('char'))).toBe(true);
  });

  it('builds pulse edges with deterministic ids and ghost styling', () => {
    const r = applySpec(ugcSpec, { ctx: CTX, batchId: 2, origin: { x: 0, y: 0 } });
    const e = r.edges[0];
    expect(e.id).toBe('cmp-2-e-char-pp');
    expect(e.source).toBe('cmp-2-char');
    expect(e.target).toBe('cmp-2-pp');
    expect(e.type).toBe('pulse');
    expect(e.sourceHandle).toBe('out');
    expect(e.targetHandle).toBe('in');
    expect(e.className).toBe('cv-ghost-edge');
  });

  it('drops duplicate refs after the first, with a warning', () => {
    const dup = { ...ugcSpec, nodes: [...ugcSpec.nodes, { ref: 'char', type: 'character', config: { characterId: 'mia-chen' } }] };
    const r = applySpec(dup, { ctx: CTX, batchId: 1, origin: { x: 0, y: 0 } });
    expect(r.nodes.filter((n) => n.id === 'cmp-1-char')).toHaveLength(1);
    expect(r.warnings.some((w) => /duplicate/i.test(w) && w.includes('char'))).toBe(true);
  });

  it('cascade-drops: char hydrate null takes dependent ingredient (two warnings)', () => {
    const bad = { ...ugcSpec, nodes: [{ ref: 'char', type: 'character', config: { characterId: 'nobody' } }, ...ugcSpec.nodes.slice(1)] };
    const r = applySpec(bad, { ctx: CTX, batchId: 1, origin: { x: 0, y: 0 } });
    expect(r.nodes.filter((n) => n.type !== 'ugc-gen')).toHaveLength(0);  // char AND pp both dropped
    expect(r.warnings.filter((w) => w.includes("didn't resolve"))).toHaveLength(2);
  });
});

describe('applySpec edge handles', () => {
  // Edge handle ids must match the real <Handle id="..."> declarations in the
  // CanvasView node components — React Flow refuses edges whose handle ids
  // don't exist (error #008) and the ghost wiring renders invisible. Ids
  // harvested from the live components during the 2026-06-12 live-fire.
  const handlesFor = (spec) => {
    const r = applySpec(spec, { ctx: CTX, batchId: 7, origin: { x: 0, y: 0 } });
    expect(r.ok).toBe(true);
    return Object.fromEntries(r.edges.map((e) => [
      e.id.replace('cmp-7-e-', ''), { s: e.sourceHandle, t: e.targetHandle },
    ]));
  };

  it('UGC lane edges carry the real component handle ids', () => {
    const h = handlesFor(FEWSHOTS[0].spec);
    expect(h['pp-gen']).toEqual({ s: 'out', t: 'pp' });
    expect(h['hk-gen']).toEqual({ s: 'out', t: 'hk' });
    expect(h['st-gen']).toEqual({ s: 'out', t: 'st' });
    expect(h['cv-gen']).toEqual({ s: 'out', t: 'cv' });
    expect(h['gen-split']).toEqual({ s: 'script-out', t: 'script-in' });
    expect(h['split-video']).toEqual({ s: 'clips-out', t: 'clips-in' });
    expect(h['frames-video']).toEqual({ s: 'frames-out', t: 'frames-in' });
    // AvatarFrameNode has NO target handle — the edge must omit targetHandle
    // (RF auto-attach behavior) rather than invent an id RF will refuse.
    expect(h['split-frames'].s).toBe('clips-out');
    expect(h['split-frames'].t).toBeUndefined();
  });

  it('carousel-video lane docks art and script on distinct carousel handles', () => {
    const h = handlesFor(FEWSHOTS[1].spec);
    expect(h['script-title']).toEqual({ s: 'script-out', t: 'script-in' });
    expect(h['script-art']).toEqual({ s: 'script-out', t: 'script-in' });
    expect(h['title-sandwich']).toEqual({ s: 'title-out', t: 'first-in' });
    expect(h['art-sandwich']).toEqual({ s: 'image-out', t: 'last-in' });
    expect(h['art-deck']).toEqual({ s: 'image-out', t: 'art-in' });
    expect(h['script-deck']).toEqual({ s: 'script-out', t: 'script-in' });
    expect(h['sandwich-comp']).toEqual({ s: 'video-out', t: 'videos-in' });
    expect(h['deck-comp']).toEqual({ s: 'carousel-out', t: 'slides-in' });
  });

  it('video lane reaches qc-gate and postiz on their real handles', () => {
    const h = handlesFor(FEWSHOTS[3].spec);
    expect(h['art-vprompt']).toEqual({ s: 'image-out', t: 'art-in' });
    expect(h['script-vprompt']).toEqual({ s: 'script-out', t: 'script-in' });
    expect(h['vprompt-vid']).toEqual({ s: 'vidprompt-out', t: 'vidprompt-in' });
    expect(h['art-vid']).toEqual({ s: 'image-out', t: 'vidprompt-in' });
    expect(h['vid-qc']).toEqual({ s: 'video-out', t: 'qc-in' });
    expect(h['qc-post']).toEqual({ s: 'qc-pass', t: 'media-in' });
  });
});

describe('applyRevision', () => {
  const baseSpec = ugcSpec;
  const deps = { ctx: CTX, batchId: 9, origin: { x: 0, y: 0 } };

  it('keeps untouched refs (position preserved after manual drag)', () => {
    const first = applySpec(baseSpec, deps);
    // A user drags the character node somewhere personal
    const dragged = first.nodes.map((n) => n.id === 'cmp-9-char' ? { ...n, position: { x: 42, y: 999 } } : n);
    const r = applyRevision(dragged, first.edges, baseSpec, deps, []);
    expect(r.nodes.find((n) => n.id === 'cmp-9-char').position).toEqual({ x: 42, y: 999 });
  });

  it('updates config-changed refs in place, keeping position', () => {
    const first = applySpec(baseSpec, deps);
    const revised = { ...baseSpec, nodes: baseSpec.nodes.map((n) => n.ref === 'pp' ? { ...n, config: { kind: 'hk', index: 0 } } : n) };
    const r = applyRevision(first.nodes, first.edges, revised, deps, []);
    const pp = r.nodes.find((n) => n.id === 'cmp-9-pp');
    expect(pp.data.kind).toBe('hk');
    expect(pp.data.text).toBe(MIA.hooks[0]);   // revised config selects hook index 0
  });

  it('adds new refs and removes dropped refs (with their edges)', () => {
    const first = applySpec(baseSpec, deps);
    const revised = {
      ...baseSpec,
      nodes: [...baseSpec.nodes.filter((n) => n.ref !== 'gen'), { ref: 'split', type: 'clip-splitter', config: {} }],
      edges: [{ from: 'char', to: 'pp' }, { from: 'pp', to: 'split' }],
    };
    const r = applyRevision(first.nodes, first.edges, revised, deps, []);
    expect(r.nodes.find((n) => n.id === 'cmp-9-gen')).toBeUndefined();
    expect(r.nodes.find((n) => n.id === 'cmp-9-split')).toBeTruthy();
    expect(r.edges.some((e) => e.id === 'cmp-9-e-pp-split')).toBe(true);
  });

  it('never resurrects rejected refs', () => {
    const first = applySpec(baseSpec, deps);
    const r = applyRevision(first.nodes, first.edges, baseSpec, deps, ['gen']);
    expect(r.nodes.find((n) => n.id === 'cmp-9-gen')).toBeUndefined();
  });
});

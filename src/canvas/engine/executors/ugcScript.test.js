// src/canvas/engine/executors/ugcScript.test.js
import { describe, it, expect } from 'vitest';
import { ugcScriptExecutor } from './ugcScript.js';
import { buildSystemPrompt, buildUserPrompt, buildProductionPrompts } from '../../../data/scriptPrompts.js';

const fakeFetch = (handler) => async (url, opts) => {
  const body = JSON.parse(opts.body);
  const r = handler(url, body);
  return { ok: r.status ? r.status < 400 : true, status: r.status || 200, json: async () => r.json };
};

// Fixture character — carries every field the scriptPrompts builders touch.
const fixtureCharacter = {
  id: 'mia-chen',
  name: 'Mia Chen',
  handle: '@miachen',
  niche: 'Backyard Birding',
  tagline: 'The birds are talkin. Learn to listen.',
  demographic: 'Retirees 55+',
  voice: 'Warm gravelly Appalachian drawl. Slow deliberate pacing with long pauses.',
  avatar: 'A weathered person in their late 60s with kind eyes and a flannel shirt. Lighting is golden hour through porch slats.',
  ctaStyle: 'Soft front-porch invitation, never pushy.',
  monetization: { product: 'Backyard Birding Field Guide', price: '$9' },
  painPoints: ['They spend hundreds on feeders nothing visits.', 'They feel invisible after retirement.'],
  hooks: ['If you hear this sound, look up.', 'Your backyard is louder than you think.'],
};

// Input factories — mirror the sourceData shapes executeGraph hands executors:
// spawned ingredient nodes carry { label, text, index, accent, kind }, type
// selector nodes carry { stId } / { cvId }, character nodes carry { character }.
const charInput = (character = fixtureCharacter) =>
  ({ sourceId: 'char-1', sourceType: 'character', sourceData: { character }, output: undefined, edge: {} });
const ingInput = (kind, index, extra = {}) =>
  ({ sourceId: `${kind}-${index}`, sourceType: 'ingredient', sourceData: { label: `${kind} #${index + 1}`, text: 'ingredient text', index, accent: '#C9A227', kind, ...extra }, output: undefined, edge: {} });
const stInput = (stId) => ({ sourceId: 'st-1', sourceType: 'scriptType', sourceData: { stId }, output: undefined, edge: {} });
const cvInput = (cvId) => ({ sourceId: 'cv-1', sourceType: 'conversionLevel', sourceData: { cvId }, output: undefined, edge: {} });

const fullInputs = () => [charInput(), ingInput('pp', 1), ingInput('hk', 0), stInput('problem-solution'), cvInput('soft-bridge')];

// resolvePipeline's selections shape (CanvasView.jsx:2429): pain point + hook
// are INDEXES into character.painPoints/hooks; script type + conversion level
// are id strings; trigger/ctaMechanism null on the canvas path.
const expectedSelections = { painPoint: 1, hook: 0, scriptType: 'problem-solution', conversionLevel: 'soft-bridge', trigger: null, ctaMechanism: null };

const baseCtx = (overrides = {}) => ({
  node: { id: 'ug1', type: 'ugc-gen', data: {} },
  inputs: fullInputs(),
  outputs: {},
  report: () => {},
  server: 'http://test:3001',
  keys: { anthropic: 'ak', kie: 'kk', model: 'claude-sonnet-4-6' },
  ...overrides,
});

describe('ugcScriptExecutor', () => {
  it('is retryable (LLM call)', () => {
    expect(ugcScriptExecutor.retryable).toBe(true);
  });

  it('posts the real builder prompts to /api/generate and returns the legacy output shape', async () => {
    let captured;
    const ctx = baseCtx({
      fetchImpl: fakeFetch((url, body) => {
        captured = { url, body };
        return { json: { content: [{ type: 'text', text: '[HOOK]\nIf you hear this sound, look up.' }] } };
      }),
    });
    const out = await ugcScriptExecutor.execute(ctx);
    expect(captured.url).toBe('http://test:3001/api/generate');
    expect(captured.body.apiKey).toBe('ak');
    expect(captured.body.model).toBe('claude-sonnet-4-6');
    // Strict equality against the real builders proves both the selections
    // mapping and that the executor uses scriptPrompts.js verbatim.
    expect(captured.body.system).toBe(buildSystemPrompt(fixtureCharacter, expectedSelections));
    expect(captured.body.messages).toEqual([{ role: 'user', content: buildUserPrompt(fixtureCharacter, expectedSelections) }]);
    expect(out).toEqual({
      status: 'done',
      script: '[HOOK]\nIf you hear this sound, look up.',
      prompts: buildProductionPrompts(fixtureCharacter, expectedSelections, '[HOOK]\nIf you hear this sound, look up.'),
      character: fixtureCharacter,
      error: '',
    });
  });

  it('maps pp/hk indexes and stId/cvId into the selections the classic flow uses', async () => {
    let captured;
    const ctx = baseCtx({
      inputs: [charInput(), ingInput('pp', 0), ingInput('hk', 1), stInput('quiet-truth'), cvInput('direct-ask')],
      fetchImpl: fakeFetch((url, body) => {
        captured = body;
        return { json: { content: [{ type: 'text', text: 'script' }] } };
      }),
    });
    await ugcScriptExecutor.execute(ctx);
    const sel = { painPoint: 0, hook: 1, scriptType: 'quiet-truth', conversionLevel: 'direct-ask', trigger: null, ctaMechanism: null };
    expect(captured.system).toBe(buildSystemPrompt(fixtureCharacter, sel));
    expect(captured.system).toContain('They spend hundreds on feeders nothing visits.');
    expect(captured.system).toContain('Your backyard is louder than you think.');
    expect(captured.system).toContain('Quiet Truth');
    expect(captured.system).toContain('Direct Ask');
  });

  it('finds the character on any input sourceData (conductor-hydrated ingredient, no character node)', async () => {
    const ctx = baseCtx({
      inputs: [ingInput('pp', 1, { character: fixtureCharacter }), ingInput('hk', 0), stInput('problem-solution'), cvInput('soft-bridge')],
      fetchImpl: fakeFetch(() => ({ json: { content: [{ type: 'text', text: 'script' }] } })),
    });
    const out = await ugcScriptExecutor.execute(ctx);
    expect(out.character).toEqual(fixtureCharacter);
    expect(out.status).toBe('done');
  });

  it('walks one hop upstream through ingredient inputs to find the character (conductor lane shape)', async () => {
    // Live-fire 2026-06-12: the canonical lane wires char → ingredient → ugc-gen
    // (house rule: never char → ugc-gen directly), and conductor-hydrated
    // ingredients carry no character object. The executor must walk the graph.
    const ctx = baseCtx({
      inputs: [ingInput('pp', 1), ingInput('hk', 0), stInput('problem-solution'), cvInput('soft-bridge')],
      nodes: [
        { id: 'char-node', type: 'character', data: { character: fixtureCharacter } },
        { id: 'pp-1', type: 'ingredient', data: { kind: 'pp', index: 1 } },
        { id: 'hk-0', type: 'ingredient', data: { kind: 'hk', index: 0 } },
        { id: 'ug1', type: 'ugc-gen', data: {} },
      ],
      edges: [
        { id: 'e1', source: 'char-node', target: 'pp-1' },
        { id: 'e2', source: 'char-node', target: 'hk-0' },
        { id: 'e3', source: 'pp-1', target: 'ug1' },
        { id: 'e4', source: 'hk-0', target: 'ug1' },
      ],
      fetchImpl: fakeFetch(() => ({ json: { content: [{ type: 'text', text: 'script' }] } })),
    });
    const out = await ugcScriptExecutor.execute(ctx);
    expect(out.character).toEqual(fixtureCharacter);
    expect(out.status).toBe('done');
  });

  it('throws when no input yields a character', async () => {
    const ctx = baseCtx({
      inputs: [ingInput('pp', 1), ingInput('hk', 0), stInput('problem-solution'), cvInput('soft-bridge')],
      fetchImpl: fakeFetch(() => ({ json: { content: [{ type: 'text', text: 'script' }] } })),
    });
    await expect(ugcScriptExecutor.execute(ctx))
      .rejects.toThrow('ugc-gen: no character wired (wire Character → Ingredient → here)');
  });

  it('throws naming each missing ingredient or type selector', async () => {
    await expect(ugcScriptExecutor.execute(baseCtx({
      inputs: [charInput(), ingInput('pp', 1), stInput('problem-solution'), cvInput('soft-bridge')],
    }))).rejects.toThrow(/hook/i);
    await expect(ugcScriptExecutor.execute(baseCtx({
      inputs: [charInput(), ingInput('pp', 1), ingInput('hk', 0)],
    }))).rejects.toThrow(/script type.*conversion level/i);
    await expect(ugcScriptExecutor.execute(baseCtx({
      inputs: [charInput()],
    }))).rejects.toThrow(/pain point/i);
  });

  it('accepts index 0 ingredients (no falsy-zero bug)', async () => {
    const ctx = baseCtx({
      inputs: [charInput(), ingInput('pp', 0), ingInput('hk', 0), stInput('problem-solution'), cvInput('no-cta')],
      fetchImpl: fakeFetch(() => ({ json: { content: [{ type: 'text', text: 'script' }] } })),
    });
    const out = await ugcScriptExecutor.execute(ctx);
    expect(out.status).toBe('done');
  });

  it('throws on missing Anthropic key', async () => {
    await expect(ugcScriptExecutor.execute(baseCtx({ keys: { anthropic: '', model: 'm' } })))
      .rejects.toThrow('Anthropic API key missing');
  });

  it('reports the legacy generating patch before the call', async () => {
    const patches = [];
    const ctx = baseCtx({
      report: (p) => patches.push(p),
      fetchImpl: fakeFetch(() => ({ json: { content: [{ type: 'text', text: 'x' }] } })),
    });
    await ugcScriptExecutor.execute(ctx);
    expect(patches[0]).toEqual({ status: 'generating', script: '', prompts: null, error: '' });
  });

  it('throws on HTTP error', async () => {
    const ctx = baseCtx({ fetchImpl: fakeFetch(() => ({ status: 503, json: {} })) });
    await expect(ugcScriptExecutor.execute(ctx)).rejects.toThrow(/API error 503/);
  });

  it('throws on empty script (no content block or blank text)', async () => {
    await expect(ugcScriptExecutor.execute(baseCtx({
      fetchImpl: fakeFetch(() => ({ json: { content: [] } })),
    }))).rejects.toThrow('Empty script returned');
    await expect(ugcScriptExecutor.execute(baseCtx({
      fetchImpl: fakeFetch(() => ({ json: { content: [{ type: 'text', text: '' }] } })),
    }))).rejects.toThrow('Empty script returned');
  });
});

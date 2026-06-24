// src/canvas/engine/executors/clipSplit.test.js
import { describe, it, expect } from 'vitest';
import { defaultCharacters } from '../../../data/characters.js';
import { clipSplitExecutor } from './clipSplit.js';

const mia = defaultCharacters.find((c) => c.id === 'mia-chen');
const SCRIPT = "Hey y'all. Cardinals remember faces. Follow for more.";

// Expected CHARACTER strings derived from the demo character's sora2 ugc data.
// Sanitized (em-dash -> hyphen) to match buildClipSplitSystemPrompt / assembleClipPrompts.
// Full ugc.character (system prompt) starts with this; the assembled prompt collapses
// to the first sentence (charEssence).
const MIA_CHAR_PREFIX = 'CHARACTER: A 24-year-old East Asian woman with clear glowing skin';
const MIA_CHAR_ESSENCE =
  'CHARACTER: A 24-year-old East Asian woman with clear glowing skin showing natural texture - visible pores, small freckles across her nose.';

const fakeFetch = (handler) => async (url, opts) => {
  const body = JSON.parse(opts.body);
  const r = handler(url, body);
  return { ok: r.status ? r.status < 400 : true, status: r.status || 200, json: async () => r.json };
};

// Messy-but-repairable model reply: markdown fences + an interior unescaped quote.
const MESSY_RAW = [
  '```json',
  '[',
  '  { "type": "hook", "duration": 9, "dialogue": "Cardinals remember "your" face", "scene_action": "Mia leans toward the camera", "camera": "Slow push-in", "mood": "warm" },',
  '  { "type": "broll", "duration": 10, "dialogue": "", "scene_action": "Close-up of the platform feeder", "camera": "Static", "mood": "calm" }',
  ']',
  '```',
].join('\n');

const ugcGenInput = () => ({
  sourceId: 'ug1',
  sourceType: 'ugc-gen',
  sourceData: null,
  output: { status: 'done', script: SCRIPT, prompts: [], character: mia, error: '' },
  edge: {},
});

const baseCtx = (overrides = {}) => ({
  node: { id: 'cs1', type: 'clip-splitter', data: {} },
  inputs: [ugcGenInput()],
  outputs: {},
  report: () => {},
  server: 'http://test:3001',
  keys: { anthropic: 'ak', kie: 'kk', model: 'claude-sonnet-4-6' },
  ...overrides,
});

describe('clipSplitExecutor', () => {
  it('is retryable (LLM call)', () => {
    expect(clipSplitExecutor.retryable).toBe(true);
  });

  it('posts the V4 clip-split request and returns assembled clips in the legacy shape', async () => {
    let captured;
    const ctx = baseCtx({
      fetchImpl: fakeFetch((url, body) => {
        captured = { url, body };
        return { json: { content: [{ type: 'text', text: MESSY_RAW }] } };
      }),
    });
    const out = await clipSplitExecutor.execute(ctx);

    expect(captured.url).toBe('http://test:3001/api/generate');
    expect(captured.body.apiKey).toBe('ak');
    expect(captured.body.model).toBe('claude-sonnet-4-6');
    // System prompt built for the upstream ugc-gen output's character.
    expect(captured.body.system).toContain('You are a video clip planner for AI avatar UGC content.');
    expect(captured.body.system).toContain(MIA_CHAR_PREFIX);
    // User message EXACT (legacy string, CanvasView.jsx:14713).
    expect(captured.body.messages).toEqual([
      { role: 'user', content: `Split this script into 9-second video clips:\n\n${SCRIPT}` },
    ]);

    // Legacy output shape: { status: 'done', clips, error: '' }.
    expect(out.status).toBe('done');
    expect(out.error).toBe('');
    expect(out.clips).toHaveLength(2);

    // Dialogue variant: fences stripped, interior quote repaired, raw fields kept.
    const dlg = out.clips[0];
    expect(dlg.type).toBe('hook');
    expect(dlg.duration).toBe(9);
    expect(dlg.dialogue).toBe('Cardinals remember "your" face');
    expect(dlg.prompt).not.toContain('VISUAL PROMPT:'); // lean V4 dropped the header
    expect(dlg.prompt).toContain('LOOK: iPhone 15 Pro front-camera selfie');
    expect(dlg.prompt).toContain(MIA_CHAR_ESSENCE);
    expect(dlg.prompt).toContain('SCENE ACTION: Mia leans toward the camera');
    expect(dlg.prompt).toContain('CAMERA: Slow push-in');
    expect(dlg.prompt).toContain('MOOD: warm');
    expect(dlg.prompt).toContain(`DIALOGUE: 'Cardinals remember "your" face'`);
    expect(dlg.prompt).toContain('PERFORMANCE (V4): Speaking mid-thought, not performing.');

    // B-roll variant: NONE dialogue + no-lip-movement performance block.
    const broll = out.clips[1];
    expect(broll.prompt).toContain('SCENE ACTION: Close-up of the platform feeder');
    expect(broll.prompt).toContain('DIALOGUE: NONE - voiceover in post');
    expect(broll.prompt).toContain('PERFORMANCE: NO dialogue, NO lip movement. Pure physical presence. Breathing visible.');
    expect(broll.prompt).not.toContain('PERFORMANCE (V4)');
  });

  it('reports generating status with empty clips before the call', async () => {
    const patches = [];
    const ctx = baseCtx({
      report: (p) => patches.push(p),
      fetchImpl: fakeFetch(() => ({ json: { content: [{ type: 'text', text: '[]' }] } })),
    });
    await clipSplitExecutor.execute(ctx);
    expect(patches[0]).toEqual({ status: 'generating', clips: [], error: '' });
  });

  it('falls back to scanning ctx.outputs for a script and tolerates a missing character', async () => {
    let captured;
    const ctx = baseCtx({
      inputs: [],
      outputs: { ng1: { status: 'done', script: SCRIPT, error: '' } },
      fetchImpl: fakeFetch((url, body) => {
        captured = body;
        return { json: { content: [{ type: 'text', text: '[]' }] } };
      }),
    });
    const out = await clipSplitExecutor.execute(ctx);
    expect(captured.messages[0].content).toBe(`Split this script into 9-second video clips:\n\n${SCRIPT}`);
    // No character anywhere — buildClipSplitSystemPrompt fallbacks kick in.
    expect(captured.system).toContain('SPEECH STYLE: Speaks naturally as the character. Conversational cadence.');
    expect(out).toEqual({ status: 'done', clips: [], error: '' });
  });

  it('uses input sourceData.character when the script output carries no character', async () => {
    let captured;
    const ctx = baseCtx({
      inputs: [{
        sourceId: 'ng1', sourceType: 'niche-gen', sourceData: { character: mia },
        output: { status: 'done', script: SCRIPT, error: '' }, edge: {},
      }],
      fetchImpl: fakeFetch((url, body) => {
        captured = body;
        return { json: { content: [{ type: 'text', text: '[]' }] } };
      }),
    });
    await clipSplitExecutor.execute(ctx);
    expect(captured.system).toContain(MIA_CHAR_PREFIX);
  });

  it('throws when no upstream script exists anywhere', async () => {
    const ctx = baseCtx({ inputs: [], outputs: {} });
    await expect(clipSplitExecutor.execute(ctx))
      .rejects.toThrow('no upstream script (run the ugc-gen node first or wire it in)');
  });

  it('throws when the Anthropic key is missing', async () => {
    const ctx = baseCtx({ keys: { anthropic: '', kie: 'kk', model: 'm' } });
    await expect(clipSplitExecutor.execute(ctx)).rejects.toThrow('Anthropic API key missing');
  });

  it('throws on HTTP error', async () => {
    const ctx = baseCtx({ fetchImpl: fakeFetch(() => ({ status: 503, json: {} })) });
    await expect(clipSplitExecutor.execute(ctx)).rejects.toThrow(/API error 503/);
  });

  it('throws Expected JSON array when the model returns a non-array', async () => {
    const ctx = baseCtx({
      fetchImpl: fakeFetch(() => ({ json: { content: [{ type: 'text', text: '{"type": "hook"}' }] } })),
    });
    await expect(clipSplitExecutor.execute(ctx)).rejects.toThrow('Expected JSON array');
  });

  it('prefixes irreparable JSON failures with "JSON parse failed:"', async () => {
    const ctx = baseCtx({
      fetchImpl: fakeFetch(() => ({ json: { content: [{ type: 'text', text: '[{"type": "hook",' }] } })),
    });
    await expect(clipSplitExecutor.execute(ctx)).rejects.toThrow(/^JSON parse failed: /);
  });
});

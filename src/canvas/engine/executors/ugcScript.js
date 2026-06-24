// src/canvas/engine/executors/ugcScript.js
/**
 * Engine executor for the ugc-gen node. Mirrors the legacy canvas path —
 * resolvePipeline's selections assembly (CanvasView.jsx:2398-2432) feeding
 * onGenerate's UGC branch (CanvasView.jsx:14009-14042, same fetch + output as
 * onUgcGenerate at 14588-14607) — and writes the same output shape:
 *   { status, script, prompts, character, error }
 *
 * Graph-derived, handle-agnostic (feedback_canvas_ux): everything comes from
 * the inputs' sourceData, auto-detected from node data exactly like
 * resolvePipeline — never from handle ids.
 */
import { buildSystemPrompt, buildUserPrompt, buildProductionPrompts } from '../../../data/scriptPrompts.js';

// First input whose sourceData carries a character object wins — covers
// character nodes wired directly ({ character }) and conductor-hydrated data.
// The canonical lane wires char → ingredient → ugc-gen (house rule: never
// char → ugc-gen directly) and ingredient data carries NO character, so we
// then walk ONE hop upstream from each input through ctx edges/nodes — the
// live-fire 2026-06-12 proved the direct-inputs-only version dead on arrival.
function deriveCharacter(inputs, nodes = [], edges = []) {
  for (const input of inputs) {
    if (input.sourceData?.character) return input.sourceData.character;
  }
  for (const input of inputs) {
    for (const edge of edges) {
      if (edge.target !== input.sourceId) continue;
      const upstream = nodes.find((nd) => nd.id === edge.source);
      if (upstream?.data?.character) return upstream.data.character;
    }
  }
  throw new Error('ugc-gen: no character wired (wire Character → Ingredient → here)');
}

// Mirrors resolvePipeline (CanvasView.jsx:2411-2429): first-wins per slot,
// `== null` guards so index 0 ingredients survive. Output is the EXACT
// selections shape buildSystemPrompt expects — painPoint/hook are indexes
// into character.painPoints/hooks, scriptType/conversionLevel are id strings
// resolved against src/data/scriptTypes.js inside the builders.
function deriveSelections(inputs) {
  let ppIndex = null, hkIndex = null, stId = null, cvId = null;
  for (const input of inputs) {
    const d = input.sourceData;
    if (!d) continue;
    if (d.kind === 'pp' && ppIndex == null) ppIndex = d.index;
    else if (d.kind === 'hk' && hkIndex == null) hkIndex = d.index;
    else if (d.stId != null && stId == null) stId = d.stId;
    else if (d.cvId != null && cvId == null) cvId = d.cvId;
  }

  const missing = [];
  if (ppIndex == null) missing.push('pain point (kind:pp ingredient)');
  if (hkIndex == null) missing.push('hook (kind:hk ingredient)');
  if (stId == null) missing.push('script type (stId selector)');
  if (cvId == null) missing.push('conversion level (cvId selector)');
  if (missing.length) throw new Error(`ugc-gen: missing ${missing.join(', ')}`);

  return { painPoint: ppIndex, hook: hkIndex, scriptType: stId, conversionLevel: cvId, trigger: null, ctaMechanism: null };
}

export const ugcScriptExecutor = {
  retryable: true, // LLM call — transient 529s happen
  async execute({ inputs = [], nodes = [], edges = [], report, server, keys, fetchImpl = fetch }) {
    const character = deriveCharacter(inputs, nodes, edges);
    const selections = deriveSelections(inputs);
    if (!keys.anthropic) throw new Error('Anthropic API key missing');

    report({ status: 'generating', script: '', prompts: null, error: '' });

    const system = buildSystemPrompt(character, selections);
    const user = buildUserPrompt(character, selections);

    const res = await fetchImpl(`${server}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: keys.anthropic, model: keys.model,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    const text = data.content?.[0]?.text || ''; // legacy extraction — first block only
    if (!text) throw new Error('Empty script returned');
    return { status: 'done', script: text, prompts: buildProductionPrompts(character, selections, text), character, error: '' };
  },
};

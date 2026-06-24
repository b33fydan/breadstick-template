// src/canvas/engine/executors/clipSplit.js
/**
 * Engine executor for the clip-splitter node. Mirrors onClipSplit
 * (CanvasView.jsx ~14625-14784, base cb7e2f8): V4 clip planning via the
 * shared ugcPrompts module — system prompt, JSON repair walker, prompt
 * assembly. Output shape matches the legacy handler exactly:
 *   { status: 'done', clips, error: '' }
 * where each clip keeps the raw fields Claude returned plus the assembled
 * V4 `prompt` string.
 */
import { buildClipSplitSystemPrompt, repairClipJson, assembleClipPrompts } from '../ugcPrompts.js';

// Same helper pattern as imageBatch.js upstreamScript, but returns the whole
// output object so the character can be lifted from the same upstream node
// (ugc-gen output carries it).
function upstreamScriptOutput(inputs, outputs) {
  for (const input of inputs) {
    if (input.output?.script && input.output.status === 'done') return input.output;
  }
  // Fallback scan — same flexibility the node UIs have today.
  for (const out of Object.values(outputs || {})) {
    if (out?.script && out.status === 'done') return out;
  }
  throw new Error('no upstream script (run the ugc-gen node first or wire it in)');
}

// Character preference: the script-bearing output's own character (ugc-gen
// carries it) → any wired input's sourceData.character → undefined
// (buildClipSplitSystemPrompt handles all fallbacks).
function upstreamCharacter(scriptOutput, inputs) {
  if (scriptOutput?.character) return scriptOutput.character;
  for (const input of inputs) {
    if (input.sourceData?.character) return input.sourceData.character;
  }
  return undefined;
}

export const clipSplitExecutor = {
  retryable: true, // LLM call — transient 529s happen
  async execute({ inputs, outputs, report, server, keys, fetchImpl = fetch }) {
    if (!keys.anthropic) throw new Error('Anthropic API key missing');
    const scriptOutput = upstreamScriptOutput(inputs, outputs);
    const script = scriptOutput.script;
    const character = upstreamCharacter(scriptOutput, inputs);

    report({ status: 'generating', clips: [], error: '' });

    const res = await fetchImpl(`${server}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: keys.anthropic, model: keys.model,
        system: buildClipSplitSystemPrompt(character),
        messages: [{ role: 'user', content: `Split this script into 9-second video clips:\n\n${script}` }],
      }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    const raw = data.content?.[0]?.text || '';
    const repaired = repairClipJson(raw);
    let rawClips;
    try {
      rawClips = JSON.parse(repaired);
    } catch (parseErr) {
      throw new Error(`JSON parse failed: ${parseErr.message}`);
    }
    if (!Array.isArray(rawClips)) throw new Error('Expected JSON array');
    const clips = assembleClipPrompts(rawClips, character);
    return { status: 'done', clips, error: '' };
  },
};

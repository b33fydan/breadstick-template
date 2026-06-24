// src/canvas/engine/executors/imageBatch.js
/**
 * Shared kie image-batch executor base for gami-art and title-card nodes.
 * Output shape matches the legacy handlers exactly:
 *   { batchStatus: 'generating'|'done', slides: [{ status, url, taskId, elapsed, error }] }
 * (CanvasView.jsx:15477 — onTitleCardBatchGenerate)
 */
import { runKieBatch } from '../kieClient.js';
import { parseSlides, buildGamiPrompt, buildGamiCtaPrompt, buildTitleCardPrompt } from '../prompts.js';

function upstreamScript(inputs, outputs) {
  for (const input of inputs) {
    if (input.output?.script && input.output.status === 'done') return input.output.script;
  }
  // Fallback scan — same flexibility the node UIs have today.
  for (const out of Object.values(outputs || {})) {
    if (out?.script && out.status === 'done') return out.script;
  }
  throw new Error('no upstream script (run the niche-gen node first or wire it in)');
}

function makeImageBatchExecutor({ buildPrompt, extraPrompt, defaultAr, intervalSec, maxWaitSec }) {
  return {
    async execute({ node, inputs, outputs, report, server, keys, fetchImpl = fetch, sleepImpl }) {
      if (!keys.kie) throw new Error('kie.ai API key missing');
      const script = upstreamScript(inputs, outputs);
      const slides = parseSlides(script);
      const ar = node.data?.aspectRatio || defaultAr;
      const resolution = node.data?.resolution || '2K';
      const prompts = [...slides.map((s) => buildPrompt(s.text)), extraPrompt()];

      let snapshot = prompts.map(() => ({ status: 'submitting', url: '', taskId: '', elapsed: 0, error: '' }));
      report({ batchStatus: 'generating', slides: snapshot });
      const onItem = (i, patch) => {
        snapshot = snapshot.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
        report({ batchStatus: 'generating', slides: snapshot });
      };

      const results = await runKieBatch({
        server, kieKey: keys.kie, intervalSec, maxWaitSec, onItem, fetchImpl, sleepImpl,
        items: prompts.map((prompt) => ({
          model: 'nano-banana-pro',
          input: { prompt, image_input: [], aspect_ratio: ar, resolution, output_format: 'png' },
        })),
      });

      return { batchStatus: 'done', slides: results };
    },
  };
}

export const gamiArtExecutor = makeImageBatchExecutor({
  buildPrompt: buildGamiPrompt,
  extraPrompt: buildGamiCtaPrompt,
  defaultAr: '1:1',
  intervalSec: 10, maxWaitSec: 300, // matches legacy gami/title cadence
});

export const titleCardExecutor = makeImageBatchExecutor({
  buildPrompt: buildTitleCardPrompt,
  extraPrompt: () => buildTitleCardPrompt('Follow for more Cybersecurity and AI stories'),
  defaultAr: '9:16',
  intervalSec: 10, maxWaitSec: 300,
});

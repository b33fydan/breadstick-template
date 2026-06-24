// src/canvas/engine/executors/frameSandwich.js
/**
 * Frame Sandwich executor: pairs title-card[i] (first frame) with
 * gami-art[i] (last frame) and runs kling-3.0/video per pair.
 * Output shape matches onFrameSandwichGenerate (CanvasView.jsx:15545):
 *   { batchStatus, videos: [{ status, url, taskId, elapsed, error }] }
 */
import { runKieBatch } from '../kieClient.js';

// Copy the 'paper-unfold' string from pipeline-cli.js MOTIONS verbatim.
const DEFAULT_MOTION = 'Stop-motion animation of origami paper slowly unfolding and opening to reveal the scene beneath. Creased edges relax and flatten. Layered cardstock separates into depth planes. Paper fibers catch the light as folds release. Everything is paper — no wind, no particles. Smooth stop-motion paper craft animation.';

function doneUrls(inputs, sourceType) {
  const entry = inputs.find((i) => i.sourceType === sourceType && i.output?.slides);
  if (!entry) throw new Error(`no upstream ${sourceType} batch wired in`);
  return entry.output.slides.filter((s) => s.status === 'done' && s.url).map((s) => s.url);
}

export const frameSandwichExecutor = {
  async execute({ node, inputs, report, server, keys, fetchImpl = fetch, sleepImpl }) {
    if (!keys.kie) throw new Error('kie.ai API key missing');
    const titles = doneUrls(inputs, 'title-card');
    const arts = doneUrls(inputs, 'gami-art');
    const pairCount = Math.min(titles.length, arts.length);
    if (pairCount === 0) throw new Error('no completed title-card/gami-art pairs to sandwich');

    const { duration = '5', aspectRatio = '9:16', videoMode = 'pro', motionPrompt } = node.data || {};
    const prompt = motionPrompt || DEFAULT_MOTION;

    let snapshot = Array.from({ length: pairCount }, () => ({ status: 'submitting', url: '', taskId: '', elapsed: 0, error: '' }));
    report({ batchStatus: 'generating', videos: snapshot });
    const onItem = (i, patch) => {
      snapshot = snapshot.map((v, idx) => (idx === i ? { ...v, ...patch } : v));
      report({ batchStatus: 'generating', videos: snapshot });
    };

    const results = await runKieBatch({
      server, kieKey: keys.kie, intervalSec: 15, maxWaitSec: 600, onItem, fetchImpl, sleepImpl,
      items: Array.from({ length: pairCount }, (_, i) => ({
        model: 'kling-3.0/video',
        input: {
          prompt,
          image_urls: [titles[i], arts[i]],
          sound: false,
          duration: String(duration),
          aspect_ratio: aspectRatio,
          mode: videoMode,
          multi_shots: false,
          multi_prompt: [],
        },
      })),
    });

    return { batchStatus: 'done', videos: results };
  },
};

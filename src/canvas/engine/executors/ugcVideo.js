// src/canvas/engine/executors/ugcVideo.js
/**
 * UGC Video executor — the kie route of onUgcVideoBatchGenerate
 * (CanvasView.jsx:15157-15321, kie branch at L15222+). Pairs upstream clips
 * with avatar frames, resolves local frame paths to public URLs (kie File
 * Upload API first via /api/kie/upload-file — kie serves the frame from its
 * own CDN; /api/resolve-public-url is the fallback), then
 * fires Kling 3.0 img2vid through runKieBatch. Output shape matches legacy:
 *   { batchStatus: 'generating'|'done', videos: [{ status, url, taskId, elapsed, error }] }
 * Higgsfield (hf:) routes stay on the node's own button in v1.
 */
import { runKieBatch } from '../kieClient.js';

// First wired input with a done output carrying `key`; fallback-scan all
// outputs — same flexibility the node UIs have today (imageBatch pattern).
function upstreamList(inputs, outputs, key) {
  for (const input of inputs) {
    if (input.output?.[key] && input.output.status === 'done') return input.output[key];
  }
  for (const out of Object.values(outputs || {})) {
    if (out?.[key] && out.status === 'done') return out[key];
  }
  return [];
}

// Resolve one local frame path to a public URL kie's fetcher can pull.
// PRIMARY: kie's File Upload API (server proxies the base64 upload) — kie
// serves the frame from its own CDN, sidestepping the Cloudflare tunnel that
// doesn't route /api/local-image and the free hosts whose URLs kie's fetcher
// drops (RemoteDisconnected). kie's own error names this fix. FALLBACK:
// /api/resolve-public-url (tunnel-or-host upload, the legacy path). Throws only
// when BOTH routes fail — the caller turns that into a per-frame error slot.
async function resolveFrameUrl(framePath, { server, fetchImpl, kieKey }) {
  try {
    const res = await fetchImpl(`${server}/api/kie/upload-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: kieKey, path: framePath }),
    });
    const data = await res.json();
    if (res.ok && data.url) return data.url;
  } catch { /* fall through to the legacy resolver */ }
  const res = await fetchImpl(`${server}/api/resolve-public-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: framePath }),
  });
  const data = await res.json();
  if (!res.ok || !data.url) throw new Error(data.error || 'Resolve failed');
  return data.url;
}

export const ugcVideoExecutor = {
  async execute({ node, inputs, outputs, report, server, keys, fetchImpl = fetch, sleepImpl }) {
    const route = node.data?.route || 'kie:kling-3.0';
    if (route.startsWith('hf:')) {
      throw new Error('Higgsfield route not supported by Run Lane yet — use the node button');
    }
    if (!keys.kie) throw new Error('kie.ai API key missing');

    const clips = upstreamList(inputs, outputs, 'clips');
    const frames = upstreamList(inputs, outputs, 'images').map((i) => i.path);
    const pairCount = Math.min(clips.length, frames.length);
    if (pairCount === 0) throw new Error('ugc-video: need clips and avatar frames wired in');

    let videos = Array.from({ length: pairCount }, () => ({ status: 'resolving', url: '', taskId: '', elapsed: 0, error: '' }));
    report({ batchStatus: 'generating', videos });

    // Resolve local frame paths to public URLs (kie File Upload API first,
    // /api/resolve-public-url fallback — see resolveFrameUrl). A failed resolve
    // finalizes that index as an error and excludes the pair from submission
    // (legacy parity — CanvasView.jsx:15228-15247).
    const publicUrls = [];
    for (let i = 0; i < pairCount; i++) {
      const framePath = frames[i];
      const isLocal = /^[a-zA-Z]:/.test(framePath) || (framePath.startsWith('/') && !framePath.startsWith('http'));
      if (!isLocal) { publicUrls.push(framePath); continue; } // already a URL
      try {
        publicUrls.push(await resolveFrameUrl(framePath, { server, fetchImpl, kieKey: keys.kie }));
      } catch (err) {
        publicUrls.push(null);
        videos = videos.map((v, idx) => (idx === i ? { ...v, status: 'error', error: `Frame resolve failed: ${err.message}` } : v));
      }
    }

    videos = videos.map((v, i) => (publicUrls[i] ? { ...v, status: 'submitting' } : v));
    report({ batchStatus: 'generating', videos });

    // Submit only the resolvable pairs. runKieBatch indexes its items
    // batch-relative; submitIndexes maps them back to ABSOLUTE pair indexes
    // so pre-failed frames keep their error slots.
    const submitIndexes = [];
    const items = [];
    for (let i = 0; i < pairCount; i++) {
      if (!publicUrls[i]) continue;
      submitIndexes.push(i);
      items.push({
        model: 'kling-3.0/video',
        input: {
          prompt: clips[i].prompt,
          image_urls: [publicUrls[i]],
          sound: true,
          duration: String(clips[i].duration || 5),
          aspect_ratio: '9:16',
          mode: 'pro',
          multi_shots: false,
          multi_prompt: [],
        },
      });
    }

    const onItem = (batchIdx, patch) => {
      const abs = submitIndexes[batchIdx];
      videos = videos.map((v, idx) => (idx === abs ? { ...v, ...patch } : v));
      report({ batchStatus: 'generating', videos });
    };

    const results = items.length === 0 ? [] : await runKieBatch({
      server, kieKey: keys.kie, items, intervalSec: 15, maxWaitSec: 600, onItem, fetchImpl, sleepImpl,
    });

    const finalVideos = videos.slice();
    results.forEach((r, batchIdx) => { finalVideos[submitIndexes[batchIdx]] = r; });
    return { batchStatus: 'done', videos: finalVideos };
  },
};

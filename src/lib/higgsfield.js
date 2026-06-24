// Client-side wrapper for /api/higgsfield/* endpoints.
//
// Server shells out to the locally-installed Higgsfield CLI; this module is
// the client-side façade canvas nodes talk to. Mirrors the kie.ai client
// shape (estimateCost / uploadAsset / createJob / getJob / pollJobUntilDone)
// so node code stays clean and route-agnostic.
//
// Auto-upload note: pass a local absolute path to `image` / `endImage` and
// the CLI uploads it server-side — no need to call uploadAsset separately
// unless you want to chain the same upload across multiple jobs.

// Express proxy lives on 3001; browser runs on 5173. Always hit it absolutely.
const API_BASE = 'http://localhost:3001';

async function postJson(path, body) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status} on ${path}`);
  return data;
}

async function getJson(path) {
  const resp = await fetch(`${API_BASE}${path}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status} on ${path}`);
  return data;
}

export async function estimateCost(model, prompt) {
  return postJson('/api/higgsfield/cost', { model, prompt });
}

export async function uploadAsset(filePath) {
  return postJson('/api/higgsfield/upload', { path: filePath });
}

export async function createVideoJob({ model, prompt, image, endImage, duration, soulId, sound, mode }) {
  return postJson('/api/higgsfield/video', { model, prompt, image, endImage, duration, soulId, sound, mode });
}

export async function getJob(jobId) {
  return getJson(`/api/higgsfield/job/${encodeURIComponent(jobId)}`);
}

const TERMINAL_STATUSES = new Set([
  'done', 'completed', 'success', 'succeeded',
  'failed', 'error', 'canceled', 'cancelled',
]);

export async function pollJobUntilDone(jobId, { intervalMs = 3000, timeoutMs = 600000, onUpdate } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await getJob(jobId);
    if (typeof onUpdate === 'function') {
      try { onUpdate(job); } catch { /* user callback shouldn't break the poll */ }
    }
    const status = String(job?.status || '').toLowerCase();
    if (TERMINAL_STATUSES.has(status)) return job;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`pollJobUntilDone timed out after ${Math.round(timeoutMs / 1000)}s`);
}

// Verified via `higgsfield model list` 2026-05-08. Note: ids use no-dot, mixed-case style.
export const HIGGSFIELD_VIDEO_MODELS = [
  { id: 'kling3_0',     label: 'Kling v3.0' },
  { id: 'veo3_1',       label: 'Veo 3.1' },
  { id: 'seedance_2_0', label: 'Seedance 2.0' },
  { id: 'soul_cast',    label: 'Soul Cast' },
];

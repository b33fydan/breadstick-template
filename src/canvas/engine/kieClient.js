// src/canvas/engine/kieClient.js
/**
 * Browser-safe kie.ai client for the canvas engine.
 * Mirrors lib/cli-core.js semantics (state lists, resultJson parsing) but
 * has zero node-builtin imports and is progress-callback driven.
 */
const SUCCESS_STATES = ['success', 'completed', 'succeed'];
const FAIL_STATES = ['fail', 'failed'];

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createKieTask({ server, kieKey, model, input, fetchImpl = fetch }) {
  const res = await fetchImpl(`${server}/api/kie/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: kieKey, model, input }),
  });
  const data = await res.json();
  if (!res.ok || !data?.data?.taskId) {
    // kie.ai rejections come back as { code, msg, data: null } — surface msg.
    throw new Error(data?.error?.message || data?.error || data?.message || data?.msg || 'No taskId returned from kie.ai');
  }
  return data.data.taskId;
}

export async function pollKieTask({
  server, kieKey, taskId,
  intervalSec = 15, maxWaitSec = 600,
  onTick, fetchImpl = fetch, sleepImpl = defaultSleep,
}) {
  let elapsed = 0;
  while (elapsed < maxWaitSec) {
    await sleepImpl(intervalSec * 1000);
    elapsed += intervalSec;
    const res = await fetchImpl(`${server}/api/kie/status/${taskId}`, { headers: { 'x-kie-key': kieKey } });
    const pd = await res.json();
    const state = pd?.data?.state || pd?.data?.status || '';
    if (SUCCESS_STATES.includes(state)) {
      let resultJson = {};
      try { resultJson = JSON.parse(pd.data.resultJson || '{}'); } catch { /* malformed → empty */ }
      const urls = resultJson.resultUrls || [];
      return { url: urls[0] || '', urls, elapsed };
    }
    if (FAIL_STATES.includes(state)) {
      throw new Error(pd.data?.failMsg || 'Generation failed');
    }
    if (onTick) onTick({ elapsed });
  }
  throw new Error(`Timeout (${Math.round(maxWaitSec / 60)} min)`);
}

/**
 * Parallel batch: create+poll every item, report per-item patches through
 * onItem(index, patch). Per-item failure never sinks the batch.
 * Resolves [{ status: 'done'|'error', url, taskId, elapsed, error }].
 */
export async function runKieBatch({
  server, kieKey, items, onItem = () => {},
  intervalSec = 15, maxWaitSec = 600,
  fetchImpl = fetch, sleepImpl = defaultSleep,
}) {
  return Promise.all(items.map(async (item, i) => {
    try {
      const taskId = await createKieTask({ server, kieKey, model: item.model, input: item.input, fetchImpl });
      onItem(i, { status: 'polling', taskId });
      const r = await pollKieTask({
        server, kieKey, taskId, intervalSec, maxWaitSec,
        onTick: ({ elapsed }) => onItem(i, { elapsed }),
        fetchImpl, sleepImpl,
      });
      const done = { status: 'done', url: r.url, taskId, elapsed: r.elapsed, error: '' };
      onItem(i, done);
      return done;
    } catch (err) {
      const fail = { status: 'error', url: '', taskId: '', elapsed: 0, error: err.message };
      onItem(i, fail);
      return fail;
    }
  }));
}

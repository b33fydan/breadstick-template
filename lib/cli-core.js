/**
 * cli-core — shared plumbing for Breadstick's billing CLIs
 * (pipeline-cli.js, shortform-cli.js, maestro-cli.js).
 *
 * One Anthropic caller, one kie.ai create+poll path with a checkpoint
 * ledger, and the slug/timestamp/log helpers every CLI re-implemented.
 *
 * The checkpoint ledger is the load-bearing piece: kie.ai bills at task
 * CREATION, so a crashed or timed-out run that re-submits on retry pays
 * twice. runKieTask() records the taskId synchronously the moment it
 * exists; a re-run with the same checkpoint file resumes polling the
 * existing task instead of creating a new one.
 *
 * All network entry points accept fetchImpl/sleepImpl for testing.
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

// ── Small helpers ────────────────────────────────────────────────────────────

export function slugify(text, maxLen = 60, fallback = 'untitled') {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen) || fallback;
}

export function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function log(step, msg) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`[${ts}] [${step}] ${msg}`);
}

/** Stable identity for a kie work unit — checkpoint keys default to this. */
export function taskFingerprint(model, input) {
  return createHash('sha1').update(JSON.stringify({ model, input })).digest('hex').slice(0, 12);
}

// ── Server client ────────────────────────────────────────────────────────────

export function makeClient(server, { fetchImpl = fetch } = {}) {
  async function post(path, body, headers = {}) {
    const res = await fetchImpl(`${server}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || data?.error || `HTTP ${res.status}`);
    return data;
  }
  async function get(path, headers = {}) {
    const res = await fetchImpl(`${server}${path}`, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || data?.error || `HTTP ${res.status}`);
    return data;
  }
  return { post, get };
}

// ── Anthropic (via the :3001 proxy) ──────────────────────────────────────────

/**
 * Single Anthropic caller. Returns { text, content, data } where text joins
 * ALL text blocks — webSearch responses interleave server_tool_use blocks
 * that the old first-block-only extraction silently dropped.
 */
export async function callAnthropic({
  server,
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = 'claude-sonnet-4-6',
  system,
  messages,
  webSearch = false,
  maxTokens,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const { post } = makeClient(server, { fetchImpl });
  const body = { apiKey, model, system, messages };
  if (webSearch) body.webSearch = true;
  if (maxTokens) body.max_tokens = maxTokens;
  const data = await post('/api/generate', body);
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  const content = data.content || [];
  const text = content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return { text, content, data };
}

// ── kie.ai create + poll ─────────────────────────────────────────────────────

const KIE_SUCCESS_STATES = ['success', 'completed', 'succeed'];
const KIE_FAIL_STATES = ['fail', 'failed'];

export async function createKieTask({ server, kieKey, model, input, fetchImpl = fetch }) {
  const { post } = makeClient(server, { fetchImpl });
  const data = await post('/api/kie/create', { apiKey: kieKey, model, input });
  const taskId = data?.data?.taskId;
  if (!taskId) throw new Error('No taskId returned from kie.ai');
  return taskId;
}

/**
 * Poll one kie task to terminal state. Resolves { url, urls, resultJson,
 * elapsed }. Throws on explicit failure, timeout, or too many consecutive
 * poll errors (transient 404s/blips retry; a dead key shouldn't spin 10min).
 */
export async function pollKieTask({
  server,
  kieKey,
  taskId,
  maxWaitMs = 600000,
  intervalMs = 10000,
  maxConsecutiveErrors = 6,
  onTick,
  fetchImpl = fetch,
  sleepImpl = sleep,
}) {
  const { get } = makeClient(server, { fetchImpl });
  const start = Date.now();
  let consecutiveErrors = 0;
  while (Date.now() - start < maxWaitMs) {
    await sleepImpl(intervalMs);
    const elapsed = Math.round((Date.now() - start) / 1000);
    let pd;
    try {
      pd = await get(`/api/kie/status/${taskId}`, { 'x-kie-key': kieKey });
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw new Error(`Polling ${taskId} failed ${consecutiveErrors}x in a row: ${err.message}`);
      }
      continue;
    }
    const state = pd?.data?.state || pd?.data?.status || '';
    if (KIE_SUCCESS_STATES.includes(state)) {
      let resultJson = {};
      try { resultJson = JSON.parse(pd.data.resultJson || '{}'); } catch { /* malformed → empty */ }
      const urls = resultJson.resultUrls || [];
      return { url: urls[0] || '', urls, resultJson, elapsed };
    }
    if (KIE_FAIL_STATES.includes(state)) {
      throw new Error(pd.data?.failMsg || 'Generation failed');
    }
    if (onTick) onTick({ elapsed, state: state || 'pending' });
  }
  throw new Error(`Timeout after ${Math.round(maxWaitMs / 1000)}s (task ${taskId} may still complete — re-run with the same checkpoint to resume)`);
}

// ── Checkpoint ledger ────────────────────────────────────────────────────────

/**
 * Tiny synchronous JSON store: key → { taskId, status, url, ... }.
 * Statuses: 'submitted' (billed, in flight) | 'done' | 'failed'.
 * Writes go to disk on every set() so a crash never loses a taskId.
 */
export function openCheckpoint(file) {
  let store = {};
  if (existsSync(file)) {
    try { store = JSON.parse(readFileSync(file, 'utf8')); } catch { store = {}; }
  }
  function persist() {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(store, null, 2));
  }
  return {
    file,
    get(key) { return store[key] || null; },
    set(key, patch) {
      store[key] = { ...(store[key] || {}), ...patch, updatedAt: new Date().toISOString() };
      persist();
      return store[key];
    },
    all() { return { ...store }; },
  };
}

/**
 * Create-or-resume a kie task through a checkpoint.
 *  - done in ledger      → return cached result, zero network
 *  - submitted in ledger → poll the existing taskId (no re-bill)
 *  - failed / absent     → create fresh, record taskId immediately, poll
 *  - dryRun              → describe what would be billed, no network
 */
export async function runKieTask({
  server,
  kieKey,
  model,
  input,
  checkpoint = null,
  key = null,
  dryRun = false,
  onCreate,
  ...pollOpts
}) {
  const ckKey = key || taskFingerprint(model, input);
  if (dryRun) {
    return { dryRun: true, model, key: ckKey, promptPreview: String(input?.prompt || '').slice(0, 80) };
  }

  const prior = checkpoint?.get(ckKey);
  if (prior?.status === 'done') {
    return { url: prior.url, urls: prior.urls || [prior.url], resultJson: {}, elapsed: 0, cached: true };
  }

  let taskId = prior?.status === 'submitted' ? prior.taskId : null;
  const resumed = !!taskId;
  if (!taskId) {
    taskId = await createKieTask({ server, kieKey, model, input, fetchImpl: pollOpts.fetchImpl });
    checkpoint?.set(ckKey, { taskId, status: 'submitted', model });
  }
  if (onCreate) onCreate({ taskId, resumed });

  try {
    const result = await pollKieTask({ server, kieKey, taskId, ...pollOpts });
    checkpoint?.set(ckKey, { taskId, status: 'done', url: result.url, urls: result.urls });
    return { ...result, taskId, resumed };
  } catch (err) {
    // Timeouts stay 'submitted' so the next run resumes; explicit fails
    // are recorded so the next run re-creates.
    if (!/^Timeout after/.test(err.message) && !/failed \d+x in a row/.test(err.message)) {
      checkpoint?.set(ckKey, { taskId, status: 'failed', error: err.message });
    }
    throw err;
  }
}

/**
 * Submit-and-poll a batch in parallel. Same return contract the CLIs
 * already use: [{ url, error }] in input order. Per-task failures don't
 * sink the batch.
 */
export async function kieBatch({
  server,
  kieKey,
  tasks,            // [{ model, input }]
  label = 'KIE',
  checkpoint = null,
  dryRun = false,
  logFn = log,
  ...pollOpts
}) {
  if (dryRun) {
    logFn(label, `DRY RUN — would submit ${tasks.length} task(s):`);
    tasks.forEach((t, i) => {
      logFn(label, `  [${i + 1}] ${t.model} :: ${String(t.input?.prompt || '').slice(0, 70)}...`);
    });
    return tasks.map(() => ({ url: '', error: '', dryRun: true }));
  }

  logFn(label, `Submitting ${tasks.length} tasks...`);
  const results = await Promise.all(tasks.map(async (task, i) => {
    try {
      const r = await runKieTask({
        server, kieKey, model: task.model, input: task.input, checkpoint,
        onCreate: ({ taskId, resumed }) =>
          logFn(label, `  [${i + 1}/${tasks.length}] ${resumed ? 'resumed' : 'submitted'} → ${taskId}`),
        onTick: ({ elapsed, state }) =>
          logFn(label, `  [${i + 1}] polling... (${elapsed}s, state=${state})`),
        ...pollOpts,
      });
      logFn(label, `  [${i + 1}] ${r.cached ? 'cached' : 'done'} → ${r.url.substring(0, 60)}...`);
      return { url: r.url, error: '' };
    } catch (err) {
      logFn(label, `  [${i + 1}] FAILED: ${err.message}`);
      return { url: '', error: err.message };
    }
  }));

  const ok = results.filter(r => r.url).length;
  logFn(label, `Complete: ${ok}/${tasks.length} succeeded`);
  return results;
}

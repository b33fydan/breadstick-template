// mcp/jobTools.js — pure logic for the run_job + job_status MCP tools.
//
// Extracted from mcp/server.js so the job-queue tools are vitest-coverable
// without spawning the stdio server or a live Breadstick server (mirrors
// mcp/routeGate.js). Each function takes injected { fetchImpl, apiBase } and
// returns a discriminated result:
//   { ok: true,  data }    — caller wraps with ok()
//   { ok: false, error }   — caller wraps with fail()
// The thin registerTool wrappers in mcp/server.js translate these into the
// MCP content shape. HTTP only: the queue worker must stay the single
// server.js process — importing the queue here would spawn a second worker.

export const SERVER_DOWN = 'Breadstick server not running — start with: npm run server';

// Distinguish "Express server isn't up" from genuine request failures so the
// caller gets an actionable message instead of a bare ECONNREFUSED.
export function isConnRefused(err) {
  return err?.code === 'ECONNREFUSED' ||
    err?.cause?.code === 'ECONNREFUSED' ||
    /ECONNREFUSED|fetch failed/i.test(err?.message || '');
}

// Parse a fetch Response body as JSON when it declares JSON, else raw text.
async function readBody(response) {
  const text = await response.text();
  if ((response.headers.get('content-type') || '').includes('application/json')) {
    try { return JSON.parse(text); } catch { /* keep raw text */ }
  }
  return text;
}

// Enqueue a footage job. args: { type, input?, notify? }.
export async function runJob({ type, input, notify }, { fetchImpl, apiBase }) {
  if (typeof type !== 'string' || type.trim() === '') {
    return { ok: false, error: 'type is required (non-empty string), e.g. "shortform-process" or "longform".' };
  }
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    return { ok: false, error: 'input must be an object when provided.' };
  }

  let response, body;
  try {
    response = await fetchImpl(`${apiBase}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, input: input || {}, notify: notify || null }),
    });
    body = await readBody(response);
  } catch (err) {
    if (isConnRefused(err)) return { ok: false, error: SERVER_DOWN };
    return { ok: false, error: `/api/jobs request failed: ${err.message}` };
  }

  if (response.status !== 201) {
    const detail = body?.error ? body.error : JSON.stringify(body);
    return { ok: false, error: `/api/jobs returned ${response.status}: ${detail}` };
  }
  return { ok: true, data: { id: body.id, status: body.status } };
}

// Read job-queue state. args: { id?, status? }. With id → one job; without id →
// the list (optionally filtered by status).
export async function jobStatus({ id, status }, { fetchImpl, apiBase }) {
  const path = id
    ? `/api/jobs/${encodeURIComponent(id)}`
    : `/api/jobs${status ? `?status=${encodeURIComponent(status)}` : ''}`;

  let response, body;
  try {
    response = await fetchImpl(`${apiBase}${path}`, { method: 'GET' });
    body = await readBody(response);
  } catch (err) {
    if (isConnRefused(err)) return { ok: false, error: SERVER_DOWN };
    return { ok: false, error: `${path} request failed: ${err.message}` };
  }

  if (id && response.status === 404) {
    return { ok: false, error: `job ${id} not found` };
  }
  if (response.status !== 200) {
    const detail = body?.error ? body.error : JSON.stringify(body);
    return { ok: false, error: `${path} returned ${response.status}: ${detail}` };
  }
  return { ok: true, data: body };
}

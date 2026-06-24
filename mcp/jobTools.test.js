// mcp/jobTools.test.js — pure-logic coverage for the run_job + job_status MCP
// tools. Injected fake fetch, zero network/stdio (mirrors jobQueue.test.js).
import { describe, it, expect } from 'vitest';
import { runJob, jobStatus, SERVER_DOWN } from './jobTools.js';

const apiBase = 'http://localhost:3001';

// Minimal fetch Response stand-in: status + content-type-aware text().
function res(status, body, { json = true } = {}) {
  return {
    status,
    headers: { get: (h) => (String(h).toLowerCase() === 'content-type' && json ? 'application/json' : '') },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function connRefused() {
  const e = new Error('fetch failed');
  e.cause = { code: 'ECONNREFUSED' };
  return e;
}

describe('runJob', () => {
  it('POSTs the job spec to /api/jobs and returns the ticket', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return res(201, { id: 'job_1', status: 'queued' }); };
    const r = await runJob(
      { type: 'shortform-process', input: { pack: 'none' }, notify: { surface: 'whatsapp', to: '+1' } },
      { fetchImpl, apiBase }
    );
    expect(r).toEqual({ ok: true, data: { id: 'job_1', status: 'queued' } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:3001/api/jobs');
    expect(calls[0].opts.method).toBe('POST');
    expect(JSON.parse(calls[0].opts.body)).toEqual({
      type: 'shortform-process',
      input: { pack: 'none' },
      notify: { surface: 'whatsapp', to: '+1' },
    });
  });

  it('defaults input to {} and notify to null when omitted', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => { calls.push(opts); return res(201, { id: 'j', status: 'queued' }); };
    await runJob({ type: 'longform' }, { fetchImpl, apiBase });
    expect(JSON.parse(calls[0].body)).toEqual({ type: 'longform', input: {}, notify: null });
  });

  it('rejects an empty type without calling fetch', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return res(201, {}); };
    const r = await runJob({ type: '' }, { fetchImpl, apiBase });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/type is required/);
    expect(called).toBe(false);
  });

  it('rejects a non-object input without calling fetch', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return res(201, {}); };
    const r = await runJob({ type: 'longform', input: 'nope' }, { fetchImpl, apiBase });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/input must be an object/);
    expect(called).toBe(false);
  });

  it('surfaces the server 400 for an unknown job type', async () => {
    const fetchImpl = async () => res(400, { error: 'unknown job type: bogus' });
    const r = await runJob({ type: 'bogus' }, { fetchImpl, apiBase });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown job type: bogus/);
  });

  it('returns SERVER_DOWN when the server is unreachable', async () => {
    const fetchImpl = async () => { throw connRefused(); };
    const r = await runJob({ type: 'shortform-process' }, { fetchImpl, apiBase });
    expect(r).toEqual({ ok: false, error: SERVER_DOWN });
  });
});

describe('jobStatus', () => {
  it('GETs a single job by id', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return res(200, { job: { id: 'job_1', status: 'done' } }); };
    const r = await jobStatus({ id: 'job_1' }, { fetchImpl, apiBase });
    expect(r).toEqual({ ok: true, data: { job: { id: 'job_1', status: 'done' } } });
    expect(calls[0].url).toBe('http://localhost:3001/api/jobs/job_1');
    expect(calls[0].opts.method).toBe('GET');
  });

  it('returns a clean not-found for a 404 by id', async () => {
    const fetchImpl = async () => res(404, { error: 'not found' });
    const r = await jobStatus({ id: 'ghost' }, { fetchImpl, apiBase });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('job ghost not found');
  });

  it('lists all jobs when no id is given', async () => {
    const calls = [];
    const fetchImpl = async (url) => { calls.push(url); return res(200, { jobs: [{ id: 'a' }, { id: 'b' }] }); };
    const r = await jobStatus({}, { fetchImpl, apiBase });
    expect(r.ok).toBe(true);
    expect(r.data.jobs).toHaveLength(2);
    expect(calls[0]).toBe('http://localhost:3001/api/jobs');
  });

  it('passes a status filter to the list query', async () => {
    const calls = [];
    const fetchImpl = async (url) => { calls.push(url); return res(200, { jobs: [] }); };
    await jobStatus({ status: 'running' }, { fetchImpl, apiBase });
    expect(calls[0]).toBe('http://localhost:3001/api/jobs?status=running');
  });

  it('returns SERVER_DOWN when the server is unreachable', async () => {
    const fetchImpl = async () => { throw connRefused(); };
    const r = await jobStatus({ id: 'x' }, { fetchImpl, apiBase });
    expect(r).toEqual({ ok: false, error: SERVER_DOWN });
  });
});

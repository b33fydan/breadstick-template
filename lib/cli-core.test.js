import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  slugify, timestamp, taskFingerprint, makeClient, callAnthropic,
  createKieTask, pollKieTask, openCheckpoint, runKieTask, kieBatch,
} from './cli-core.js';

const SERVER = 'http://test:3001';
const instant = () => Promise.resolve();
const quiet = () => {};

/** Route-table fake fetch: { 'POST /api/kie/create': (body) => ({status, json}) } */
function fakeFetch(routes, calls = []) {
  return async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const path = url.replace(SERVER, '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method, path, body });
    for (const [route, handler] of Object.entries(routes)) {
      const [m, prefix] = route.split(' ');
      if (m === method && path.startsWith(prefix)) {
        const r = typeof handler === 'function' ? handler(body, path, calls) : handler;
        return { ok: r.status ? r.status < 400 : true, status: r.status || 200, json: async () => r.json };
      }
    }
    throw new Error(`no fake route for ${method} ${path}`);
  };
}

const kieSuccess = (urls) => ({
  json: { data: { state: 'success', resultJson: JSON.stringify({ resultUrls: urls }) } },
});

describe('slugify', () => {
  it('lowercases, hyphenates, strips edges', () => {
    expect(slugify('  Hello, World!  ')).toBe('hello-world');
  });
  it('respects maxLen', () => {
    expect(slugify('a'.repeat(100), 10)).toBe('aaaaaaaaaa');
  });
  it('falls back when empty', () => {
    expect(slugify('!!!', 40, 'unnamed')).toBe('unnamed');
    expect(slugify(null)).toBe('untitled');
  });
});

describe('timestamp', () => {
  it('is filesystem-safe ISO prefix', () => {
    expect(timestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });
});

describe('taskFingerprint', () => {
  it('is stable and input-sensitive', () => {
    const a = taskFingerprint('m', { prompt: 'x' });
    expect(taskFingerprint('m', { prompt: 'x' })).toBe(a);
    expect(taskFingerprint('m', { prompt: 'y' })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('makeClient', () => {
  it('throws server error message on non-ok', async () => {
    const f = fakeFetch({ 'POST /boom': { status: 400, json: { error: { message: 'nope' } } } });
    const { post } = makeClient(SERVER, { fetchImpl: f });
    await expect(post('/boom', {})).rejects.toThrow('nope');
  });
});

describe('callAnthropic', () => {
  it('joins all text blocks (webSearch interleaving)', async () => {
    const f = fakeFetch({
      'POST /api/generate': { json: { content: [
        { type: 'text', text: 'part one' },
        { type: 'server_tool_use', id: 'x' },
        { type: 'text', text: 'part two' },
      ] } },
    });
    const { text } = await callAnthropic({ server: SERVER, apiKey: 'k', messages: [], fetchImpl: f });
    expect(text).toBe('part one\npart two');
  });
  it('throws without apiKey', async () => {
    await expect(callAnthropic({ server: SERVER, apiKey: '', messages: [] }))
      .rejects.toThrow('ANTHROPIC_API_KEY');
  });
  it('throws on in-body error', async () => {
    const f = fakeFetch({ 'POST /api/generate': { json: { error: { message: 'overloaded' } } } });
    await expect(callAnthropic({ server: SERVER, apiKey: 'k', messages: [], fetchImpl: f }))
      .rejects.toThrow('overloaded');
  });
});

describe('createKieTask', () => {
  it('returns taskId and sends key/model/input', async () => {
    const calls = [];
    const f = fakeFetch({ 'POST /api/kie/create': { json: { data: { taskId: 't-1' } } } }, calls);
    const id = await createKieTask({ server: SERVER, kieKey: 'kk', model: 'm', input: { prompt: 'p' }, fetchImpl: f });
    expect(id).toBe('t-1');
    expect(calls[0].body).toEqual({ apiKey: 'kk', model: 'm', input: { prompt: 'p' } });
  });
  it('throws when no taskId', async () => {
    const f = fakeFetch({ 'POST /api/kie/create': { json: { data: {} } } });
    await expect(createKieTask({ server: SERVER, kieKey: 'kk', model: 'm', input: {}, fetchImpl: f }))
      .rejects.toThrow('No taskId');
  });
});

describe('pollKieTask', () => {
  it('resolves url on success', async () => {
    const f = fakeFetch({ 'GET /api/kie/status/': kieSuccess(['http://img/1.png']) });
    const r = await pollKieTask({ server: SERVER, kieKey: 'kk', taskId: 't', intervalMs: 0, fetchImpl: f, sleepImpl: instant });
    expect(r.url).toBe('http://img/1.png');
  });
  it('throws failMsg on fail state', async () => {
    const f = fakeFetch({ 'GET /api/kie/status/': { json: { data: { state: 'fail', failMsg: 'flagged' } } } });
    await expect(pollKieTask({ server: SERVER, kieKey: 'kk', taskId: 't', intervalMs: 0, fetchImpl: f, sleepImpl: instant }))
      .rejects.toThrow('flagged');
  });
  it('survives transient errors then succeeds', async () => {
    let n = 0;
    const f = fakeFetch({ 'GET /api/kie/status/': () => (++n < 3
      ? { status: 404, json: { error: 'not found yet' } }
      : kieSuccess(['http://img/ok.png'])) });
    const r = await pollKieTask({ server: SERVER, kieKey: 'kk', taskId: 't', intervalMs: 0, fetchImpl: f, sleepImpl: instant });
    expect(r.url).toBe('http://img/ok.png');
  });
  it('throws after maxConsecutiveErrors', async () => {
    const f = fakeFetch({ 'GET /api/kie/status/': { status: 500, json: { error: 'dead key' } } });
    await expect(pollKieTask({ server: SERVER, kieKey: 'kk', taskId: 't', intervalMs: 0, maxConsecutiveErrors: 3, fetchImpl: f, sleepImpl: instant }))
      .rejects.toThrow('3x in a row');
  });
  it('times out on perpetual pending', async () => {
    const f = fakeFetch({ 'GET /api/kie/status/': { json: { data: { state: 'waiting' } } } });
    await expect(pollKieTask({ server: SERVER, kieKey: 'kk', taskId: 't', maxWaitMs: 5, intervalMs: 0, fetchImpl: f, sleepImpl: instant }))
      .rejects.toThrow(/^Timeout after/);
  });
});

describe('checkpoint ledger', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ck-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('persists synchronously and reloads', () => {
    const file = join(dir, 'nested', 'run.json');
    const ck = openCheckpoint(file);
    ck.set('k1', { taskId: 't-1', status: 'submitted' });
    expect(existsSync(file)).toBe(true);
    const reloaded = openCheckpoint(file);
    expect(reloaded.get('k1').taskId).toBe('t-1');
    expect(JSON.parse(readFileSync(file, 'utf8')).k1.status).toBe('submitted');
  });

  it('runKieTask: fresh task records submitted then done', async () => {
    const ck = openCheckpoint(join(dir, 'a.json'));
    const f = fakeFetch({
      'POST /api/kie/create': { json: { data: { taskId: 't-9' } } },
      'GET /api/kie/status/': kieSuccess(['http://img/9.png']),
    });
    const r = await runKieTask({ server: SERVER, kieKey: 'kk', model: 'm', input: { prompt: 'p' }, checkpoint: ck, key: 'job', intervalMs: 0, fetchImpl: f, sleepImpl: instant });
    expect(r.url).toBe('http://img/9.png');
    expect(ck.get('job')).toMatchObject({ taskId: 't-9', status: 'done', url: 'http://img/9.png' });
  });

  it('runKieTask: RESUMES a submitted task — never re-creates (no re-bill)', async () => {
    const ck = openCheckpoint(join(dir, 'b.json'));
    ck.set('job', { taskId: 't-prior', status: 'submitted' });
    const calls = [];
    const f = fakeFetch({
      'POST /api/kie/create': { json: { data: { taskId: 'SHOULD-NOT-HAPPEN' } } },
      'GET /api/kie/status/': kieSuccess(['http://img/resumed.png']),
    }, calls);
    const r = await runKieTask({ server: SERVER, kieKey: 'kk', model: 'm', input: { prompt: 'p' }, checkpoint: ck, key: 'job', intervalMs: 0, fetchImpl: f, sleepImpl: instant });
    expect(r.url).toBe('http://img/resumed.png');
    expect(r.resumed).toBe(true);
    expect(calls.filter(c => c.path.startsWith('/api/kie/create'))).toHaveLength(0);
    expect(calls.some(c => c.path === '/api/kie/status/t-prior')).toBe(true);
  });

  it('runKieTask: done task returns cached with zero network', async () => {
    const ck = openCheckpoint(join(dir, 'c.json'));
    ck.set('job', { taskId: 't-x', status: 'done', url: 'http://img/cached.png' });
    const calls = [];
    const f = fakeFetch({}, calls);
    const r = await runKieTask({ server: SERVER, kieKey: 'kk', model: 'm', input: {}, checkpoint: ck, key: 'job', fetchImpl: f, sleepImpl: instant });
    expect(r).toMatchObject({ url: 'http://img/cached.png', cached: true });
    expect(calls).toHaveLength(0);
  });

  it('runKieTask: explicit fail is recorded; next run re-creates', async () => {
    const ck = openCheckpoint(join(dir, 'd.json'));
    let created = 0;
    const f1 = fakeFetch({
      'POST /api/kie/create': () => ({ json: { data: { taskId: `t-${++created}` } } }),
      'GET /api/kie/status/': { json: { data: { state: 'fail', failMsg: 'bad prompt' } } },
    });
    await expect(runKieTask({ server: SERVER, kieKey: 'kk', model: 'm', input: { prompt: 'p' }, checkpoint: ck, key: 'job', intervalMs: 0, fetchImpl: f1, sleepImpl: instant }))
      .rejects.toThrow('bad prompt');
    expect(ck.get('job').status).toBe('failed');

    const f2 = fakeFetch({
      'POST /api/kie/create': () => ({ json: { data: { taskId: `t-${++created}` } } }),
      'GET /api/kie/status/': kieSuccess(['http://img/retry.png']),
    });
    const r = await runKieTask({ server: SERVER, kieKey: 'kk', model: 'm', input: { prompt: 'p' }, checkpoint: ck, key: 'job', intervalMs: 0, fetchImpl: f2, sleepImpl: instant });
    expect(r.url).toBe('http://img/retry.png');
    expect(created).toBe(2);
  });

  it('runKieTask: timeout leaves status submitted (resumable)', async () => {
    const ck = openCheckpoint(join(dir, 'e.json'));
    const f = fakeFetch({
      'POST /api/kie/create': { json: { data: { taskId: 't-slow' } } },
      'GET /api/kie/status/': { json: { data: { state: 'waiting' } } },
    });
    await expect(runKieTask({ server: SERVER, kieKey: 'kk', model: 'm', input: {}, checkpoint: ck, key: 'job', maxWaitMs: 5, intervalMs: 0, fetchImpl: f, sleepImpl: instant }))
      .rejects.toThrow(/^Timeout/);
    expect(ck.get('job')).toMatchObject({ taskId: 't-slow', status: 'submitted' });
  });

  it('runKieTask: dryRun touches no network and no checkpoint', async () => {
    const ck = openCheckpoint(join(dir, 'f.json'));
    const calls = [];
    const f = fakeFetch({}, calls);
    const r = await runKieTask({ server: SERVER, kieKey: 'kk', model: 'm', input: { prompt: 'pricey thing' }, checkpoint: ck, dryRun: true, fetchImpl: f });
    expect(r.dryRun).toBe(true);
    expect(calls).toHaveLength(0);
    expect(ck.all()).toEqual({});
  });
});

describe('kieBatch', () => {
  it('returns [{url,error}] in order; per-task failure does not sink batch', async () => {
    const f = fakeFetch({
      'POST /api/kie/create': (body) => ({ json: { data: { taskId: `t-${body.input.prompt}` } } }),
      'GET /api/kie/status/': (_b, path) => (path.endsWith('t-bad')
        ? { json: { data: { state: 'fail', failMsg: 'rejected' } } }
        : kieSuccess([`http://img/${path.split('t-')[1]}.png`])),
    });
    const results = await kieBatch({
      server: SERVER, kieKey: 'kk', label: 'TEST', logFn: quiet,
      tasks: [{ model: 'm', input: { prompt: 'one' } }, { model: 'm', input: { prompt: 'bad' } }],
      intervalMs: 0, fetchImpl: f, sleepImpl: instant,
    });
    expect(results[0]).toEqual({ url: 'http://img/one.png', error: '' });
    expect(results[1].error).toBe('rejected');
  });

  it('dryRun lists tasks without any network', async () => {
    const calls = [];
    const f = fakeFetch({}, calls);
    const results = await kieBatch({
      server: SERVER, kieKey: 'kk', dryRun: true, logFn: quiet,
      tasks: [{ model: 'm', input: { prompt: 'x' } }],
      fetchImpl: f,
    });
    expect(results[0].dryRun).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

// src/canvas/engine/kieClient.test.js
import { describe, it, expect } from 'vitest';
import { createKieTask, pollKieTask, runKieBatch } from './kieClient.js';

const SERVER = 'http://test:3001';
const instant = () => Promise.resolve();

function fakeFetch(routes, calls = []) {
  return async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const path = url.replace(SERVER, '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method, path, body, headers: opts.headers || {} });
    for (const [route, handler] of Object.entries(routes)) {
      const [m, prefix] = route.split(' ');
      if (m === method && path.startsWith(prefix)) {
        const r = typeof handler === 'function' ? handler(body, path) : handler;
        return { ok: r.status ? r.status < 400 : true, status: r.status || 200, json: async () => r.json };
      }
    }
    throw new Error(`no fake route for ${method} ${path}`);
  };
}

const success = (url) => ({
  json: { data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [url] }) } },
});

describe('createKieTask', () => {
  it('returns taskId and posts apiKey/model/input', async () => {
    const calls = [];
    const f = fakeFetch({ 'POST /api/kie/create': { json: { data: { taskId: 't-1' } } } }, calls);
    const id = await createKieTask({ server: SERVER, kieKey: 'kk', model: 'm', input: { prompt: 'p' }, fetchImpl: f });
    expect(id).toBe('t-1');
    expect(calls[0].body).toEqual({ apiKey: 'kk', model: 'm', input: { prompt: 'p' } });
  });
  it('throws on missing taskId', async () => {
    const f = fakeFetch({ 'POST /api/kie/create': { json: { data: {} } } });
    await expect(createKieTask({ server: SERVER, kieKey: 'kk', model: 'm', input: {}, fetchImpl: f }))
      .rejects.toThrow(/taskId/);
  });
  it("surfaces kie's msg field on rejection (e.g. 422 prompt-length)", async () => {
    // Live-fire 2026-06-12: kie answers { code, msg, data:null } — the old
    // chain missed `msg` and reported a useless 'No taskId returned'.
    const f = fakeFetch({ 'POST /api/kie/create': { json: { code: 422, msg: "The length of 'prompt' must not exceed 2500 characters.", data: null } } });
    await expect(createKieTask({ server: SERVER, kieKey: 'kk', model: 'm', input: {}, fetchImpl: f }))
      .rejects.toThrow(/2500 characters/);
  });
});

describe('pollKieTask', () => {
  it('resolves url, reports elapsed via onTick, sends x-kie-key header', async () => {
    let n = 0;
    const ticks = [];
    const calls = [];
    const f = fakeFetch({
      'GET /api/kie/status/': () => (++n < 3 ? { json: { data: { state: 'waiting' } } } : success('http://img/1.png')),
    }, calls);
    const r = await pollKieTask({
      server: SERVER, kieKey: 'kk', taskId: 't', intervalSec: 10, maxWaitSec: 600,
      onTick: (t) => ticks.push(t.elapsed), fetchImpl: f, sleepImpl: instant,
    });
    expect(r.url).toBe('http://img/1.png');
    expect(ticks).toEqual([10, 20]);
    expect(calls[0].headers['x-kie-key']).toBe('kk');
  });
  it('throws failMsg on fail state', async () => {
    const f = fakeFetch({ 'GET /api/kie/status/': { json: { data: { state: 'fail', failMsg: 'flagged' } } } });
    await expect(pollKieTask({ server: SERVER, kieKey: 'kk', taskId: 't', intervalSec: 1, fetchImpl: f, sleepImpl: instant }))
      .rejects.toThrow('flagged');
  });
  it('times out at maxWaitSec', async () => {
    const f = fakeFetch({ 'GET /api/kie/status/': { json: { data: { state: 'waiting' } } } });
    await expect(pollKieTask({ server: SERVER, kieKey: 'kk', taskId: 't', intervalSec: 10, maxWaitSec: 30, fetchImpl: f, sleepImpl: instant }))
      .rejects.toThrow(/timeout/i);
  });
});

describe('runKieBatch', () => {
  it('runs items in parallel, reports per-item progress, isolates failures', async () => {
    const events = [];
    const f = fakeFetch({
      'POST /api/kie/create': (body) => ({ json: { data: { taskId: `t-${body.input.prompt}` } } }),
      'GET /api/kie/status/': (_b, path) => (path.endsWith('t-bad')
        ? { json: { data: { state: 'fail', failMsg: 'rejected' } } }
        : success(`http://img/${path.split('t-')[1]}.png`)),
    });
    const results = await runKieBatch({
      server: SERVER, kieKey: 'kk', intervalSec: 10, maxWaitSec: 600,
      items: [
        { model: 'm', input: { prompt: 'one' } },
        { model: 'm', input: { prompt: 'bad' } },
      ],
      onItem: (i, patch) => events.push([i, patch.status].join(':')),
      fetchImpl: f, sleepImpl: instant,
    });
    expect(results[0]).toMatchObject({ status: 'done', url: 'http://img/one.png' });
    expect(results[1]).toMatchObject({ status: 'error', error: 'rejected' });
    expect(events).toContain('0:polling');
    expect(events).toContain('1:error');
  });
});

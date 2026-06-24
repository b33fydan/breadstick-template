import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync as writeSeed } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createJobQueue } from './jobQueue.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jobq-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// Deterministic monotonic clock (no Date.now in tests).
const clock = () => { let t = 1000; return () => (t += 1); };

describe('jobQueue core', () => {
  it('enqueue returns a queued job and persists it to disk', () => {
    const q = createJobQueue({ dataDir: dir, now: clock(), runner: async () => ({}), notifier: async () => {} });
    const job = q.enqueue({ type: 'noop', input: { a: 1 } });
    expect(job.status).toBe('queued');
    expect(job.id).toMatch(/^job_/);
    expect(existsSync(join(dir, `${job.id}.json`))).toBe(true);
    expect(q.get(job.id).input).toEqual({ a: 1 });
  });

  it('worker drives queued → done and notifies with the formatted message', async () => {
    const sent = [];
    const q = createJobQueue({
      dataDir: dir, now: clock(),
      runner: async ({ input }) => ({ doubled: input.n * 2 }),
      formatMessage: (job) => `done ${job.result.doubled}`,
      notifier: async (desc, text) => sent.push([desc, text]),
    });
    const job = q.enqueue({ type: 'x', input: { n: 21 }, notify: { surface: 'test', to: 'me' } });
    await q.onIdle();
    expect(q.get(job.id).status).toBe('done');
    expect(q.get(job.id).result).toEqual({ doubled: 42 });
    expect(sent).toEqual([[{ surface: 'test', to: 'me' }, 'done 42']]);
  });

  it('a throwing runner marks error, notifies, and the loop survives to the next job', async () => {
    const order = [];
    const q = createJobQueue({
      dataDir: dir, now: clock(),
      runner: async ({ input }) => { order.push(input.id); if (input.id === 1) throw new Error('boom'); return {}; },
      formatMessage: (job) => (job.status === 'error' ? `err ${job.error}` : 'ok'),
      notifier: async () => {},
    });
    const j1 = q.enqueue({ type: 'x', input: { id: 1 } });
    const j2 = q.enqueue({ type: 'x', input: { id: 2 } });
    await q.onIdle();
    expect(q.get(j1.id).status).toBe('error');
    expect(q.get(j1.id).error).toBe('boom');
    expect(q.get(j2.id).status).toBe('done');
    expect(order).toEqual([1, 2]);
  });

  it('runs jobs strictly one at a time (concurrency 1)', async () => {
    let active = 0, maxActive = 0;
    const q = createJobQueue({
      dataDir: dir, now: clock(),
      runner: async () => { active++; maxActive = Math.max(maxActive, active); await new Promise(r => setTimeout(r, 5)); active--; return {}; },
      notifier: async () => {},
    });
    q.enqueue({ type: 'x' }); q.enqueue({ type: 'x' }); q.enqueue({ type: 'x' });
    await q.onIdle();
    expect(maxActive).toBe(1);
  });

  it('list returns newest-first and filters by status', async () => {
    const q = createJobQueue({ dataDir: dir, now: clock(), runner: async () => ({}), notifier: async () => {} });
    const a = q.enqueue({ type: 'x' });
    const b = q.enqueue({ type: 'x' });
    await q.onIdle();
    const all = q.list();
    expect(all[0].id).toBe(b.id); // newest first
    expect(all[1].id).toBe(a.id);
    expect(q.list({ status: 'done' }).length).toBe(2);
    expect(q.list({ status: 'queued' }).length).toBe(0);
  });

  it('leaves no .tmp files behind', async () => {
    const q = createJobQueue({ dataDir: dir, now: clock(), runner: async () => ({}), notifier: async () => {} });
    q.enqueue({ type: 'x' });
    await q.onIdle();
    expect(readdirSync(dir).some(f => f.endsWith('.tmp'))).toBe(false);
  });
});

describe('jobQueue boot recovery', () => {
  const seedJob = (over) => ({ id: 'job_seed', type: 'x', input: {}, notify: null, status: 'queued', result: null, error: null, createdAt: 1, startedAt: null, finishedAt: null, ...over });

  it('fails an interrupted running job and re-runs a queued one', async () => {
    writeSeed(join(dir, 'job_a.json'), JSON.stringify(seedJob({ id: 'job_a', status: 'running', startedAt: 2 })));
    writeSeed(join(dir, 'job_b.json'), JSON.stringify(seedJob({ id: 'job_b', status: 'queued', input: { n: 5 } })));
    const ran = [];
    const q = createJobQueue({ dataDir: dir, now: clock(), runner: async ({ input }) => { ran.push(input.n); return { ok: true }; }, notifier: async () => {} });
    const res = q.recoverOnBoot();
    expect(res).toEqual({ recovered: 1, failed: 1 });
    expect(q.get('job_a').status).toBe('error');
    expect(q.get('job_a').error).toBe('interrupted by server restart');
    await q.onIdle();
    expect(q.get('job_b').status).toBe('done');
    expect(ran).toEqual([5]);
  });

  it('leaves terminal jobs untouched and tolerates unreadable files', () => {
    writeSeed(join(dir, 'job_done.json'), JSON.stringify(seedJob({ id: 'job_done', status: 'done', result: { x: 1 } })));
    writeSeed(join(dir, 'corrupt.json'), '{ not json');
    const q = createJobQueue({ dataDir: dir, now: clock(), runner: async () => ({}), notifier: async () => {} });
    let res;
    expect(() => { res = q.recoverOnBoot(); }).not.toThrow();
    expect(res).toEqual({ recovered: 0, failed: 0 });
    expect(q.get('job_done').result).toEqual({ x: 1 });
  });
});

describe('jobQueue cancel', () => {
  it('cancels a still-queued job before it runs', async () => {
    const ran = [];
    const q = createJobQueue({
      dataDir: dir, now: clock(),
      runner: async ({ input }) => { ran.push(input.id); return {}; },
      notifier: async () => {},
    });
    const job = q.enqueue({ type: 'x', input: { id: 1 } });
    const res = q.cancel(job.id);            // synchronous, before the deferred kick
    expect(res.ok).toBe(true);
    expect(q.get(job.id).status).toBe('cancelled');
    await q.onIdle();
    expect(ran).toEqual([]);                 // runner never touched it
  });

  it('tree-cancels a running job: aborts the signal, lands cancelled (not error)', async () => {
    let started; const startedP = new Promise(r => { started = r; });
    const q = createJobQueue({
      dataDir: dir, now: clock(),
      runner: ({ signal }) => new Promise((_, reject) => {
        started();
        signal.addEventListener('abort', () => reject(new Error('killed')), { once: true });
      }),
      notifier: async () => {},
    });
    const job = q.enqueue({ type: 'x' });
    await startedP;                          // runner is in-flight
    expect(q.cancel(job.id).ok).toBe(true);
    await q.onIdle();
    expect(q.get(job.id).status).toBe('cancelled');
    expect(q.get(job.id).error).toBe(null);  // not an error
  });

  it('running-cancel notifies once with the cancelled message', async () => {
    const sent = [];
    let started; const startedP = new Promise(r => { started = r; });
    const q = createJobQueue({
      dataDir: dir, now: clock(),
      runner: ({ signal }) => new Promise((_, reject) => {
        started(); signal.addEventListener('abort', () => reject(new Error('killed')), { once: true });
      }),
      formatMessage: (job) => (job.status === 'cancelled' ? `Cancelled ${job.id}` : 'other'),
      notifier: async (desc, text) => sent.push([desc, text]),
    });
    const job = q.enqueue({ type: 'x', notify: { surface: 'test', to: 'me' } });
    await startedP;
    q.cancel(job.id);
    await q.onIdle();
    expect(sent).toEqual([[{ surface: 'test', to: 'me' }, `Cancelled ${job.id}`]]);
  });

  it('returns not_found / already_<status> for missing or terminal jobs', async () => {
    const q = createJobQueue({ dataDir: dir, now: clock(), runner: async () => ({}), notifier: async () => {} });
    expect(q.cancel('nope')).toEqual({ ok: false, reason: 'not_found' });
    const job = q.enqueue({ type: 'x' });
    await q.onIdle();
    const res = q.cancel(job.id);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('already_done');
  });
});

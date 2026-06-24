// server/jobQueue.js
/**
 * Generic, disk-backed, single-worker job queue. Domain-free: it knows nothing
 * about shortform or WhatsApp. All IO is injected (runner/formatMessage/notifier
 * /now) so it is unit-testable without spawning processes or sending messages.
 *
 * Doctrine (mirrors src/canvas/persistence.js): in-flight work does not survive
 * a restart — a job left 'running' when the process died is failed on boot, not
 * silently re-run (the CPU-heavy child is gone).
 */
import { mkdirSync, writeFileSync, renameSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export function createJobQueue({ dataDir, now = () => Date.now(), runner, formatMessage, notifier, logger = console }) {
  mkdirSync(dataDir, { recursive: true });
  const jobs = new Map();   // id -> job
  const fifo = [];          // ids waiting to run
  const controllers = new Map(); // id -> AbortController for the in-flight job
  let seq = 0;
  let running = false;
  let idleWaiters = [];

  const filePath = (id) => join(dataDir, `${id}.json`);

  function persist(job) {
    const tmp = filePath(job.id) + '.tmp';
    writeFileSync(tmp, JSON.stringify(job, null, 2));
    renameSync(tmp, filePath(job.id)); // atomic — Node rename replaces dest on POSIX + Win
  }

  function makeId() {
    seq += 1;
    return `job_${now().toString(36)}_${seq}`;
  }

  function enqueue({ type, input = {}, notify = null }) {
    const t = now();
    const job = { id: makeId(), type, input, notify, status: 'queued', result: null, error: null, createdAt: t, startedAt: null, finishedAt: null };
    jobs.set(job.id, job);
    persist(job);
    fifo.push(job.id);
    Promise.resolve().then(kick); // defer so the caller observes 'queued'
    return job;
  }

  async function kick() {
    if (running) return;
    running = true;
    try {
      while (fifo.length) {
        const id = fifo.shift();
        const job = jobs.get(id);
        if (!job || job.status !== 'queued') continue;
        job.status = 'running';
        job.startedAt = now();
        persist(job);
        const ac = new AbortController();
        controllers.set(id, ac);
        try {
          job.result = await runner({ type: job.type, input: job.input, job, signal: ac.signal });
          job.status = job.cancelRequested ? 'cancelled' : 'done';
        } catch (err) {
          if (job.cancelRequested) {
            job.status = 'cancelled';
          } else {
            job.status = 'error';
            job.error = err && err.message ? err.message : String(err);
          }
        } finally {
          controllers.delete(id);
        }
        job.finishedAt = now();
        persist(job);
        const text = formatMessage ? formatMessage(job) : null;
        if (notifier && job.notify && text) {
          try { await notifier(job.notify, text); }
          catch (e) { logger.error('[jobQueue] notifier failed', e); }
        }
      }
    } finally {
      running = false;
      const waiters = idleWaiters; idleWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  }

  function cancel(id) {
    const job = jobs.get(id);
    if (!job) return { ok: false, reason: 'not_found' };
    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.finishedAt = now();
      persist(job);
      const i = fifo.indexOf(id);
      if (i >= 0) fifo.splice(i, 1);
      return { ok: true, job };
    }
    if (job.status === 'running') {
      job.cancelRequested = true;
      persist(job);
      const ac = controllers.get(id);
      if (ac) ac.abort();
      return { ok: true, job };
    }
    return { ok: false, reason: `already_${job.status}`, job };
  }

  function get(id) { return jobs.get(id) || null; }

  function list({ status } = {}) {
    const all = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
    return status ? all.filter((j) => j.status === status) : all;
  }

  function onIdle() {
    if (!running && fifo.length === 0) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  function recoverOnBoot() {
    let recovered = 0, failed = 0;
    let files = [];
    try { files = readdirSync(dataDir).filter((f) => f.endsWith('.json')); } catch { /* dir empty */ }
    for (const f of files) {
      let job;
      try { job = JSON.parse(readFileSync(join(dataDir, f), 'utf8')); }
      catch (e) { logger.error(`[jobQueue] skipping unreadable ${f}`, e.message); continue; }
      if (!job || !job.id) continue;
      jobs.set(job.id, job);
      if (job.status === 'running') {
        job.status = 'error';
        job.error = 'interrupted by server restart';
        job.finishedAt = now();
        persist(job);
        failed += 1;
      } else if (job.status === 'queued') {
        fifo.push(job.id);
        recovered += 1;
      }
    }
    if (fifo.length) Promise.resolve().then(kick);
    return { recovered, failed };
  }

  return { enqueue, get, list, cancel, recoverOnBoot, onIdle };
}

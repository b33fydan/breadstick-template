import { describe, it, expect, vi } from 'vitest';
import { parseAgentCommand, routeAgentCommand } from './agentRouter.js';

describe('process command (queued)', () => {
  it('enqueues a shortform-process job and replies with a ticket', async () => {
    const sent = [];
    let enqueued = null;
    const transport = {
      send: (t) => { sent.push(t); },
      sendStarting: () => {},
      notify: { surface: 'whatsapp', to: '+15551234' },
    };
    const ctx = {
      paths: {}, extract: {}, runCli: () => {}, driveListNewestVideo: () => {},
      enqueueJob: (spec) => { enqueued = spec; return { id: 'job_test1', status: 'queued' }; },
    };
    await routeAgentCommand({ cmd: { cmd: 'process', pack: 'skyframe-5beat' }, transport, ctx });
    expect(enqueued).toEqual({ type: 'shortform-process', input: { pack: 'skyframe-5beat' }, notify: { surface: 'whatsapp', to: '+15551234' } });
    expect(sent.join('\n')).toContain('job_test1');
  });

  it('rejects an unknown pack without enqueuing', async () => {
    let called = false;
    const transport = { send: () => {}, sendStarting: () => {}, notify: {} };
    const ctx = { paths: {}, extract: {}, enqueueJob: () => { called = true; } };
    await routeAgentCommand({ cmd: { cmd: 'process', pack: 'bogus' }, transport, ctx });
    expect(called).toBe(false);
  });

  it("defaults pack to 'skyframe-5beat' when none given", async () => {
    let enqueued = null;
    const transport = { send: () => {}, sendStarting: () => {}, notify: { surface: 'whatsapp', to: 'x' } };
    const ctx = { paths: {}, extract: {}, enqueueJob: (spec) => { enqueued = spec; return { id: 'j', status: 'queued' }; } };
    await routeAgentCommand({ cmd: { cmd: 'process' }, transport, ctx });
    expect(enqueued.input).toEqual({ pack: 'skyframe-5beat' });
  });
});

describe('longform command (queued)', () => {
  it('enqueues a longform job for the newest Drive video and replies with a ticket', async () => {
    const sent = [];
    let enqueued = null;
    const transport = { send: (t) => { sent.push(t); }, sendStarting: () => {}, notify: { surface: 'whatsapp', to: '+1' } };
    const ctx = {
      paths: { SHORTFORM_IN_FOLDER_ID: 'folder' }, extract: {}, runCli: () => {},
      driveListNewestVideo: async () => ({ id: 'vid-abc', name: 'clip.mp4' }),
      enqueueJob: (spec) => { enqueued = spec; return { id: 'job_lf1', status: 'queued' }; },
    };
    await routeAgentCommand({ cmd: { cmd: 'longform' }, transport, ctx });
    expect(enqueued).toEqual({ type: 'longform', input: { fileId: 'vid-abc' }, notify: { surface: 'whatsapp', to: '+1' } });
    expect(sent.join('\n')).toContain('job_lf1');
    expect(sent.join('\n')).toContain('clip.mp4');
  });

  it('does not enqueue when no video is found', async () => {
    let called = false;
    const transport = { send: () => {}, sendStarting: () => {}, notify: {} };
    const ctx = { paths: {}, extract: {}, driveListNewestVideo: async () => null, enqueueJob: () => { called = true; } };
    await routeAgentCommand({ cmd: { cmd: 'longform' }, transport, ctx });
    expect(called).toBe(false);
  });
});

describe('cancel / jobs parsing', () => {
  it('parses bare cancel, cancel <id>, and jobs', () => {
    expect(parseAgentCommand('cancel')).toEqual({ cmd: 'cancel', id: null });
    expect(parseAgentCommand('cancel job_abc_1')).toEqual({ cmd: 'cancel', id: 'job_abc_1' });
    expect(parseAgentCommand('jobs')).toEqual({ cmd: 'jobs' });
  });
});

describe('cancel command', () => {
  const txp = (sent) => ({ send: (t) => sent.push(t), sendStarting: () => {} });

  it('cancels the running job when no id is given', async () => {
    const sent = []; let cancelled = null;
    const ctx = {
      paths: {}, extract: {},
      listJobs: ({ status } = {}) => (status === 'running' ? [{ id: 'job_run', type: 'longform', status: 'running' }] : []),
      cancelJob: (id) => { cancelled = id; return { ok: true, job: { id, status: 'running' } }; },
    };
    await routeAgentCommand({ cmd: { cmd: 'cancel', id: null }, transport: txp(sent), ctx });
    expect(cancelled).toBe('job_run');
    expect(sent.join('\n')).toContain('Cancelling job job_run');
  });

  it('replies when there is no running job to cancel', async () => {
    const sent = [];
    const ctx = { paths: {}, extract: {}, listJobs: () => [], cancelJob: () => { throw new Error('nope'); } };
    await routeAgentCommand({ cmd: { cmd: 'cancel', id: null }, transport: txp(sent), ctx });
    expect(sent.join('\n')).toContain('No running job');
  });

  it('cancels a queued job by id and notes it was queued', async () => {
    const sent = [];
    const ctx = { paths: {}, extract: {}, listJobs: () => [], cancelJob: (id) => ({ ok: true, job: { id, status: 'cancelled' } }) };
    await routeAgentCommand({ cmd: { cmd: 'cancel', id: 'job_q1' }, transport: txp(sent), ctx });
    expect(sent.join('\n')).toContain('Cancelled job job_q1 (was queued)');
  });

  it('reports not-found and already-terminal', async () => {
    const sent = [];
    const ctxNF = { paths: {}, extract: {}, listJobs: () => [], cancelJob: () => ({ ok: false, reason: 'not_found' }) };
    await routeAgentCommand({ cmd: { cmd: 'cancel', id: 'job_x' }, transport: txp(sent), ctx: ctxNF });
    expect(sent.join('\n')).toContain('No job job_x');
    const sent2 = [];
    const ctxDone = { paths: {}, extract: {}, listJobs: () => [], cancelJob: () => ({ ok: false, reason: 'already_done' }) };
    await routeAgentCommand({ cmd: { cmd: 'cancel', id: 'job_d' }, transport: txp(sent2), ctx: ctxDone });
    expect(sent2.join('\n')).toContain('already done');
  });
});

describe('jobs command', () => {
  const txp = (sent) => ({ send: (t) => sent.push(t), sendStarting: () => {} });

  it('lists active (queued + running) jobs and omits terminal ones', async () => {
    const sent = [];
    const ctx = { paths: {}, extract: {}, listJobs: () => [
      { id: 'job_a', type: 'longform', status: 'running' },
      { id: 'job_b', type: 'shortform-process', status: 'queued' },
      { id: 'job_c', type: 'x', status: 'done' },
    ] };
    await routeAgentCommand({ cmd: { cmd: 'jobs' }, transport: txp(sent), ctx });
    const out = sent.join('\n');
    expect(out).toContain('job_a');
    expect(out).toContain('job_b');
    expect(out).not.toContain('job_c');
  });

  it('says when there are no active jobs', async () => {
    const sent = [];
    const ctx = { paths: {}, extract: {}, listJobs: () => [] };
    await routeAgentCommand({ cmd: { cmd: 'jobs' }, transport: txp(sent), ctx });
    expect(sent.join('\n')).toContain('No active jobs');
  });
});

describe('silence-cut command', () => {
  it('parses silence-cut and silencecut', () => {
    expect(parseAgentCommand('silence-cut')).toEqual({ cmd: 'silence-cut' });
    expect(parseAgentCommand('silencecut')).toEqual({ cmd: 'silence-cut' });
  });

  it('enqueues the longform lane with silenceCut for the newest Drive video', async () => {
    const sent = []; let enqueued = null;
    const transport = { send: (t) => sent.push(t), sendStarting: () => {}, notify: { surface: 'whatsapp', to: '+1' } };
    const ctx = {
      paths: { SHORTFORM_IN_FOLDER_ID: 'folder' }, extract: {},
      driveListNewestVideo: async () => ({ id: 'vid-abc', name: 'clip.mp4' }),
      enqueueJob: (spec) => { enqueued = spec; return { id: 'job_sc1', status: 'queued' }; },
    };
    await routeAgentCommand({ cmd: { cmd: 'silence-cut' }, transport, ctx });
    expect(enqueued).toEqual({ type: 'longform', input: { fileId: 'vid-abc', silenceCut: true }, notify: { surface: 'whatsapp', to: '+1' } });
    expect(sent.join('\n')).toContain('job_sc1');
    expect(sent.join('\n')).toContain('clip.mp4');
  });

  it('does not enqueue when no video is found', async () => {
    let called = false;
    const transport = { send: () => {}, sendStarting: () => {}, notify: {} };
    const ctx = { paths: {}, extract: {}, driveListNewestVideo: async () => null, enqueueJob: () => { called = true; } };
    await routeAgentCommand({ cmd: { cmd: 'silence-cut' }, transport, ctx });
    expect(called).toBe(false);
  });
});

describe('build command (queued)', () => {
  it('parses "build <instruction>" in space and colon forms', () => {
    expect(parseAgentCommand('build add a pricing section')).toEqual({ cmd: 'build', instruction: 'add a pricing section' });
    expect(parseAgentCommand('build: change the hero')).toEqual({ cmd: 'build', instruction: 'change the hero' });
  });

  it('tolerates voice-transcription punctuation after the verb (the live-fire failure)', () => {
    expect(parseAgentCommand('Build. Change the hero section to Hello World'))
      .toEqual({ cmd: 'build', instruction: 'Change the hero section to Hello World' });
    expect(parseAgentCommand('build, add a pricing section'))
      .toEqual({ cmd: 'build', instruction: 'add a pricing section' });
  });

  it('tolerates a leading quote from voice transcription (Scribe wraps utterances)', () => {
    expect(parseAgentCommand('"Build. change the hero to X'))
      .toEqual({ cmd: 'build', instruction: 'change the hero to X' });
  });

  it('does not mistake "buildings..." for the build verb', () => {
    expect(parseAgentCommand('buildings are great')).toBeNull();
  });

  it('enqueues a ship-template job with the instruction + transport.notify and replies with a ticket', async () => {
    const sent = []; let enqueued = null;
    const transport = { send: (t) => sent.push(t), sendStarting: () => {}, notify: { surface: 'whatsapp', to: '+1' } };
    const ctx = { paths: {}, extract: {}, enqueueJob: (spec) => { enqueued = spec; return { id: 'job_build1', status: 'queued' }; } };
    await routeAgentCommand({ cmd: { cmd: 'build', instruction: 'add pricing' }, transport, ctx });
    expect(enqueued).toEqual({ type: 'ship-template', input: { instruction: 'add pricing' }, notify: { surface: 'whatsapp', to: '+1' } });
    expect(sent.join('\n')).toContain('job_build1');
  });

  it('does not enqueue when the instruction is empty', async () => {
    let called = false;
    const transport = { send: () => {}, sendStarting: () => {}, notify: {} };
    const ctx = { paths: {}, extract: {}, enqueueJob: () => { called = true; } };
    await routeAgentCommand({ cmd: { cmd: 'build', instruction: '' }, transport, ctx });
    expect(called).toBe(false);
  });
});

describe('diary verb', () => {
  it('parses bare diary → silent (thought null)', () => {
    expect(parseAgentCommand('diary')).toEqual({ cmd: 'diary', thought: null });
    expect(parseAgentCommand('Diary.')).toEqual({ cmd: 'diary', thought: null });
  });
  it('parses diary with a reflection (voice-punct tolerant)', () => {
    expect(parseAgentCommand('diary: today I shipped phase 2')).toEqual({ cmd: 'diary', thought: 'today I shipped phase 2' });
    expect(parseAgentCommand('Diary. Today I walked the trail')).toEqual({ cmd: 'diary', thought: 'Today I walked the trail' });
  });
  it('routes diary → enqueues lifejournal-diary with the thought', async () => {
    const enqueueJob = vi.fn(() => ({ id: 'job_1' }));
    const sent = [];
    const transport = { send: (t) => sent.push(t), notify: { surface: 'whatsapp', to: '+1' } };
    await routeAgentCommand({ cmd: { cmd: 'diary', thought: 'today' }, transport, ctx: { enqueueJob } });
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      type: 'lifejournal-diary', input: { thought: 'today' }, notify: transport.notify }));
    expect(sent[0]).toMatch(/job_1/);
  });
});

describe('diary verb: series token', () => {
  const mk = () => { const sent = []; const enqueueJob = vi.fn(() => ({ id: 'job_9' })); return { sent, enqueueJob, transport: { send: (t) => sent.push(t), notify: { surface: 'whatsapp', to: '+1' } }, ctx: { enqueueJob, lifejournalSeries: () => ['clean', 'cinematic', 'square'] } }; };
  it('extracts a known comma-list of series and strips it from the thought', async () => {
    const { enqueueJob, transport, ctx } = mk();
    await routeAgentCommand({ cmd: { cmd: 'diary', thought: 'cinematic,square today I shipped' }, transport, ctx });
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'lifejournal-diary', input: { thought: 'today I shipped', series: ['cinematic', 'square'] } }));
  });
  it('leaves a non-series first word in the thought (no series key)', async () => {
    const { enqueueJob, transport, ctx } = mk();
    await routeAgentCommand({ cmd: { cmd: 'diary', thought: 'today I shipped' }, transport, ctx });
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ input: { thought: 'today I shipped' } }));
  });
});

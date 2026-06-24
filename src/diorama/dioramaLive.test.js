// src/diorama/dioramaLive.test.js — pure-logic coverage for the ornament
// contract. Injected fakes, no IO, no THREE.
import { describe, it, expect } from 'vitest';
import {
  monitorQuery, monitorMap, MONITOR_STATES, MONITOR_BINDING,
  collectQueries, resolveStates, createLivePoller,
} from './dioramaLive';

describe('monitorMap', () => {
  it('idle when nothing active and no error', () => {
    expect(monitorMap({ active: 0, hasError: false })).toBe('idle');
  });
  it('active when jobs are running/queued', () => {
    expect(monitorMap({ active: 3, hasError: false })).toBe('active');
  });
  it('error wins over active', () => {
    expect(monitorMap({ active: 2, hasError: true })).toBe('error');
  });
});

describe('monitorQuery', () => {
  it('counts running+queued and does not flag error when newest is fine', async () => {
    const fetchJson = async (path) => {
      expect(path).toBe('/api/jobs');
      return { jobs: [
        { status: 'running', createdAt: 1 },
        { status: 'queued', createdAt: 2 },
        { status: 'done', createdAt: 3 },
      ] };
    };
    expect(await monitorQuery({ fetchJson })).toEqual({ active: 2, hasError: false });
  });
  it('flags error when the most recent job errored', async () => {
    const fetchJson = async () => ({ jobs: [
      { status: 'done', createdAt: 1 },
      { status: 'error', createdAt: 9 },
    ] });
    expect(await monitorQuery({ fetchJson })).toEqual({ active: 0, hasError: true });
  });
  it('handles an empty queue', async () => {
    const fetchJson = async () => ({ jobs: [] });
    expect(await monitorQuery({ fetchJson })).toEqual({ active: 0, hasError: false });
  });
});

describe('collectQueries', () => {
  const catalog = [{ id: 'monitor', binding: MONITOR_BINDING }, { id: 'plant' }];
  it('returns one query per bound, placed ornament type (deduped)', () => {
    const placed = [
      { ornamentId: 'monitor', placedId: 'a' },
      { ornamentId: 'monitor', placedId: 'b' },
      { ornamentId: 'plant', placedId: 'c' },
    ];
    const qs = collectQueries(placed, catalog);
    expect(qs).toHaveLength(1);
    expect(qs[0].ornamentId).toBe('monitor');
    expect(qs[0].query).toBe(MONITOR_BINDING.query);
  });
  it('returns nothing for an empty room', () => {
    expect(collectQueries([], catalog)).toEqual([]);
  });
});

describe('resolveStates', () => {
  const catalog = [{ id: 'monitor', binding: MONITOR_BINDING }, { id: 'plant' }];
  it('maps a feed value to a descriptor per placed bound ornament', () => {
    const placed = [
      { ornamentId: 'monitor', placedId: 'a' },
      { ornamentId: 'monitor', placedId: 'b' },
    ];
    const out = resolveStates(placed, catalog, { monitor: { active: 1, hasError: false } });
    expect(out).toEqual([
      { placedId: 'a', descriptor: MONITOR_STATES.active },
      { placedId: 'b', descriptor: MONITOR_STATES.active },
    ]);
  });
  it('skips ornaments with no binding', () => {
    expect(resolveStates([{ ornamentId: 'plant', placedId: 'c' }], catalog, { plant: 1 })).toEqual([]);
  });
  it('skips when the feed value is missing (a failed query)', () => {
    expect(resolveStates([{ ornamentId: 'monitor', placedId: 'a' }], catalog, {})).toEqual([]);
  });
});

describe('createLivePoller', () => {
  const catalog = [{ id: 'monitor', binding: MONITOR_BINDING }];

  it('tick fetches, resolves, and applies state to the system', async () => {
    const calls = [];
    const system = { setOrnamentState: (placedId, d) => calls.push([placedId, d]) };
    const fetchJson = async () => ({ jobs: [{ status: 'running', createdAt: 1 }] });
    const poller = createLivePoller({
      system,
      getPlaced: () => [{ ornamentId: 'monitor', placedId: 'a' }],
      catalog,
      deps: { fetchJson },
    });
    await poller.tick();
    expect(calls).toEqual([['a', MONITOR_STATES.active]]);
  });

  it('a failing query does not throw and applies no state', async () => {
    const calls = [];
    const warns = [];
    const system = { setOrnamentState: (id, d) => calls.push([id, d]) };
    const fetchJson = async () => { throw new Error('server down'); };
    const poller = createLivePoller({
      system,
      getPlaced: () => [{ ornamentId: 'monitor', placedId: 'a' }],
      catalog,
      deps: { fetchJson, logger: { warn: (m) => warns.push(m) } },
    });
    await poller.tick();
    expect(calls).toEqual([]);
    expect(warns).toHaveLength(1);
  });

  it('start() runs an immediate tick and schedules the interval', async () => {
    const calls = [];
    const system = { setOrnamentState: (id, d) => calls.push([id, d]) };
    const fetchJson = async () => ({ jobs: [] });
    let scheduledMs = null;
    const poller = createLivePoller({
      system,
      getPlaced: () => [{ ornamentId: 'monitor', placedId: 'a' }],
      catalog,
      deps: { fetchJson },
      intervalMs: 5000,
      setInterval: (fn, ms) => { scheduledMs = ms; return 1; },
      clearInterval: () => {},
    });
    poller.start();
    await new Promise((r) => setTimeout(r)); // flush the immediate async tick
    expect(scheduledMs).toBe(5000);
    expect(calls).toEqual([['a', MONITOR_STATES.idle]]); // empty queue → idle
  });
});

// server/activityLedger.test.js
import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {logEvent, readWindow, setLedgerDir} from './activityLedger.js';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  setLedgerDir(dir);
});
afterEach(() => fs.rmSync(dir, {recursive: true, force: true}));

describe('logEvent', () => {
  it('appends one JSON line to the UTC month file', () => {
    const ok = logEvent({type: 'script', lane: 'canvas', meta: {nodeId: 'n1'}});
    expect(ok).toBe(true);
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const file = path.join(dir, `${month}.jsonl`);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const ev = JSON.parse(lines[0]);
    expect(ev.type).toBe('script');
    expect(ev.lane).toBe('canvas');
    expect(ev.meta).toEqual({nodeId: 'n1'});
    expect(new Date(ev.ts).toISOString()).toBe(ev.ts); // valid ISO UTC
  });

  it('never throws and returns false on unwritable dir', () => {
    setLedgerDir(path.join(dir, 'nope\0bad')); // invalid path
    expect(logEvent({type: 'image', lane: 'x'})).toBe(false);
  });

  it('defaults type to other and lane to unknown', () => {
    logEvent({});
    const month = new Date().toISOString().slice(0, 7);
    const ev = JSON.parse(fs.readFileSync(path.join(dir, `${month}.jsonl`), 'utf8').trim());
    expect(ev.type).toBe('other');
    expect(ev.lane).toBe('unknown');
  });
});

describe('readWindow', () => {
  const write = (name, rows) =>
    fs.writeFileSync(path.join(dir, name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  it('returns events inside the window, across two month files', () => {
    write('2026-05.jsonl', [
      {ts: '2026-05-30T10:00:00.000Z', type: 'script', lane: 'a', meta: {}},
      {ts: '2026-05-31T10:00:00.000Z', type: 'video', lane: 'a', meta: {}},
    ]);
    write('2026-06.jsonl', [
      {ts: '2026-06-01T10:00:00.000Z', type: 'post', lane: 'a', meta: {}},
      {ts: '2026-06-09T10:00:00.000Z', type: 'image', lane: 'a', meta: {}},
    ]);
    const out = readWindow('2026-05-31T00:00:00.000Z', '2026-06-07T00:00:00.000Z');
    expect(out.map((e) => e.type)).toEqual(['video', 'post']);
  });

  it('returns events spanning a year boundary', () => {
    write('2025-12.jsonl', [{ts: '2025-12-31T10:00:00.000Z', type: 'video', lane: 'a', meta: {}}]);
    write('2026-01.jsonl', [{ts: '2026-01-01T10:00:00.000Z', type: 'post', lane: 'a', meta: {}}]);
    const out = readWindow('2025-12-31T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    expect(out.map((e) => e.type)).toEqual(['video', 'post']);
  });

  it('skips malformed lines and missing files', () => {
    fs.writeFileSync(path.join(dir, '2026-06.jsonl'), '{"ts":"2026-06-02T00:00:00.000Z","type":"script","lane":"a"}\nNOT JSON\n');
    const out = readWindow('2026-06-01T00:00:00.000Z', '2026-06-30T00:00:00.000Z');
    expect(out).toHaveLength(1);
  });

  it('returns [] when ledger dir does not exist', () => {
    setLedgerDir(path.join(dir, 'missing'));
    expect(readWindow('2026-01-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z')).toEqual([]);
  });
});

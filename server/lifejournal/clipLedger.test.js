import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClipLedger } from './clipLedger.js';

let ledgerPath;
beforeEach(() => { ledgerPath = join(mkdtempSync(join(tmpdir(), 'lj-led-')), 'used.jsonl'); });

describe('clipLedger', () => {
  it('missing file → empty set', () => {
    expect(createClipLedger({ ledgerPath }).usedSet().size).toBe(0);
  });
  it('append then usedSet returns every rel', () => {
    const l = createClipLedger({ ledgerPath });
    l.append({ entryId: 'entry-0001', ts: 't', clipRels: ['a.mp4', 'b.mp4'] });
    l.append({ entryId: 'entry-0002', ts: 't', clipRels: ['c.mp4'] });
    expect([...l.usedSet()].sort()).toEqual(['a.mp4', 'b.mp4', 'c.mp4']);
  });
  it('tolerates malformed lines', () => {
    const l = createClipLedger({ ledgerPath });
    l.append({ entryId: 'e', ts: 't', clipRels: ['a.mp4'] });
    appendFileSync(ledgerPath, 'NOT JSON\n');
    expect([...l.usedSet()]).toEqual(['a.mp4']);
  });
});

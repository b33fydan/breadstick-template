// Append-only no-reuse ledger (ESM). One JSON line per diary entry. Failures never throw.
import fs from 'node:fs';
import path from 'node:path';

export function createClipLedger({ ledgerPath }) {
  function append({ entryId, ts, clipRels }) {
    try {
      fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
      fs.appendFileSync(ledgerPath, JSON.stringify({ entryId, ts, clipRels }) + '\n');
      return true;
    } catch (err) {
      console.warn('[lifejournal/ledger] append failed:', err.message);
      return false;
    }
  }
  function usedSet() {
    const used = new Set();
    let raw;
    try { raw = fs.readFileSync(ledgerPath, 'utf8'); } catch { return used; }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { (JSON.parse(line).clipRels || []).forEach((r) => used.add(r)); } catch { /* skip malformed */ }
    }
    return used;
  }
  return { append, usedSet };
}

// server/activityLedger.js — append-only activity ledger (ESM, vitest-covered)
// Events feed the Arecibo Transmission weekly recap. Failures must never
// break a host endpoint: logEvent catches everything and returns false.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let LEDGER_DIR = path.join(__dirname, '..', 'data', 'ledger');

export function setLedgerDir(dir) {
  LEDGER_DIR = dir;
}

function monthFile(ts) {
  return path.join(LEDGER_DIR, `${ts.slice(0, 7)}.jsonl`);
}

export function logEvent({type = 'other', lane = 'unknown', meta = {}} = {}) {
  try {
    const ts = new Date().toISOString();
    fs.mkdirSync(LEDGER_DIR, {recursive: true});
    fs.appendFileSync(monthFile(ts), JSON.stringify({ts, type, lane, meta}) + '\n');
    return true;
  } catch (err) {
    console.warn('[ledger] write failed:', err.message);
    return false;
  }
}

// Month keys (YYYY-MM) the [from, to] window spans, inclusive.
function monthsBetween(fromIso, toIso) {
  const out = [];
  const d = new Date(fromIso.slice(0, 7) + '-01T00:00:00.000Z');
  const end = new Date(toIso.slice(0, 7) + '-01T00:00:00.000Z');
  while (d <= end) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

export function readWindow(fromIso, toIso) {
  const events = [];
  let skipped = 0;
  for (const month of monthsBetween(fromIso, toIso)) {
    const file = path.join(LEDGER_DIR, `${month}.jsonl`);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.ts >= fromIso && ev.ts < toIso) events.push(ev);
      } catch {
        skipped++;
      }
    }
  }
  if (skipped) console.warn(`[ledger] skipped ${skipped} malformed line(s)`);
  return events;
}

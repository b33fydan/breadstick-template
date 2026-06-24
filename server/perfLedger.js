// server/perfLedger.js — append-only performance ledger (ESM, vitest-covered).
//
// The activity ledger (activityLedger.js) records what Breadstick MAKES;
// this ledger records what HAPPENS to it after posting: per-post snapshots
// pulled nightly from whatever source can answer (Postiz post state today,
// vidiq / CSV drops later). Same month-sharded JSONL shape so the two join
// naturally on postId, and the same fail-soft contract: a write failure must
// never break a host endpoint or cron.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let PERF_DIR = path.join(__dirname, '..', 'data', 'perf');

export function setPerfDir(dir) {
  PERF_DIR = dir;
}

function monthFile(ts) {
  return path.join(PERF_DIR, `${ts.slice(0, 7)}.jsonl`);
}

// One snapshot per (postId, pull). Shape:
//   { ts, postId, lane, angle, source, state, metrics, meta }
// metrics is an open bag ({ views, likes, saves, ... }) — lanes declare which
// key matters in pipeline/angles.json; absent metrics are simply unknown.
export function logPerf({postId, lane = 'untagged', angle = 'untagged', source = 'unknown', state = null, metrics = {}, meta = {}} = {}) {
  if (!postId) return false;
  try {
    const ts = new Date().toISOString();
    fs.mkdirSync(PERF_DIR, {recursive: true});
    fs.appendFileSync(
      monthFile(ts),
      JSON.stringify({ts, postId, lane, angle, source, state, metrics, meta}) + '\n'
    );
    return true;
  } catch (err) {
    console.warn('[perf] write failed:', err.message);
    return false;
  }
}

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

export function readPerfWindow(fromIso, toIso) {
  const events = [];
  let skipped = 0;
  for (const month of monthsBetween(fromIso, toIso)) {
    const file = path.join(PERF_DIR, `${month}.jsonl`);
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
  if (skipped) console.warn(`[perf] skipped ${skipped} malformed line(s)`);
  return events;
}

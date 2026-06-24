// Daily TTS character budget. Append-only JSONL ledger (one line per successful
// TTS call); check() sums today's spend, record() appends. Pure arithmetic — a
// cost guardrail in the non-LLM-gate spirit. All IO injected for tests.
import fs from 'node:fs';

export function createTtsBudget({ usagePath, cap, now = () => Date.now() }) {
  const today = () => new Date(now()).toISOString().slice(0, 10);
  function spentToday() {
    let sum = 0;
    let raw;
    try {
      raw = fs.readFileSync(usagePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return 0; // no file yet
      throw err;                            // surface real read errors (EACCES/EIO/…)
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; } // skip a corrupt line, don't brick the guard
      if (r.date === today()) sum += r.chars || 0;
    }
    return sum;
  }
  const check = (chars) => !Number.isFinite(cap) || spentToday() + chars <= cap;
  const record = (chars) =>
    fs.appendFileSync(usagePath, JSON.stringify({ date: today(), chars, ts: new Date(now()).toISOString() }) + '\n');
  const remaining = () => Math.max(0, (Number.isFinite(cap) ? cap : Infinity) - spentToday());
  return { check, record, remaining, spentToday };
}

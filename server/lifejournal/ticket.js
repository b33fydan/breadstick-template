// Pure formatter for the weekly LifeJournal proposal (propose-only gate).
// Clips are chosen fresh at render, so the summary is intentionally approximate.
export function formatDiaryTicket(draft, date) {
  const chunks = draft?.chunks || [];
  const lanes = [...new Set(chunks.map((c) => c.lane).filter(Boolean))].join(', ') || '—';
  const secs = Math.round(draft?.totalSec || 0);
  const week = new Date(date).toISOString().slice(0, 10);
  return (
    `🎞️ LifeJournal — week of ${week}.\n` +
    `Proposed pull: ~${chunks.length} clips, ~${secs}s, lanes ${lanes}.\n` +
    'Reply `diary` for a silent cut, or `diary <your reflection>` (text or voice) to narrate it.\n' +
    '(Exact clips chosen fresh at render.)'
  );
}

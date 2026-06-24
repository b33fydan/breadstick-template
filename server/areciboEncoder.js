// server/areciboEncoder.js — deterministic WeekStats → 943-bit Arecibo grid.
// Pure function, no LLM, no I/O. Art + layout are frozen by the golden test.
// ESM (package is "type": "module").
export const GRID = Object.freeze({cols: 23, rows: 41, bits: 943});
export const SECTIONS = Object.freeze({
  counting: Object.freeze({rowStart: 0, rowEnd: 3}),
  elements: Object.freeze({rowStart: 5, rowEnd: 13}),
  rhythm: Object.freeze({rowStart: 15, rowEnd: 24}),
  operator: Object.freeze({rowStart: 26, rowEnd: 33}),
  instrument: Object.freeze({rowStart: 36, rowEnd: 40}),
});
export const CATEGORIES = Object.freeze(['script', 'image', 'video', 'carousel', 'post']);
export const CATEGORY_COLS = Object.freeze([2, 6, 10, 14, 18]);
export const DAY_COLS = Object.freeze([4, 6, 8, 10, 12, 14, 16]);
const HUMANOID = ['..X..', '.XXX.', '..X..', '..X..', '.X.X.', 'X...X']; // rows 26-31, cols 9-13

export function encodeWeek(stats) {
  const bits = new Array(GRID.bits).fill(0);
  const set = (row, col, v = 1) => {
    if (row >= 0 && row < GRID.rows && col >= 0 && col < GRID.cols) bits[row * GRID.cols + col] = v ? 1 : 0;
  };
  const result = {bits, grid: GRID, sections: SECTIONS};
  if (!stats || !stats.total) return result; // silence grid

  // counting: numbers 1-5, 3-bit vertical, MSB row 0, at cols 2,4,6,8,10
  [1, 2, 3, 4, 5].forEach((n, i) => {
    const col = 2 + i * 2;
    for (let b = 0; b < 3; b++) set(b, col, (n >> (2 - b)) & 1);
  });
  // row 3: weekNumber 6 bits MSB at col 2; year%100 7 bits MSB at col 12
  const week = Math.max(0, Math.min(63, stats.weekNumber | 0));
  for (let b = 0; b < 6; b++) set(3, 2 + b, (week >> (5 - b)) & 1);
  const yy = Math.abs((stats.year | 0) % 100);
  for (let b = 0; b < 7; b++) set(3, 12 + b, (yy >> (6 - b)) & 1);

  // elements: 6-bit counters, overflow marker row 5, baseline row 12
  CATEGORIES.forEach((cat, i) => {
    const col = CATEGORY_COLS[i];
    const raw = Math.max(0, (stats.counts && stats.counts[cat]) | 0);
    const val = Math.min(raw, 63);
    if (raw > 63) set(5, col);
    for (let b = 0; b < 6; b++) set(6 + b, col, (val >> (5 - b)) & 1);
    set(12, col); // baseline
  });

  // rhythm: log2 bars over baseline row 24; clamp marker row 15 for n > 255
  (stats.daily || []).slice(0, 7).forEach((n, i) => {
    const col = DAY_COLS[i];
    const v = Math.max(0, n | 0);
    if (v > 255) set(15, col);
    const h = v > 0 ? Math.min(Math.ceil(Math.log2(v + 1)), 8) : 0;
    // bar rises h rows above baseline row 24 (fills rows 24-h … 23)
    for (let r = 24 - h; r <= 23; r++) set(r, col);
    set(24, col); // baseline
  });

  // operator: humanoid + category marker line with raised highlight
  HUMANOID.forEach((line, r) => {
    [...line].forEach((ch, c) => { if (ch === 'X') set(26 + r, 9 + c); });
  });
  CATEGORIES.forEach((cat, i) => {
    set(stats.highlight === cat ? 32 : 33, CATEGORY_COLS[i]);
  });

  // instrument: baguette + full-width underline
  for (let c = 6; c <= 16; c++) set(36, c);
  for (let c = 5; c <= 17; c++) { if (![8, 11, 14].includes(c)) set(37, c); }
  for (let c = 6; c <= 16; c++) set(38, c);
  for (let c = 0; c <= 22; c++) set(40, c);

  return result;
}

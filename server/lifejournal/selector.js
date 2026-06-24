// Deterministic, no-reuse chunk picker. Round-robins lanes, each beat = windowSec
// (capped at the clip), trims the final beat so totalSec ≈ targetSec. Seeded → reproducible.
const round3 = (n) => Math.round(n * 1000) / 1000;

function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000;
}

export function selectChunks({ availableByLane, targetSec, beats = 6, windowSec = 12, seed = 1, minTailSec = 1.5, isLogFn }) {
  const lanes = Object.keys(availableByLane);
  const rand = lcg(seed);
  // NOTE: lane-key order in availableByLane is part of the deterministic seed contract — reordering the keys changes the selection for a given seed.
  const pools = {};
  for (const ln of lanes) {
    pools[ln] = [...availableByLane[ln]].sort((a, b) => a.rel.localeCompare(b.rel)); // stable base order
    for (let i = pools[ln].length - 1; i > 0; i--) {                                  // seeded Fisher–Yates
      const j = Math.floor(rand() * (i + 1));
      [pools[ln][i], pools[ln][j]] = [pools[ln][j], pools[ln][i]];
    }
  }

  const chunks = [];
  const consumedRels = [];
  let totalSec = 0;
  let laneIdx = 0;
  while (totalSec < targetSec && chunks.length < beats) {
    if (lanes.length === 0 || lanes.every((l) => pools[l].length === 0)) break;
    const remaining = targetSec - totalSec;
    if (remaining < minTailSec) break;
    const ln = lanes[laneIdx % lanes.length];
    laneIdx += 1;
    const pool = pools[ln];
    if (pool.length === 0) continue;
    const clip = pool.shift();
    const clipDur = clip.durationSec || 0;
    if (clipDur <= 0) continue;
    const dur = Math.min(windowSec, clipDur, remaining);
    const inSec = Math.max(0, Math.min(clipDur * 0.2, clipDur - dur)); // ~20% in, kept inside the clip
    chunks.push({ rel: clip.rel, path: clip.path, lane: clip.lane, inSec: round3(inSec), durationSec: round3(dur), applyLut: isLogFn ? !!isLogFn(clip) : true });
    consumedRels.push(clip.rel);
    totalSec = round3(totalSec + dur);
  }
  return { chunks, totalSec, consumedRels, exhausted: totalSec < targetSec - minTailSec };
}

// server/angleRotation.js — the deterministic A/B rotation rule.
//
// House doctrine (feedback_non_llm_ship_gate, extended to growth loops):
// the DECISION about which angle leads next week is arithmetic over numbers,
// never an LLM call. An LLM may narrate the result afterwards; it may not
// pick the winner. Fixed-arm bandit: the angle set is pre-registered in
// pipeline/angles.json and only the operator edits it.
//
// Rule: every angle needs >= minPostsPerAngle posts WITH a metric value
// before a verdict exists. Until then: undecided, equal shares (pure
// exploration). Once all arms qualify: the best mean-metric arm takes
// leaderShare of next week's slots, the rest split the remainder evenly.
// Ties break alphabetically by angle id so reruns are reproducible.

export function rotateAngles({angles = [], posts = [], minPostsPerAngle = 3, leaderShare = 0.6} = {}) {
  const ids = angles.map((a) => a.id);
  if (ids.length === 0) {
    return {decided: false, reason: 'no angles registered', shares: {}, table: []};
  }

  const byAngle = Object.fromEntries(ids.map((id) => [id, []]));
  for (const p of posts) {
    if (p && byAngle[p.angle] && typeof p.metricValue === 'number' && Number.isFinite(p.metricValue)) {
      byAngle[p.angle].push(p.metricValue);
    }
  }

  const table = ids.map((id) => {
    const vals = byAngle[id];
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return {angle: id, posts: vals.length, mean};
  }).sort((a, b) => a.angle.localeCompare(b.angle));

  const underSampled = table.filter((row) => row.posts < minPostsPerAngle);
  if (underSampled.length > 0) {
    const even = 1 / ids.length;
    return {
      decided: false,
      reason: `exploration: ${underSampled.map((r) => `${r.angle} has ${r.posts}/${minPostsPerAngle} measured posts`).join('; ')}`,
      shares: Object.fromEntries(ids.map((id) => [id, round2(even)])),
      table,
    };
  }

  // All arms qualified — promote the best mean; alphabetical tiebreak is
  // already guaranteed by the sorted table ordering.
  const leader = table.reduce((best, row) => (row.mean > best.mean ? row : best), table[0]);
  const restShare = ids.length > 1 ? (1 - leaderShare) / (ids.length - 1) : 0;
  const shares = Object.fromEntries(
    ids.map((id) => [id, round2(id === leader.angle ? leaderShare : restShare)])
  );
  return {
    decided: true,
    reason: `leader ${leader.angle} (mean ${round2(leader.mean)}) takes ${Math.round(leaderShare * 100)}% of next week's slots`,
    leader: leader.angle,
    shares,
    table,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

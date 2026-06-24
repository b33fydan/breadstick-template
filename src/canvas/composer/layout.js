// src/canvas/composer/layout.js
// Deterministic lane-shaped layout: topological depth → column (x), branch
// order within a column → row (y). The model NEVER picks positions.

const COL_W = 360;
const ROW_H = 220;

export function layoutSpec(spec, origin) {
  const refs = spec.nodes.map((n) => n.ref);
  const indeg = Object.fromEntries(refs.map((r) => [r, 0]));
  const out = Object.fromEntries(refs.map((r) => [r, []]));
  for (const e of spec.edges) {
    if (e.from === e.to) continue; // self-loop: ignore rather than quarantine the chain
    if (out[e.from] && indeg[e.to] !== undefined) {
      out[e.from].push(e.to);
      indeg[e.to] += 1;
    }
  }

  // Kahn's algorithm, recording depth = longest path from a root.
  const depth = Object.fromEntries(refs.map((r) => [r, 0]));
  const queue = refs.filter((r) => indeg[r] === 0);
  const seen = [];
  while (queue.length) {
    const r = queue.shift();
    seen.push(r);
    for (const next of out[r]) {
      depth[next] = Math.max(depth[next], depth[r] + 1);
      indeg[next] -= 1;
      if (indeg[next] === 0) queue.push(next);
    }
  }
  // Cycles are rejected by the applier before layout; any unseen ref here is
  // defensive — park it at depth 0 rather than throw.

  // Row order: stable by spec order within each column.
  const rowCount = Object.create(null);
  const positions = Object.create(null);
  for (const node of spec.nodes) {
    const d = depth[node.ref] ?? 0;
    const row = rowCount[d] ?? 0;
    rowCount[d] = row + 1;
    positions[node.ref] = { x: origin.x + d * COL_W, y: origin.y + row * ROW_H };
  }
  return positions;
}

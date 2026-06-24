// src/canvas/engine/graphOrder.js
/**
 * Pure graph ordering for executeGraph(). No React, no DOM, no IO.
 *
 * subgraphOrder(nodes, edges, targetId) returns the nodes reachable by
 * walking edges BACKWARD from targetId (the upstream closure), sorted in
 * dependency order (every node appears after all of its upstream sources).
 */
export function subgraphOrder(nodes, edges, targetId) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (!byId.has(targetId)) throw new Error(`unknown target node: ${targetId}`);

  // Upstream closure via backward BFS.
  const member = new Set([targetId]);
  const queue = [targetId];
  while (queue.length) {
    const id = queue.shift();
    for (const edge of edges) {
      if (edge.target === id && byId.has(edge.source) && !member.has(edge.source)) {
        member.add(edge.source);
        queue.push(edge.source);
      }
    }
  }

  // Kahn's algorithm restricted to the closure.
  const inDegree = new Map([...member].map((id) => [id, 0]));
  const memberEdges = edges.filter((e) => member.has(e.source) && member.has(e.target));
  for (const edge of memberEdges) inDegree.set(edge.target, inDegree.get(edge.target) + 1);

  const ready = [...member].filter((id) => inDegree.get(id) === 0);
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(byId.get(id));
    for (const edge of memberEdges) {
      if (edge.source !== id) continue;
      const d = inDegree.get(edge.target) - 1;
      inDegree.set(edge.target, d);
      if (d === 0) ready.push(edge.target);
    }
  }
  if (order.length !== member.size) {
    throw new Error('cycle detected in canvas graph upstream of ' + targetId);
  }
  return order;
}

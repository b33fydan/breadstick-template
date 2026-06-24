// Pure transitions for a Conductor ghost batch. Accept = membership flip;
// nothing is re-created (ids are final from materialization).

const inBatch = (n, batchId) => n.data?.composerBatch === batchId && n.data?.ghost === true;

export function acceptBatch(nodes, edges, batchId) {
  const accepted = new Set(nodes.filter((n) => inBatch(n, batchId)).map((n) => n.id));
  return {
    nodes: nodes.map((n) => {
      if (!accepted.has(n.id)) return n;
      const { className: _c, ...rest } = n;
      return { ...rest, data: { ...n.data, ghost: false } };
    }),
    edges: edges.map((e) => {
      if (!accepted.has(e.source) && !accepted.has(e.target)) return e;
      const { className: _c, ...rest } = e;
      return rest;
    }),
  };
}

export function discardBatch(nodes, edges, batchId) {
  const dead = new Set(nodes.filter((n) => inBatch(n, batchId)).map((n) => n.id));
  return {
    nodes: nodes.filter((n) => !dead.has(n.id)),
    edges: edges.filter((e) => !dead.has(e.source) && !dead.has(e.target)),
  };
}

export function rejectNode(nodes, edges, nodeId) {
  return {
    nodes: nodes.filter((n) => n.id !== nodeId),
    edges: edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
  };
}

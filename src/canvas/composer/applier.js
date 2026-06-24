// src/canvas/composer/applier.js
// Pure spec → canvas materialization. No React. Stages: validate → layout →
// materialize (later task). The model proposes; this file disposes — deterministically.
import { CATALOG, DELIVERABLE_TYPES } from './catalog';
import { layoutSpec } from './layout';

export function validateSpec(spec) {
  const warnings = [];
  if (!spec || !Array.isArray(spec.nodes) || !Array.isArray(spec.edges)) {
    return { ok: false, error: 'Spec must carry nodes[] and edges[]', warnings };
  }

  // 1. Node-level: known type, schema'd config.
  const seenRefs = new Set();
  const nodes = [];
  for (const n of spec.nodes) {
    if (seenRefs.has(n.ref)) { warnings.push(`Dropped duplicate ref "${n.ref}" — refs must be unique`); continue; }
    seenRefs.add(n.ref);
    const entry = CATALOG[n.type];
    if (!entry) { warnings.push(`Dropped "${n.ref}" — type "${n.type}" is not in my catalog`); continue; }
    const config = {};
    let dropNode = false;
    const schema = entry.config || {};
    for (const [field, raw] of Object.entries(n.config || {})) {
      const rule = schema[field];
      if (!rule) { warnings.push(`Ignored "${field}" on ${n.ref} — not a ${n.type} field`); continue; }
      if (rule.enum && !rule.enum.includes(raw)) {
        warnings.push(`Coerced ${n.ref}.${field} "${raw}" → "${rule.default}" (allowed: ${rule.enum.join(', ')})`);
        config[field] = rule.default;
      } else {
        config[field] = raw;
      }
    }
    for (const [field, rule] of Object.entries(schema)) {
      if (rule.required && config[field] === undefined) {
        warnings.push(`Dropped "${n.ref}" — required ${n.type}.${field} missing`);
        dropNode = true;
      } else if (config[field] === undefined && rule.default !== undefined) {
        config[field] = rule.default;
      }
    }
    if (!dropNode) nodes.push({ ref: n.ref, type: n.type, label: n.label, config });
  }

  // 2. Edge-level: both ends must survive.
  const live = new Set(nodes.map((n) => n.ref));
  const edges = [];
  for (const e of spec.edges) {
    if (!live.has(e.from) || !live.has(e.to)) {
      warnings.push(`Dropped edge ${e.from}→${e.to} — references a missing node ("${!live.has(e.from) ? e.from : e.to}")`);
      continue;
    }
    edges.push({ from: e.from, to: e.to });
  }

  // 3. DAG check — a cycle rejects the whole proposal.
  if (hasCycle(nodes, edges)) {
    return { ok: false, error: 'Spec contains a cycle — pipelines must flow one way', warnings };
  }

  // 4. Soft completeness: at least one deliverable-flagged node.
  if (!nodes.some((n) => DELIVERABLE_TYPES.has(n.type))) {
    warnings.push('No deliverable node in this graph — partial lane (fine if intended)');
  }

  return { ok: true, nodes, edges, warnings };
}

function hasCycle(nodes, edges) {
  const indeg = Object.fromEntries(nodes.map((n) => [n.ref, 0]));
  const out = Object.fromEntries(nodes.map((n) => [n.ref, []]));
  for (const e of edges) { out[e.from].push(e.to); indeg[e.to] += 1; }
  const queue = nodes.map((n) => n.ref).filter((r) => indeg[r] === 0);
  let seen = 0;
  while (queue.length) {
    const r = queue.shift(); seen += 1;
    for (const nx of out[r]) { indeg[nx] -= 1; if (indeg[nx] === 0) queue.push(nx); }
  }
  return seen !== nodes.length;
}

export function applySpec(spec, { ctx, batchId, origin }) {
  const v = validateSpec(spec);
  if (!v.ok) return v;
  const warnings = [...v.warnings];

  const positions = layoutSpec({ nodes: v.nodes, edges: v.edges }, origin);

  // Helper factory: lets ingredient/type hydrates find their wired character.
  const byRef = Object.fromEntries(v.nodes.map((n) => [n.ref, n]));
  const upstreamCharacterFor = (ref) => {
    const seen = new Set();
    let cur = ref;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      // NOTE: takes the first in-edge; lane grammar guarantees ≤1 in-edge per ingredient.
      const inEdge = v.edges.find((e) => e.to === cur);
      if (!inEdge) return null;
      const srcNode = byRef[inEdge.from];
      if (srcNode?.type === 'character') {
        return (ctx.characters || []).find((c) => c.id === srcNode.config.characterId) || null;
      }
      cur = inEdge.from;
    }
    return null;
  };

  const nodes = [];
  const liveRefs = new Set();
  for (const n of v.nodes) {
    const entry = CATALOG[n.type];
    let data;
    if (entry.hydrate) {
      data = entry.hydrate(n.config, ctx, { upstreamCharacter: () => upstreamCharacterFor(n.ref) });
      if (data === null) {
        warnings.push(`Dropped "${n.ref}" — ${n.type} config didn't resolve (check ids)`);
        continue;
      }
    } else {
      data = { ...n.config };
    }
    liveRefs.add(n.ref);
    nodes.push({
      id: `cmp-${batchId}-${n.ref}`,
      type: n.type,
      position: positions[n.ref],
      className: 'cv-ghost',
      data: { ...data, ghost: true, composerRef: n.ref, composerBatch: batchId },
    });
  }

  // Handle resolution: a rule is a string, null (omit — RF auto-attach), a
  // { bySource, default } map keyed by source type, or a fn of the source
  // spec node. Wrong ids make RF refuse the edge (#008) — ids live in
  // CATALOG[type].handles, harvested from the real components.
  const resolveHandle = (rule, srcSpecNode) => {
    if (rule == null) return undefined;
    if (typeof rule === 'function') return rule(srcSpecNode);
    if (typeof rule === 'string') return rule;
    return rule.bySource?.[srcSpecNode?.type] ?? rule.default;
  };

  const edges = v.edges
    .filter((e) => liveRefs.has(e.from) && liveRefs.has(e.to))
    .map((e) => {
      const srcSpecNode = byRef[e.from];
      const sourceHandle = resolveHandle(CATALOG[srcSpecNode.type]?.handles?.out, srcSpecNode);
      const targetHandle = resolveHandle(CATALOG[byRef[e.to].type]?.handles?.in, srcSpecNode);
      return {
        id: `cmp-${batchId}-e-${e.from}-${e.to}`,
        source: `cmp-${batchId}-${e.from}`,
        target: `cmp-${batchId}-${e.to}`,
        type: 'pulse',
        className: 'cv-ghost-edge',
        ...(sourceHandle !== undefined ? { sourceHandle } : {}),
        ...(targetHandle !== undefined ? { targetHandle } : {}),
      };
    });

  return { ok: true, nodes, edges, warnings, batchId, specNodes: v.nodes, specEdges: v.edges };
}

// Revision: the model re-emits a FULL spec (ref-stable). We diff against the
// current batch on the canvas. Manual drags survive; rejected refs stay dead.
// currentNodes/currentEdges are read-only inputs — never mutated.
//
// CALLER CONTRACT (CanvasView integration):
// - rejectedRefs MUST contain the composerRef of every node in this batch the
//   operator rejected via rejectNode since the batch was proposed. Omitting a
//   rejected ref RESURRECTS it at layout position. Derive from canvas state or
//   conductor session state — do not improvise a parallel bookkeeping array.
// - batchId MUST be the active Conductor session's batch. Calling with a stale
//   batchId leaves the other batch's ghosts untouched (treated as outside nodes)
//   and two ghost batches will coexist on canvas.
export function applyRevision(currentNodes, currentEdges, nextSpec, { ctx, batchId, origin }, rejectedRefs = []) {
  const rejected = new Set(rejectedRefs);
  const pruned = {
    ...nextSpec,
    nodes: (nextSpec.nodes || []).filter((n) => !rejected.has(n.ref)),
    edges: (nextSpec.edges || []).filter((e) => !rejected.has(e.from) && !rejected.has(e.to)),
  };

  const fresh = applySpec(pruned, { ctx, batchId, origin });
  if (!fresh.ok) return fresh;

  const batchPrefix = `cmp-${batchId}-`;
  const oldBatch = new Map(currentNodes.filter((n) => n.id.startsWith(batchPrefix)).map((n) => [n.id, n]));
  const keepOutside = currentNodes.filter((n) => !n.id.startsWith(batchPrefix));

  // Position survival: same id → keep current position (drag wins over layout).
  const nodes = fresh.nodes.map((n) => {
    const prev = oldBatch.get(n.id);
    return prev ? { ...n, position: prev.position } : n;
  });

  // Edges: batch edges fully rebuilt from the revised spec; outside edges kept,
  // except any that now point at a removed batch node.
  const liveIds = new Set([...keepOutside.map((n) => n.id), ...nodes.map((n) => n.id)]);
  const outsideEdges = currentEdges.filter((e) =>
    !e.id.startsWith(batchPrefix) && liveIds.has(e.source) && liveIds.has(e.target));

  return {
    ok: true,
    nodes: [...keepOutside, ...nodes],
    edges: [...outsideEdges, ...fresh.edges],
    warnings: fresh.warnings,
    batchId,
  };
}

// src/canvas/engine/executeGraph.js
/**
 * Dependency-order lane execution over the canvas graph.
 * Pure orchestration: all IO happens inside executors via the ctx they get.
 *
 * executeGraph({ nodes, edges, targetId, outputs, ctx, force }) →
 *   { outputs, error, failedNodeId }
 *
 * - outputs: snapshot map { nodeId: output } — the input map is NOT mutated.
 * - ctx.report(nodeId, patch) is called for live progress (the canvas wires
 *   this to setNodeOutputs); the engine also calls it with each final output.
 * - A node with status/batchStatus/renderStatus === 'done' in `outputs` is
 *   skipped unless force — that is what makes re-running a half-finished
 *   lane resume instead of re-billing.
 * - First executor failure halts the lane (downstream of a failed node would
 *   only produce garbage); the failed node gets a status:'error' patch.
 */
import { subgraphOrder } from './graphOrder.js';
import { getExecutor } from './registry.js';

const isDone = (out) =>
  out && (out.status === 'done' || out.batchStatus === 'done' || out.renderStatus === 'done');

// Mirrors EPHEMERAL_STATUSES in src/canvas/persistence.js (kept local — the
// engine owns its failure-closeout semantics independent of how the view
// persists). In-flight values that must never survive a node failure: the
// node UIs disable their own buttons while one is set.
const EPHEMERAL = new Set(['rendering', 'submitting', 'polling', 'generating']);
const SUB_STATUS_FIELDS = ['batchStatus', 'renderStatus'];

export async function executeGraph({ nodes, edges, targetId, outputs = {}, ctx, force = false }) {
  const order = subgraphOrder(nodes, edges, targetId);
  const acc = { ...outputs };

  for (const node of order) {
    const spec = getExecutor(node.type);
    if (!spec) continue; // passive node — existing output (if any) flows through

    if (!force && isDone(acc[node.id])) continue; // resume semantics

    const inputs = edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => {
        const srcNode = nodes.find((x) => x.id === edge.source);
        return { sourceId: edge.source, sourceType: srcNode?.type || null, sourceData: srcNode?.data ?? null, output: acc[edge.source], edge };
      });

    let reportedInFlight = {};
    const nodeCtx = {
      ...ctx,
      node,
      inputs,
      // Full graph for executors that must walk past their direct inputs —
      // e.g. ugc-gen finds its character two hops up (char → ingredient → gen).
      nodes,
      edges,
      outputs: acc,
      report: (patch) => {
        reportedInFlight = { ...reportedInFlight, ...patch };
        ctx.report(node.id, patch);
      },
    };

    const maxAttempts = spec.retryable ? 2 : 1;
    let lastErr = null;
    let output = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        output = await spec.execute(nodeCtx);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (lastErr) {
      // Close out any in-flight sub-status the executor reported (or that was
      // restored from an interrupted session) — leaving e.g. renderStatus at
      // 'rendering' keeps the node's own buttons disabled forever.
      const errorPatch = { status: 'error', error: lastErr.message };
      const prior = acc[node.id] || {};
      for (const field of SUB_STATUS_FIELDS) {
        if (EPHEMERAL.has(reportedInFlight[field]) || EPHEMERAL.has(prior[field])) errorPatch[field] = 'error';
      }
      ctx.report(node.id, errorPatch);
      return { outputs: acc, error: `${node.type} (${node.id}): ${lastErr.message}`, failedNodeId: node.id };
    }

    acc[node.id] = output;
    ctx.report(node.id, output);
  }

  return { outputs: acc, error: null, failedNodeId: null };
}

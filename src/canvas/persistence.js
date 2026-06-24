// src/canvas/persistence.js
/**
 * Pure helpers for canvas localStorage persistence, extracted from
 * CanvasView.jsx so they can be unit-tested (the view file has no harness).
 *
 * Doctrine: in-flight statuses don't survive reloads — nothing in the canvas
 * resumes work from CANVAS_KEY state, so a node that was rendering when the
 * tab closed must hydrate idle next time. Every node UI defaults its status
 * fields (`result.xxxStatus || 'idle'`) and disables its action button while
 * one holds an in-flight value, so persisting one bricks the button with no
 * UI recovery (observed live 2026-06-12: a carousel output saved with
 * renderStatus:'rendering' left "Render Carousel" permanently disabled).
 *
 * The engine keeps its own copy of the core set (executeGraph.js EPHEMERAL —
 * it must stay free of view-layer imports); it closes out in-flight statuses
 * on node FAILURE, while this module closes them out on SAVE/RESTORE.
 */

// Top-level `status` values that drop the WHOLE output on save: the node was
// mid-flight, so the rest of the output is partial garbage. Unchanged legacy
// behavior — widen with care, dropping a whole output discards durable
// results from earlier runs.
export const EPHEMERAL_STATUSES = new Set(['rendering', 'submitting', 'polling', 'generating']);

// Every in-flight value any node writes into a status-named field. Used for
// the per-field scrub: the field is deleted (node hydrates idle) but durable
// sibling fields — slide URLs, video URLs, scripts — survive. Superset of
// EPHEMERAL_STATUSES (enforced by test).
export const IN_FLIGHT_STATUSES = new Set([
  ...EPHEMERAL_STATUSES,
  'grading',          // FFmpeg grade batchStatus
  'animating',        // carousel animateStatus
  'thinking',         // silence-cut suggestStatus
  'planning',         // motion-bake planStatus
  'baking',           // motion-bake bakeStatus
  'scanning',         // folder-scan scanStatus
  'posting',          // blotato status
  'uploading',        // blotato status
  'loading',          // file-loader / recap status
  'loading-accounts', // blotato status
  'running',          // command-runner status
]);

const isStatusKey = (key) => key === 'status' || key.endsWith('Status');

/**
 * Shallow-scrub one node output: delete any top-level `status` / `*Status`
 * field holding an in-flight value. Deliberately shallow — Sprite Forge
 * persists nested results[i].status:'polling' + taskId in its own storage
 * and resumes the poll on mount, so nested structures are not ours to touch.
 * Returns the same reference when nothing needs scrubbing.
 */
export function scrubEphemeralOutput(out) {
  if (!out || typeof out !== 'object' || Array.isArray(out)) return out;
  let copy = null;
  for (const key of Object.keys(out)) {
    if (isStatusKey(key) && IN_FLIGHT_STATUSES.has(out[key])) {
      if (!copy) copy = { ...out };
      delete copy[key];
    }
  }
  return copy || out;
}

/**
 * Scrub a whole nodeOutputs map for save (and for hydration, which heals
 * saves written before the per-field scrub existed). Whole-output drop on
 * ephemeral top-level `status` first, then the per-field scrub for what
 * that misses. Falsy entries pass through verbatim (legacy behavior).
 */
export function scrubEphemeralOutputs(nodeOutputs) {
  const clean = {};
  for (const [nid, out] of Object.entries(nodeOutputs)) {
    if (out && EPHEMERAL_STATUSES.has(out.status)) continue;
    clean[nid] = scrubEphemeralOutput(out);
  }
  return clean;
}

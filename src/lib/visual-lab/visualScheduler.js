// Small global activity governor for embedded Visual Lab stages. WebGL contexts
// may coexist as paused thumbnails, but at most two stages receive animation
// callbacks at once. Recently requested stages win a slot; hidden/offscreen or
// reduced-motion stages remain queued and resume when eligible again.

export const MAX_ACTIVE_VISUAL_STAGES = 2;

const entries = new Map();
let nextId = 1;
let requestOrder = 0;

function callSafely(callback, label) {
  try {
    callback();
  } catch (error) {
    console.error(`[visualScheduler] ${label} callback failed:`, error);
  }
}

function reconcile() {
  const candidates = Array.from(entries.values())
    .filter((entry) => entry.requested && entry.eligible)
    .sort((a, b) => b.order - a.order)
    .slice(0, MAX_ACTIVE_VISUAL_STAGES);
  const nextActiveIds = new Set(candidates.map((entry) => entry.id));

  for (const entry of entries.values()) {
    if (entry.active && !nextActiveIds.has(entry.id)) {
      entry.active = false;
      callSafely(entry.onDeactivate, 'deactivate');
    }
  }

  for (const entry of candidates) {
    if (!entry.active) {
      entry.active = true;
      callSafely(entry.onActivate, 'activate');
    }
  }
}

/**
 * Register one stage with the shared two-slot scheduler.
 * `requested` reflects play/pause. `eligible` reflects visibility, viewport,
 * context availability, and reduced-motion preference.
 */
export function registerVisualStageActivity({ onActivate, onDeactivate }) {
  if (typeof onActivate !== 'function' || typeof onDeactivate !== 'function') {
    throw new TypeError('visualScheduler: onActivate and onDeactivate are required');
  }

  const id = nextId;
  nextId += 1;
  const entry = {
    id,
    requested: false,
    eligible: true,
    active: false,
    order: 0,
    onActivate,
    onDeactivate,
  };
  entries.set(id, entry);

  return {
    setRequested(requested) {
      const next = !!requested;
      if (entry.requested === next) return;
      entry.requested = next;
      if (next) {
        requestOrder += 1;
        entry.order = requestOrder;
      }
      reconcile();
    },
    setEligible(eligible) {
      const next = !!eligible;
      if (entry.eligible === next) return;
      entry.eligible = next;
      reconcile();
    },
    isActive() {
      return entry.active;
    },
    dispose() {
      if (!entries.has(id)) return;
      if (entry.active) {
        entry.active = false;
        callSafely(entry.onDeactivate, 'dispose');
      }
      entries.delete(id);
      reconcile();
    },
  };
}

/** Test/debug snapshot; it contains no renderer or callback references. */
export function getVisualStageActivitySnapshot() {
  return Array.from(entries.values()).map((entry) => ({
    id: entry.id,
    requested: entry.requested,
    eligible: entry.eligible,
    active: entry.active,
    order: entry.order,
  }));
}

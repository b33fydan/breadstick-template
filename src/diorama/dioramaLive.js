// src/diorama/dioramaLive.js — the ornament contract + polling controller.
//
// An ornament binds to ONE honest number via { query, map, states }:
//   query:  async ({ fetchJson }) => value   — the only IO (injected fetchJson)
//   map:    (value) => stateKey              — PURE
//   states: { [stateKey]: descriptor }       — declarative, no THREE
// descriptor: { emissive: '#hex', emissiveIntensity: number, pulse: boolean }
//
// resolveStates / collectQueries are pure so they unit-test without a browser.
// createLivePoller wires query→map→states onto a live OrnamentSystem. This file
// imports NO THREE and NO catalog (catalog is passed in) — pure + cycle-free.
// Future bindings (plant→perf, megaphone→postiz) join here, or split into a
// dioramaBindings.js once this grows.

// ── monitor → job/render queue ──

export async function monitorQuery({ fetchJson }) {
  const { jobs = [] } = await fetchJson('/api/jobs');
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
  // "most recent" = highest createdAt; falls back to last-in-array when absent.
  const newest = jobs.reduce(
    (a, b) => ((b?.createdAt ?? 0) >= (a?.createdAt ?? 0) ? b : a),
    jobs[0]
  );
  const hasError = !!newest && newest.status === 'error';
  return { active, hasError };
}

export function monitorMap({ active, hasError }) {
  if (hasError) return 'error';
  if (active > 0) return 'active';
  return 'idle';
}

export const MONITOR_STATES = {
  idle:   { emissive: '#1a3a5a', emissiveIntensity: 0.15, pulse: false },
  active: { emissive: '#2f7fd0', emissiveIntensity: 0.9,  pulse: true  },
  error:  { emissive: '#d08a2f', emissiveIntensity: 0.8,  pulse: false },
};

export const MONITOR_BINDING = { query: monitorQuery, map: monitorMap, states: MONITOR_STATES };

// ── generic, pure ──

// Distinct queries to run this tick: one per ornament TYPE with a binding AND
// ≥1 placed instance. placed items are { ornamentId, placedId }.
export function collectQueries(placed, catalog) {
  const ids = new Set(placed.map((p) => p.ornamentId));
  const out = [];
  for (const id of ids) {
    const entry = catalog.find((o) => o.id === id);
    if (entry?.binding?.query) out.push({ ornamentId: id, query: entry.binding.query });
  }
  return out;
}

// feedValues is keyed by ornamentId. Returns [{ placedId, descriptor }] for each
// placed bound ornament whose feed resolved. Missing binding / missing feed /
// unknown state → skipped.
export function resolveStates(placed, catalog, feedValues) {
  const out = [];
  for (const p of placed) {
    const binding = catalog.find((o) => o.id === p.ornamentId)?.binding;
    if (!binding) continue;
    if (!(p.ornamentId in feedValues)) continue;
    const descriptor = binding.states[binding.map(feedValues[p.ornamentId])];
    if (descriptor) out.push({ placedId: p.placedId, descriptor });
  }
  return out;
}

// The orchestrator. deps = { fetchJson, logger? }. system has setOrnamentState.
// getPlaced() returns [{ ornamentId, placedId }]. setInterval/clearInterval are
// injectable for tests. start() runs one immediate tick then polls.
export function createLivePoller({
  system, getPlaced, catalog, deps,
  intervalMs = 8000,
  setInterval: setIv = setInterval,
  clearInterval: clearIv = clearInterval,
}) {
  const logger = deps.logger || console;
  let timer = null;
  let ticking = false;

  async function tick() {
    if (ticking) return; // don't overlap a slow poll
    ticking = true;
    try {
      const placed = getPlaced();
      const feedValues = {};
      await Promise.all(
        collectQueries(placed, catalog).map(async ({ ornamentId, query }) => {
          try {
            feedValues[ornamentId] = await query(deps);
          } catch (err) {
            // transient failure: leave the value unset so the ornament keeps its
            // last state (no flicker), and log.
            logger.warn?.(`[dioramaLive] query ${ornamentId} failed: ${err.message}`);
          }
        })
      );
      for (const { placedId, descriptor } of resolveStates(placed, catalog, feedValues)) {
        system.setOrnamentState(placedId, descriptor);
      }
    } finally {
      ticking = false;
    }
  }

  function start() {
    if (timer) return;
    tick();
    timer = setIv(tick, intervalMs);
  }
  function stop() {
    if (timer) { clearIv(timer); timer = null; }
  }
  return { start, stop, tick };
}

// src/canvas/engine/registry.js
/**
 * Node-type → executor registry.
 *
 * An executor spec is:
 *   {
 *     execute: async (ctx) => outputPatch,
 *     retryable?: boolean,   // engine retries once on throw when true
 *   }
 *
 * ctx (built by executeGraph):
 *   {
 *     node,                  // the @xyflow node object ({ id, type, data })
 *     inputs,                // [{ sourceId, sourceType, output, edge }] upstream entries
 *     outputs,               // full outputs map snapshot (read-only fallback scan)
 *     report(patch),         // merge a partial patch into this node's output (progress)
 *     server,                // e.g. 'http://localhost:3001'
 *     keys,                  // { anthropic, kie, model }
 *     fetchImpl,             // injected fetch (tests pass a fake)
 *   }
 *
 * execute() resolves to the node's FINAL output object (engine stores it
 * verbatim — it must match the shape the node's UI already renders).
 * Unregistered types are passive: their pre-existing output (if any) flows
 * downstream untouched.
 */
const registry = new Map();

export function registerExecutor(type, spec) {
  if (typeof spec?.execute !== 'function') {
    throw new Error(`executor for "${type}" must have an execute() function`);
  }
  if (registry.has(type)) throw new Error(`executor already registered for "${type}"`);
  registry.set(type, spec);
}

export function getExecutor(type) {
  return registry.get(type) || null;
}

export function clearRegistry() {
  registry.clear();
}

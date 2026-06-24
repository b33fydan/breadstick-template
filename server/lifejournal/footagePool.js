// Reads footage-index.json, dedupes stabilized/raw twins, groups un-used clips by lane.
import fs from 'node:fs';

export function createFootagePool({ indexPath }) {
  function load() {
    const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return Array.isArray(idx.clips) ? idx.clips : [];
  }
  // Twins collapse to one key: drop a trailing `_stabilized` before the extension, normalize slashes + case.
  function canonicalKey(rel) {
    return rel.replace(/\\/g, '/').toLowerCase().replace(/_stabilized(\.[^.]+)$/, '$1');
  }
  function isStabilized(rel) { return /_stabilized\.[^.]+$/i.test(rel); }
  function dedupe(clips) {
    const byKey = new Map();
    for (const c of clips) {
      const key = canonicalKey(c.rel);
      const existing = byKey.get(key);
      if (!existing) { byKey.set(key, c); continue; }
      if (isStabilized(c.rel) && !isStabilized(existing.rel)) byKey.set(key, c); // prefer stabilized
    }
    return [...byKey.values()];
  }
  function available(usedSet, { lanes } = {}) {
    let clips = dedupe(load()).filter((c) => !usedSet.has(c.rel));
    if (lanes && lanes.length) clips = clips.filter((c) => lanes.includes(c.lane));
    const byLane = {};
    for (const c of clips) (byLane[c.lane] ||= []).push(c);
    return byLane;
  }
  return { load, dedupe, available, canonicalKey };
}

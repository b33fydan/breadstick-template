// server/renderCache.js
/**
 * Reusable render memoization. Domain-free — knows nothing about Remotion or any
 * specific endpoint. A render is keyed by a content hash of its inputs; a cache
 * hit copies the stored output to the caller's path (or, when no outputPath is
 * given, the cache file IS the output) and skips the expensive render. Sync IO
 * throughout (mirrors server/jobQueue.js) so hit/miss/store/prune are unit-
 * testable against temp dirs. Spec: docs/.../2026-06-13-render-cache-design.md.
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, copyFileSync, readFileSync, readdirSync, statSync, unlinkSync, utimesSync } from 'fs';
import { join, dirname } from 'path';

// Bump to bust ALL cached renders (e.g. after editing a composition's source).
export const RENDER_CACHE_VERSION = 1;

export function createRenderCache({ now = () => Date.now() } = {}) {
  function keyFor(parts) {
    return createHash('sha1')
      .update(JSON.stringify({ v: RENDER_CACHE_VERSION, parts }))
      .digest('hex')
      .slice(0, 16);
  }

  function hashFile(path) {
    return createHash('sha1').update(readFileSync(path)).digest('hex');
  }

  async function run({ cacheDir, key, ext, outputPath = null, render }) {
    mkdirSync(cacheDir, { recursive: true });
    const cachePath = join(cacheDir, `${key}.${ext}`);
    if (existsSync(cachePath)) {
      if (outputPath && outputPath !== cachePath) {
        mkdirSync(dirname(outputPath), { recursive: true });
        copyFileSync(cachePath, outputPath);
      }
      const t = new Date(now());
      try { utimesSync(cachePath, t, t); } catch { /* mtime refresh is best-effort */ }
      return { cached: true, cachePath, outputPath: outputPath || cachePath };
    }
    const target = outputPath || cachePath;
    mkdirSync(dirname(target), { recursive: true });
    await render(target);
    if (outputPath && outputPath !== cachePath) {
      copyFileSync(outputPath, cachePath);
    }
    return { cached: false, cachePath, outputPath: outputPath || cachePath };
  }

  function prune({ cacheDir, maxAgeMs }) {
    let files;
    try { files = readdirSync(cacheDir); } catch { return { pruned: 0 }; }
    const cutoff = now() - maxAgeMs;
    let pruned = 0;
    for (const f of files) {
      const p = join(cacheDir, f);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (!st.isFile() || st.mtimeMs >= cutoff) continue;
      try { unlinkSync(p); pruned += 1; } catch { /* tolerate races */ }
    }
    return { pruned };
  }

  return { keyFor, hashFile, run, prune };
}

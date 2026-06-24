// Scans external/remotion (symlink to external/remotion) and writes
// pipeline/broll-catalog.json — the asset table the LLM picks from.
//
// For each comp at src/compositions/broll/<slug>/config.ts:
//   { id, slug, durationFrames, durationSec, width, height, fps }
//
// Run after adding new comps in the Remotion repo:
//   node tools/build_broll_catalog.js

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REMOTION_ROOT = join(__dirname, '..', 'external', 'remotion');
const BROLL_DIR = join(REMOTION_ROOT, 'src', 'compositions', 'broll');
const OUT_PATH = join(__dirname, '..', 'pipeline', 'broll-catalog.json');

function parseConfig(text) {
  const grab = (key) => {
    const m = text.match(new RegExp(`${key}\\s*:\\s*['"]?([^'",\\s}]+)`));
    return m ? m[1] : null;
  };
  const grabNum = (key) => {
    const v = grab(key);
    return v == null ? null : Number(v);
  };
  return {
    id: grab('id'),
    width: grabNum('width'),
    height: grabNum('height'),
    fps: grabNum('fps'),
    durationFrames: grabNum('durationInFrames'),
  };
}

async function main() {
  const slugs = (await readdir(BROLL_DIR, { withFileTypes: true }))
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  const catalog = [];
  for (const slug of slugs) {
    const cfgPath = join(BROLL_DIR, slug, 'config.ts');
    let raw;
    try {
      raw = await readFile(cfgPath, 'utf-8');
    } catch {
      continue;
    }
    const meta = parseConfig(raw);
    if (!meta.id) continue;
    catalog.push({
      id: meta.id,
      slug,
      width: meta.width || 1920,
      height: meta.height || 1080,
      fps: meta.fps || 30,
      durationFrames: meta.durationFrames || 270,
      durationSec: (meta.durationFrames || 270) / (meta.fps || 30),
    });
  }

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), count: catalog.length, comps: catalog }, null, 2));
  console.log(`Wrote ${catalog.length} comps → ${OUT_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });

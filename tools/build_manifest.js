// Assembles breadstick-manifest.json — ONE machine-readable inventory of
// everything Breadstick can do, generated from the real sources of truth:
//
//   serverRoutes         server.js (regex scan of app.get/post/delete/put/use)
//   remotionCompositions src/remotion/Root.jsx (<Composition> occurrences)
//   canvasNodes          src/canvas/CanvasView.jsx nodeTypes registry (+ spreads)
//   recipes              src/canvas/recipes.js (dynamic import, regex fallback)
//   brollCatalog         pipeline/broll-catalog.json (lean id/slug/durationSec)
//   carouselTemplates    carousels/templates/*.json
//   characters           src/data/characters.js (dynamic import)
//   cliVerbs             curated static list (pipeline/shortform CLIs)
//   topics               topics/*.json
//   skills               directory names under skills/ and .claude/skills/
//
// Every section degrades gracefully: a missing/unparseable source yields an
// empty section plus an entry in warnings[] — the generator never throws.
//
// Run after adding routes, nodes, comps, recipes, or templates:
//   npm run manifest   (or: node tools/build_manifest.js)


import { readFile, readdir, writeFile, stat, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_PATH = join(ROOT, 'breadstick-manifest.json');

/* ===== serverRoutes ===== */

// Streaming detection: a route is flagged streaming when the text between its
// app.<verb>( call and the next route registration sets an SSE content type
// (`Content-Type` paired with `text/event-stream` — matching on Content-Type
// specifically avoids false positives from Accept headers on outbound fetches).
// /api/exec is additionally hardcoded as belt-and-suspenders: it is the SSE
// command runner the canvas Terminal/Command Runner nodes depend on.
const HARDCODED_STREAMING = new Set(['/api/exec']);
const SSE_CONTENT_TYPE_RE = /['"]Content-Type['"]\s*[,:]\s*['"]text\/event-stream/;

// Curated one-liners for the load-bearing routes. Routes without an entry
// simply omit `description` — the manifest stays honest about what's curated.
const ROUTE_DESCRIPTIONS = {
  '/api/generate': 'Anthropic API proxy — all Claude script/content generation (supports webSearch: true)',
  '/api/openai/generate': 'OpenAI API proxy (alternate LLM lane)',
  '/api/buddy/chat': 'Breadstick astronaut buddy — desktop-pet co-pilot chat (Anthropic-backed)',
  '/api/kie/create': 'kie.ai task creation — any model via { model, input } (Kling, Nano Banana, GPT Image-2, ...)',
  '/api/kie/status/:taskId': 'kie.ai task polling',
  '/api/suno/create': 'Suno music generation task creation',
  '/api/suno/status/:taskId': 'Suno task polling',
  '/api/suno/callback': 'Suno webhook callback receiver',
  '/api/suno/save-to-disk': 'Persist finished Suno tracks to sounds/suno/',
  '/api/remotion/audio-viz': 'Render AudioVisualizer composition for an audio file',
  '/api/remotion/skyframe-overlay': 'Render Skyframe overlay pack composition over footage',
  '/api/remotion/composite': 'Composite video into carousel slide art zones (CarouselVideoSlide)',
  '/api/remotion/animate-terminal': 'Render animated terminal carousel slide (TerminalCarouselSlide)',
  '/api/remotion/skyframe-effect': 'Render a single Skyframe effect composition',
  '/api/remotion/chroma-motion': 'Remotion motion pass over chroma-keyed character footage',
  '/api/remotion/cartesian-composite': 'Cartesian Composer — N timed overlay zones at % coords over a base video',
  '/api/ffmpeg/grade': 'FFmpeg color grade pass',
  '/api/ffmpeg/chroma-composite': 'FFmpeg chroma-key character-over-slide composite',
  '/api/ffmpeg/chroma-stylize': 'FFmpeg chroma-key + stylize pass',
  '/api/carousel/render': 'Run carousel render.py pipeline (slides from script JSON)',
  '/api/broll/suggest': 'LLM picks b-roll comps from pipeline/broll-catalog.json for a script',
  '/api/broll/render': 'Render selected b-roll comps from the external Remotion repo',
  '/api/arecibo/recap': 'Build weekly-recap Arecibo cipher grid stats (localhost only)',
  '/api/arecibo/render': 'Render the Arecibo transmission decoder video (localhost only)',
  '/api/proactive/fire': 'Fire a named proactive Maestro turn (cron-driven outbound WhatsApp)',
  '/api/exec': 'Run a local command, stream stdout/stderr via SSE (localhost only)',
  '/api/exec/:jobId/stop': 'Stop a running exec job (localhost only)',
  '/api/wire-buffer/:nodeId': 'Write/clear canvas wire-buffer payload for a node (localhost only)',
  '/api/voice/start': 'Start the local voice agent (localhost only)',
  '/api/voice/stop': 'Stop the local voice agent (localhost only)',
  '/api/voice/status': 'Voice agent status (localhost only)',
  '/api/livekit/token': 'Mint LiveKit access token for voice sessions',
};

function scanServerRoutes(text) {
  // Path may sit on the line after the paren (e.g. /api/concept-composer/save
  // registers middleware first), hence \s* between ( and the quote.
  const routeRe = /app\.(get|post|delete|put|use)\(\s*['"`]([^'"`]+)['"`]/g;
  const matches = [];
  let m;
  while ((m = routeRe.exec(text)) !== null) {
    matches.push({ method: m[1].toUpperCase(), path: m[2], index: m.index });
  }
  return matches.map((route, i) => {
    // Handler body ≈ everything up to the next route registration. Crude but
    // sufficient for the SSE content-type heuristic.
    const bodyEnd = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const body = text.slice(route.index, bodyEnd);
    const streaming = HARDCODED_STREAMING.has(route.path) || SSE_CONTENT_TYPE_RE.test(body);
    const entry = { method: route.method, path: route.path };
    if (streaming) entry.streaming = true;
    const description = ROUTE_DESCRIPTIONS[route.path];
    if (description) entry.description = description;
    return entry;
  });
}

/* ===== remotionCompositions ===== */

function parseRemotionRoot(text) {
  // Root.jsx spreads {...DEFAULTS} into most beat comps — resolve the static
  // defaults object so those comps report real dimensions.
  const defaults = {};
  const defBlock = text.match(/const DEFAULTS = \{([\s\S]*?)\};/);
  if (defBlock) {
    for (const key of ['durationInFrames', 'fps', 'width', 'height']) {
      const km = defBlock[1].match(new RegExp(`${key}\\s*:\\s*(\\d+)`));
      if (km) defaults[key] = Number(km[1]);
    }
  }

  const comps = [];
  // Lazy-match to the closing /> — props are multiline but none of the
  // current prop bodies contain a literal "/>".
  const compRe = /<Composition\b([\s\S]*?)\/>/g;
  let m;
  while ((m = compRe.exec(text)) !== null) {
    const chunk = m[1];
    const idMatch = chunk.match(/id=["']([^"']+)["']/);
    if (!idMatch) continue;
    const comp = { id: idMatch[1] };
    if (/\{\s*\.\.\.DEFAULTS\s*\}/.test(chunk)) Object.assign(comp, defaults);
    // Explicit numeric props override the spread. Non-numeric values
    // (imported frame constants, computed expressions) are left out —
    // only statically present numbers make it into the manifest.
    const attrRe = /(width|height|fps|durationInFrames)=\{(\d+)\}/g;
    let am;
    while ((am = attrRe.exec(chunk)) !== null) comp[am[1]] = Number(am[2]);
    if (/calculateMetadata/.test(chunk)) comp.dynamic = true;
    comps.push(comp);
  }
  return comps;
}

/* ===== canvasNodes ===== */

function extractObjectKeys(body) {
  // Keys only: quoted strings or bare identifiers immediately followed by a
  // colon. Component values ("CharacterNode,") never precede a colon, so
  // they don't match.
  const keys = [];
  const keyRe = /(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/g;
  let m;
  while ((m = keyRe.exec(body)) !== null) keys.push(m[1] ?? m[2] ?? m[3]);
  return keys;
}

async function scanCanvasNodes(warnings) {
  const text = await readFile(join(ROOT, 'src', 'canvas', 'CanvasView.jsx'), 'utf-8');
  const block = text.match(/const nodeTypes = \{([\s\S]*?)\};/);
  if (!block) {
    warnings.push('canvasNodes: nodeTypes registry not found in CanvasView.jsx');
    return [];
  }
  const names = extractObjectKeys(block[1]);

  // Follow spread registries (currently ...SF_CHUNK_TYPES from
  // spriteForgeChunks.jsx) so chunk node types are inventoried too.
  const spreadRe = /\.\.\.([A-Za-z_$][\w$]*)/g;
  let sm;
  while ((sm = spreadRe.exec(block[1])) !== null) {
    const spreadName = sm[1];
    if (spreadName === 'SF_CHUNK_TYPES') {
      try {
        const sfText = await readFile(join(ROOT, 'src', 'canvas', 'spriteForgeChunks.jsx'), 'utf-8');
        const sfBlock = sfText.match(/export const SF_CHUNK_TYPES = \{([\s\S]*?)\};/);
        if (sfBlock) names.push(...extractObjectKeys(sfBlock[1]));
        else warnings.push('canvasNodes: SF_CHUNK_TYPES literal not found in spriteForgeChunks.jsx');
      } catch (err) {
        warnings.push(`canvasNodes: failed to read spriteForgeChunks.jsx (${err.message})`);
      }
    } else {
      warnings.push(`canvasNodes: unresolved spread ...${spreadName} in nodeTypes registry`);
    }
  }
  return names;
}

/* ===== recipes ===== */

async function scanRecipes(warnings) {
  const recipesPath = join(ROOT, 'src', 'canvas', 'recipes.js');
  try {
    // recipes.js is a pure data module (no JSX, no browser deps) — import it
    // for the real objects rather than regexing structured fields.
    const mod = await import(pathToFileURL(recipesPath).href);
    return (mod.RECIPES || []).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
    }));
  } catch (err) {
    warnings.push(`recipes: import failed (${err.message}) — falling back to regex name scan`);
    try {
      const text = await readFile(recipesPath, 'utf-8');
      const out = [];
      const re = /id:\s*'([^']+)',\s*\n\s*name:\s*'([^']+)'/g;
      let m;
      while ((m = re.exec(text)) !== null) out.push({ id: m[1], name: m[2] });
      return out;
    } catch (readErr) {
      warnings.push(`recipes: regex fallback failed (${readErr.message})`);
      return [];
    }
  }
}

/* ===== cliVerbs (curated — the CLIs are not parsed) ===== */

const CLI_VERBS = [
  { cli: 'pipeline-cli.js', verb: 'carousel', description: 'Render a carousel from a topic (--topic, template/length/live flags)' },
  { cli: 'pipeline-cli.js', verb: 'pop-beats', description: 'Beat-mapped pop overlay pass on a video' },
  { cli: 'pipeline-cli.js', verb: 'stack', description: 'Stack/composite videos into one output' },
  { cli: 'pipeline-cli.js', verb: 'image', description: 'Generate an image via the kie.ai lane' },
  { cli: 'pipeline-cli.js', verb: 'broll', description: 'Script → anchor frames → Kling 3.0 frame-sandwich b-roll videos' },
  { cli: 'shortform-cli.js', verb: 'quicktake', description: 'Quicktake shortform: record → transcribe → overlay → composite' },
  { cli: 'shortform-cli.js', verb: 'process', description: 'Process raw footage through the shortform pipeline' },
  { cli: 'shortform-cli.js', verb: 'longform', description: 'Longform processor: POV/desk → graded mp4 + clips + metadata (--silence-cut variant)' },
].map((v) => ({ ...v, source: 'curated' }));

/* ===== small file/dir helpers ===== */

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf-8'));
}

async function listDirNames(path) {
  // stat() (not the dirent type) so Windows junctions/symlinks into other
  // skill roots — e.g. skills/impeccable → .agents/skills/impeccable —
  // still count as directories.
  const entries = await readdir(path, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    try {
      if ((await stat(join(path, entry.name))).isDirectory()) names.push(entry.name);
    } catch {
      // dangling link — skip
    }
  }
  return names.sort();
}

/* ===== assembly ===== */

// Each section builder runs inside section(): a throw becomes a warning plus
// the section's empty fallback value — the manifest always materializes.
export async function buildManifest() {
  const warnings = [];
  const section = async (name, fn, empty = []) => {
    try {
      return await fn();
    } catch (err) {
      warnings.push(`${name}: ${err.message}`);
      return empty;
    }
  };

  const sections = {};

  sections.serverRoutes = await section('serverRoutes', async () =>
    scanServerRoutes(await readFile(join(ROOT, 'server.js'), 'utf-8')));

  sections.remotionCompositions = await section('remotionCompositions', async () =>
    parseRemotionRoot(await readFile(join(ROOT, 'src', 'remotion', 'Root.jsx'), 'utf-8')));

  sections.canvasNodes = await section('canvasNodes', () => scanCanvasNodes(warnings));

  sections.recipes = await section('recipes', () => scanRecipes(warnings));

  sections.brollCatalog = await section('brollCatalog', async () => {
    const cat = await readJson(join(ROOT, 'pipeline', 'broll-catalog.json'));
    const comps = Array.isArray(cat.comps) ? cat.comps : [];
    return {
      count: cat.count ?? comps.length,
      items: comps.map((c) => ({ id: c.id, slug: c.slug, durationSec: c.durationSec })),
    };
  }, { count: 0, items: [] });

  sections.carouselTemplates = await section('carouselTemplates', async () => {
    const dir = join(ROOT, 'carousels', 'templates');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
    const out = [];
    for (const file of files) {
      try {
        const t = await readJson(join(dir, file));
        out.push({ id: t.id, name: t.name, description: t.description });
      } catch (err) {
        warnings.push(`carouselTemplates: ${file} unreadable (${err.message})`);
      }
    }
    return out;
  });

  sections.characters = await section('characters', async () => {
    // characters.js is pure data — import for real fields. User-added
    // characters live in browser localStorage and are NOT covered here.
    const mod = await import(pathToFileURL(join(ROOT, 'src', 'data', 'characters.js')).href);
    return {
      _comment: 'Default characters only. User-added characters live in browser localStorage and are not covered by this manifest.',
      list: (mod.defaultCharacters || []).map((c) => ({
        id: c.id,
        name: c.name,
        niche: c.niche,
        hasCameo: !!c.cameoName,
      })),
    };
  }, { _comment: '', list: [] });

  sections.cliVerbs = CLI_VERBS;

  sections.topics = await section('topics', async () => {
    const dir = join(ROOT, 'topics');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
    const out = [];
    for (const file of files) {
      try {
        const data = await readJson(join(dir, file));
        const topicCount = Array.isArray(data) ? data.length
          : Array.isArray(data.topics) ? data.topics.length : 0;
        out.push({ file, topicCount });
      } catch (err) {
        warnings.push(`topics: ${file} unreadable (${err.message})`);
      }
    }
    return out;
  });

  sections.skills = await section('skills', async () => {
    const out = {};
    for (const root of ['skills', join('.claude', 'skills')]) {
      const key = root.replace(/\\/g, '/');
      try {
        out[key] = await listDirNames(join(ROOT, root));
      } catch (err) {
        warnings.push(`skills: ${key} unreadable (${err.message})`);
        out[key] = [];
      }
    }
    return out;
  }, {});

  return {
    version: 1,
    generated: new Date().toISOString(),
    warnings,
    sections,
  };
}

async function main() {
  // --out <path> overrides the repo-root target. The test suite uses this to
  // run the script end-to-end without dirtying the tracked manifest (the
  // generated timestamp changes on every run).
  const outIdx = process.argv.indexOf('--out');
  const outPath = outIdx !== -1 && process.argv[outIdx + 1]
    ? join(process.cwd(), process.argv[outIdx + 1])
    : OUT_PATH;
  const manifest = await buildManifest();
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(manifest, null, 2));
  const s = manifest.sections;
  console.log(
    `Wrote ${outPath}\n` +
    `  serverRoutes: ${s.serverRoutes.length}  remotionCompositions: ${s.remotionCompositions.length}  ` +
    `canvasNodes: ${s.canvasNodes.length}  recipes: ${s.recipes.length}\n` +
    `  broll: ${s.brollCatalog.count}  carouselTemplates: ${s.carouselTemplates.length}  ` +
    `characters: ${s.characters.list.length}  cliVerbs: ${s.cliVerbs.length}  ` +
    `topics: ${s.topics.length}  skills: ${Object.values(s.skills).flat().length}\n` +
    `  warnings: ${manifest.warnings.length}${manifest.warnings.length ? '\n    - ' + manifest.warnings.join('\n    - ') : ''}`
  );
}

// Only execute when run as a script — the test suite imports buildManifest().
const invokedDirectly = process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

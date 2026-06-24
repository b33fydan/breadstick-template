// src/canvas/composer/catalog.js
// The Conductor's entire knowledge of the canvas: one entry per speakable type.
// config schemas describe what the MODEL may set. Downstream pipeline nodes are
// wire-driven (read upstream nodeOutputs at run time) → config {}.
// hydrate(config, ctx, helpers) maps validated config → node `data`; default is
// config spread. ctx = { characters, scriptTypes, conversionLevels }.
// helpers.upstreamCharacter() → the character object wired above this node (or null).
import { FEWSHOTS } from './fewshots';

export const DELIVERABLE_TYPES = new Set([
  'carousel', 'ugc-video', 'kie-img2vid', 'remotion-comp', 'postiz', 'blotato',
]);

// Physical handle ids per type — must match the <Handle id="..."> declarations
// in the CanvasView node components, or React Flow refuses the edge (#008) and
// the ghost wiring renders invisible. `handles.in` may be a string, null (the
// component has no target handle — omit targetHandle), a { bySource, default }
// map keyed by the SOURCE node's type, or a function of the source spec node.
// Generator-family targets depend on the source ingredient's config, not just
// its type: pp/hk ingredients and st/cv type-selectors each dock on their own
// handle.
const INGREDIENT_TARGET = (src) => {
  if (src?.type === 'ingredient') return src.config?.kind === 'hk' ? 'hk' : 'pp';
  if (src?.type === 'type') return src.config?.cvId ? 'cv' : 'st';
  return 'pp';
};

export const CATALOG = {
  character: {
    handles: { out: 'out' },
    title: 'Character',
    purpose: 'AI influencer persona — root of every UGC lane.',
    lane: ['ugc'],
    inputs: [], outputs: ['character'],
    config: { characterId: { type: 'string', required: true } },
    hydrate: (config, ctx) => {
      const c = (ctx.characters || []).find((ch) => ch.id === config.characterId);
      return c ? { character: c } : null; // null → validation warning, node dropped
    },
    notes: 'characterId must be one of the ids listed in the prompt context.',
  },
  ingredient: {
    handles: { out: 'out', in: 'in' },
    title: 'Ingredient (pain point / hook)',
    purpose: 'One pain point or hook from the wired character.',
    lane: ['ugc'],
    inputs: ['character'], outputs: ['ingredient'],
    config: {
      kind: { enum: ['pp', 'hk'], default: 'pp' },
      index: { type: 'number', default: 0 },
    },
    hydrate: (config, ctx, helpers) => {
      const c = helpers.upstreamCharacter();
      if (!c) return null;
      const list = config.kind === 'hk' ? c.hooks : c.painPoints;
      if (!list || list.length === 0) return null;
      const i = Math.min(Math.max(config.index ?? 0, 0), list.length - 1);
      return {
        label: `${config.kind === 'hk' ? 'Hook' : 'Pain Point'} #${i + 1}`,
        text: list[i], index: i, kind: config.kind,
        accent: c.accentColor || '#C9A227',
      };
    },
    notes: 'Wire character → ingredient. index selects which pain point/hook.',
  },
  type: {
    handles: { out: 'out' },
    title: 'Script Type / Conversion Level',
    purpose: 'Selects script type (stId) OR conversion level (cvId) for the generator.',
    lane: ['ugc'],
    inputs: [], outputs: ['type'],
    config: {
      stId: { type: 'string' },
      cvId: { type: 'string' },
    },
    hydrate: (config, ctx) => {
      if (config.stId) {
        const st = (ctx.scriptTypes || []).find((s) => s.id === config.stId);
        return st ? { name: st.name, meta: st.duration, stId: st.id } : null;
      }
      if (config.cvId) {
        const cv = (ctx.conversionLevels || []).find((c) => c.id === config.cvId);
        return cv ? { name: cv.name, meta: cv.ratio, cvId: cv.id } : null;
      }
      return null;
    },
    notes: 'Exactly one of stId | cvId. UGC lane needs one of each wired to ugc-gen.',
  },
  generator: {
    handles: { out: 'out', in: INGREDIENT_TARGET },
    title: 'Script Generator (classic)',
    purpose: 'Classic carousel-storytelling script generator.',
    lane: ['ugc'],
    inputs: ['character', 'ingredient', 'type'], outputs: ['script'],
    config: {},
    notes: 'Prefer ugc-gen for UGC reels and niche-gen for niche/topic scripts.',
  },
  'ugc-gen': {
    handles: { out: 'script-out', in: INGREDIENT_TARGET },
    title: 'Script Gen UGC',
    purpose: 'UGC script from character + pain point + hook + script type + conversion level.',
    lane: ['ugc'],
    inputs: ['ingredient', 'ingredient', 'type', 'type'], outputs: ['script'],
    config: {},
    notes: 'Needs exactly 4 wires: pp-ingredient + hk-ingredient + stId-type + cvId-type. Character is traced upstream through each ingredient edge — do NOT wire character directly to ugc-gen.',
  },
  'niche-gen': {
    handles: { out: 'script-out', in: 'scraper-in' },
    title: 'Niche Script Gen',
    purpose: 'Topic-driven script generator for carousel/16-gami/video lanes.',
    lane: ['carousel-video', '16gami', 'video'],
    inputs: [], outputs: ['script'],
    config: {
      topic: { type: 'string', required: true },
      tone: { enum: ['educational', 'dramatic', 'inspirational', 'analytical', 'narrative'], default: 'educational' },
      length: { enum: ['short', 'medium', 'long'], default: 'medium' },
      researchLive: { type: 'boolean', default: false },
    },
    notes: 'Head node of three lanes. researchLive enables web search grounding.',
  },
  'clip-splitter': {
    handles: { out: 'clips-out', in: 'script-in' },
    title: 'Clip Splitter',
    purpose: 'Splits a script into 9s talking clips (greedy sentence packing).',
    lane: ['ugc'],
    inputs: ['script'], outputs: ['clips'],
    config: {},
    notes: 'Wire ugc-gen → clip-splitter.',
  },
  'avatar-frame': {
    handles: { out: 'frames-out', in: null }, // component has no target handle — edges into it omit targetHandle
    title: 'Avatar Frames',
    purpose: 'Character start-frames for each clip (image gen).',
    lane: ['ugc'],
    inputs: ['clips'], outputs: ['frames'],
    config: {},
    notes: 'Wire clip-splitter → avatar-frame.',
  },
  'ugc-video': {
    handles: { out: 'video-out', in: { bySource: { 'clip-splitter': 'clips-in', 'avatar-frame': 'frames-in' }, default: 'clips-in' } },
    title: 'UGC Video (Kling 3.0)',
    purpose: 'Renders talking clips into final UGC video segments.',
    lane: ['ugc'],
    inputs: ['clips', 'frames'], outputs: ['video'],
    config: {},
    notes: 'Terminal node of the UGC lane.',
  },
  'title-card': {
    handles: { out: 'title-out', in: 'script-in' },
    title: 'Title Card',
    purpose: 'Branded title-card art for the carousel video lane.',
    lane: ['carousel-video'],
    inputs: ['script'], outputs: ['image'],
    config: {},
    notes: 'Wire niche-gen → title-card.',
  },
  'gami-art': {
    handles: { out: 'image-out', in: 'script-in' },
    title: '16-GAMI Art',
    purpose: 'Realistic 16-bit origami art per script beat (kie.ai).',
    lane: ['carousel-video', '16gami', 'video'],
    inputs: ['script'], outputs: ['images'],
    config: {},
    notes: 'Wire niche-gen → gami-art.',
  },
  'frame-sandwich': {
    handles: { out: 'video-out', in: { bySource: { 'title-card': 'first-in', 'gami-art': 'last-in', 'image-2': 'last-in' }, default: 'first-in' } },
    title: 'Frame Sandwich (Kling 3.0)',
    purpose: 'First+last frame video gen between title card and art frames.',
    lane: ['carousel-video'],
    inputs: ['image', 'images'], outputs: ['video'],
    config: {},
    notes: 'Wire title-card AND gami-art into frame-sandwich.',
  },
  carousel: {
    handles: { out: 'carousel-out', in: { bySource: { 'gami-art': 'art-in', 'image-2': 'art-in', 'title-card': 'art-in' }, default: 'script-in' } },
    title: 'Carousel',
    purpose: 'Renders slide deck from art + script (render.py pipeline).',
    lane: ['carousel-video', '16gami'],
    inputs: ['images', 'script'], outputs: ['deck'],
    config: {},
    notes: 'Deliverable. 16-gami lane terminal: niche-gen → gami-art → carousel.',
  },
  'remotion-comp': {
    handles: { out: 'composite-out', in: { bySource: { carousel: 'slides-in' }, default: 'videos-in' } },
    title: 'Remotion Compositor',
    purpose: 'Composites video into carousel slide art zones.',
    lane: ['carousel-video'],
    inputs: ['video', 'deck'], outputs: ['video'],
    config: {},
    notes: 'Deliverable. Terminal of the carousel video lane.',
  },
  'vid-prompt': {
    handles: { out: 'vidprompt-out', in: { bySource: { 'niche-gen': 'script-in', generator: 'script-in', 'ugc-gen': 'script-in' }, default: 'art-in' } },
    title: 'Video Prompt',
    purpose: 'Builds img2vid motion prompts from script + art.',
    lane: ['video'],
    inputs: ['script', 'images'], outputs: ['prompts'],
    config: {},
    notes: 'Wire niche-gen and gami-art → vid-prompt.',
  },
  'kie-img2vid': {
    handles: { out: 'video-out', in: 'vidprompt-in' },
    title: 'KIE Img2Vid (Kling 2.6)',
    purpose: 'Animates art frames using motion prompts.',
    lane: ['video'],
    inputs: ['images', 'prompts'], outputs: ['video'],
    config: {},
    notes: 'Deliverable. Terminal of the video lane.',
  },
  'image-2': {
    handles: { out: 'image-out', in: 'prompt-in' },
    title: 'GPT Image-2',
    purpose: 'Typography-strong image gen (kie.ai), complement to Nano Banana.',
    lane: ['carousel-video', '16gami'],
    inputs: ['script'], outputs: ['images'],
    config: {
      aspectRatio: { enum: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'], default: '1:1' },
      style: { enum: ['none', 'scene', 'infographic'], default: 'none' },
      freeformText: { type: 'string', default: '' },
    },
    notes: 'Alternative to gami-art when typography matters.',
  },
  'qc-gate': {
    handles: { out: 'qc-pass', in: 'qc-in' },
    title: 'QC Gate',
    purpose: 'Deterministic ship gate (SHIP/QUARANTINE/REJECT) before publish.',
    lane: ['ugc', 'carousel-video', '16gami', 'video'],
    inputs: ['script', 'video', 'deck'], outputs: ['gated'],
    config: {},
    notes: 'Place before postiz/blotato whenever a publish node is present.',
  },
  hyperframes: {
    handles: { out: 'overlay-out', in: 'video-in' },
    title: 'Hyperframes',
    purpose: 'HTML+GSAP caption burns / overlay effects on video.',
    lane: ['ugc', 'video'],
    inputs: ['video'], outputs: ['video'],
    config: {},
    notes: 'Optional polish stage between video gen and publish.',
  },
  'ffmpeg-grade': {
    handles: { out: 'graded-out', in: 'video-in' },
    title: 'FFmpeg Grade',
    purpose: 'Color grade / finishing pass on rendered video.',
    lane: ['ugc', 'video'],
    inputs: ['video'], outputs: ['video'],
    config: {},
    notes: 'Optional polish stage.',
  },
  postiz: {
    handles: { in: { bySource: { 'niche-gen': 'caption-in', generator: 'caption-in', 'ugc-gen': 'caption-in' }, default: 'media-in' } },
    title: 'Postiz',
    purpose: 'Scheduling handoff — composes the post, Postiz UI finalizes.',
    lane: ['ugc', 'carousel-video', '16gami', 'video'],
    inputs: ['video', 'deck', 'gated'], outputs: [],
    config: {},
    notes: 'Deliverable (publish). Default mode slot — scheduling, not post-now.',
  },
  blotato: {
    handles: { in: { bySource: { 'niche-gen': 'text', generator: 'text', 'ugc-gen': 'text' }, default: 'media' } },
    title: 'Blotato',
    purpose: 'Multi-platform publish via Blotato MCP proxy.',
    lane: ['ugc', 'carousel-video', '16gami', 'video'],
    inputs: ['video', 'deck', 'gated'], outputs: [],
    config: {},
    notes: 'Deliverable (publish).',
  },
};

// Compiled per call with live runtime context (characters etc.). Static within
// a session — callers should build it once and reuse (prompt-cache friendly).
export function compileCatalogPrompt(ctx) {
  const types = Object.entries(CATALOG).map(([type, e]) => {
    const cfg = Object.entries(e.config || {}).map(([f, r]) =>
      `      ${f}: ${r.enum ? r.enum.join('|') : r.type}${r.required ? ' (required)' : r.default !== undefined ? ` (default ${JSON.stringify(r.default)})` : ''}`
    ).join('\n');
    return [
      `  - type "${type}" — ${e.title}`,
      `    purpose: ${e.purpose}`,
      `    lanes: ${e.lane.join(', ')} | inputs: ${e.inputs.join(', ') || 'none'} | outputs: ${e.outputs.join(', ') || 'none'}${DELIVERABLE_TYPES.has(type) ? ' | DELIVERABLE' : ''}`,
      cfg ? `    config:\n${cfg}` : null,
      e.notes ? `    notes: ${e.notes}` : null,
    ].filter(Boolean).join('\n');
  }).join('\n');

  const characters = (ctx.characters || []).map((c) => `  - ${c.id} (${c.name}${c.niche ? ` — ${c.niche}` : ''})`).join('\n');
  const sts = (ctx.scriptTypes || []).map((s) => `  - ${s.id} (${s.name})`).join('\n');
  const cvs = (ctx.conversionLevels || []).map((c) => `  - ${c.id} (${c.name})`).join('\n');

  const examples = FEWSHOTS.map((f, i) =>
    `EXAMPLE ${i + 1}\nUser: ${f.ask}\nAssistant: ${JSON.stringify({ reply: f.spec.rationale, spec: f.spec })}`
  ).join('\n\n');

  return `You are the Conductor — the pipeline composer for Breadstick's canvas. The user describes a deliverable; you propose a node graph.

RESPONSE FORMAT — reply with ONE raw JSON object, no code fences, no prose outside it:
{ "reply": "<conversational text, always present>", "spec": <pipeline spec or null> }
Omit/null the spec when you need to ask a clarifying question instead of proposing.

PIPELINE SPEC SHAPE:
{ "intent": "<one line>", "lane": "ugc|carousel-video|16gami|video",
  "nodes": [ { "ref": "<short id>", "type": "<catalog type>", "label": "<optional>", "config": { } } ],
  "edges": [ { "from": "<ref>", "to": "<ref>" } ],
  "rationale": "<one line, shown to the user>" }

RULES:
- Use ONLY catalog types below. Never invent types or config fields.
- Graphs must be acyclic and self-contained — assume a blank canvas area. Do not reference existing nodes.
- Refs are yours to choose; keep them short and stable across revisions of the same proposal.
- Never include positions — layout is not your job.
- End every lane in a DELIVERABLE node unless the user explicitly asks for a partial lane.
- When a publish node (postiz, blotato) is present, place a QC Gate immediately before it.
- On revision requests, re-emit the FULL spec with unchanged refs kept identical. Never re-propose a node the user rejected.
- characterId / stId / cvId values MUST come from the RUNTIME CONTEXT lists below — never copy ids from the examples.
- UGC lane arming rule: ugc-gen needs a pp ingredient, hk ingredient, an stId type node, and a cvId type node wired in; ingredients wire FROM a character node; character is NEVER wired directly to ugc-gen.

NODE CATALOG:
${types}

RUNTIME CONTEXT:
characters:
${characters || '  (none)'}
scriptTypes:
${sts || '  (none)'}
conversionLevels:
${cvs || '  (none)'}

${examples}`;
}

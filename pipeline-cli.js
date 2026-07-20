#!/usr/bin/env node
/**
 * Breadstick Pipeline CLI — Level 1
 *
 * Runs the full carousel pipeline headless by calling the Express server endpoints.
 * The same pipeline you test on the canvas, executed from the command line.
 *
 * Prerequisites: server must be running (`npm run server`)
 *
 * Usage:
 *   node pipeline-cli.js --topic "quantum encryption" --tone dramatic
 *   node pipeline-cli.js --topic "AI agents" --length long --motion origami-morph
 *   node pipeline-cli.js --topic "zero trust" --handle @yourhandle --skip-video
 *
 * Environment:
 *   ANTHROPIC_API_KEY — for script generation (or --anthropic-key)
 *   KIE_API_KEY       — for 16-GAMI art, title cards, frame sandwich (or --kie-key)
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import {
  slugify as coreSlugify, log, timestamp, makeClient, callAnthropic,
  pollKieTask as corePollKieTask, kieBatch as coreKieBatch, openCheckpoint,
} from './lib/cli-core.js';

// ── Config & Defaults ────────────────────────────────────────────────────────

const SERVER = 'http://localhost:3001';

const TONES = ['educational', 'dramatic', 'inspirational', 'analytical', 'narrative'];
const LENGTHS = {
  test:   { slides: '1',     words: '10-20' },
  short:  { slides: '4-6',   words: '60-100' },
  medium: { slides: '8-10',  words: '120-180' },
  long:   { slides: '12-15', words: '200-280' },
};

const MOTIONS = {
  'paper-unfold':  'Stop-motion animation of origami paper slowly unfolding and opening to reveal the scene beneath. Creased edges relax and flatten. Layered cardstock separates into depth planes. Paper fibers catch the light as folds release. Everything is paper — no wind, no particles. Smooth stop-motion paper craft animation.',
  'envelope-open': 'Stop-motion animation of a paper envelope slowly opening its flap. The sealed edge peels back, cardstock layers separate, revealing folded contents that unfurl into the final scene. Paper texture catches light at fold creases. Only paper moves — everything else frozen. Stop-motion paper craft.',
  'cardboard-flip': 'Stop-motion animation of a cardboard panel flipping over in place, revealing a new scene on the reverse side. The card rotates with visible paper thickness at edges, casting moving shadows. Paper grain and fold lines visible throughout. Pure paper physics, no other movement.',
  'page-turn':     'Stop-motion animation of a thick paper page turning from right to left, like a book page flip. The page curls naturally showing paper thickness and fiber texture. As it settles, the new page reveals the final scene. Only the page moves — desk and surroundings perfectly still.',
  'origami-morph': 'Stop-motion animation of origami paper blocks folding and re-folding themselves into a new shape. Paper creases form new geometry, flat surfaces become 3D structures. Each fold reveals more of the final scene. Soft studio lighting, clean shadows, high-detail paper textures. Only paper folds — nothing else moves.',
};

const GAMI_ART_STYLE = 'High-resolution product photograph of a physical, multi-layered cut paper and origami sculpture. Stair-stepped pixelated aesthetic merged with traditional origami folds. Multi-layered 3D cardstock construction. Soft directional lighting creating distinct drop shadows between physical paper layers. Hyper-realistic tangible texture contrasted with digital abstraction. 16-bit jagged physics reinforced by fold geometry.';

const TITLE_CARD_STYLE = 'High-resolution product photograph of a physical piece of aged paper resting on a wooden desk surface. The paper has hand-written text in bold, slightly imperfect lettering — as if written with a thick marker or brush pen on textured cardstock. Stair-stepped pixelated aesthetic merged with traditional origami folds on the paper edges. Multi-layered 3D cardstock construction visible at the paper borders — folded, creased edges with torn fiber detail. Soft directional lighting creating distinct drop shadows between the paper and desk. Hyper-realistic tangible texture. 16-bit jagged physics reinforced by fold geometry. The desk has subtle props: a pencil, paper clips, or a coffee ring stain. Shallow depth of field. Warm, nostalgic studio lighting.';


// ── Arg Parsing ──────────────────────────────────────────────────────────────

const TEMPLATES = ['skyframe', 'droplets', 'plain-blue', 'plain-black', 'plain-white'];
const FORMATS = ['image_body', 'text_only', 'terminal'];

const TERMINAL_DEFAULT_HEADER   = 'Claude Code v2.1.87';
const TERMINAL_DEFAULT_SUBTITLE = 'Opus 4.6 (1M context) - Claude Max';
const TERMINAL_DEFAULT_CWD      = '~/breadstick';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    topic: null,
    tone: 'dramatic',
    length: 'medium',
    template: 'plain-black',
    format: 'image_body',
    research: false,
    animate: false,
    handle: '@yourhandle',
    tagText: 'BREADSTICK',
    upperRight: '',
    lowerRight: 'swipe for more',
    motion: 'paper-unfold',
    duration: '5',
    aspectRatio: '9:16',
    resolution: '2K',
    videoMode: 'pro',
    skipVideo: false,
    anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    kieKey: process.env.KIE_API_KEY || '',
    model: 'claude-sonnet-4-6',
    dryRun: false,
    resume: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--topic':         opts.topic = next; i++; break;
      case '--tone':          opts.tone = next; i++; break;
      case '--length':        opts.length = next; i++; break;
      case '--template':      opts.template = next; i++; break;
      case '--format':        opts.format = next; i++; break;
      case '--research':      opts.research = true; break;
      case '--animate':       opts.animate = true; break;
      case '--handle':        opts.handle = next; i++; break;
      case '--tag':            opts.tagText = next; i++; break;
      case '--upper-right':   opts.upperRight = next; i++; break;
      case '--lower-right':   opts.lowerRight = next; i++; break;
      case '--motion':        opts.motion = next; i++; break;
      case '--duration':      opts.duration = next; i++; break;
      case '--aspect-ratio':  opts.aspectRatio = next; i++; break;
      case '--resolution':    opts.resolution = next; i++; break;
      case '--video-mode':    opts.videoMode = next; i++; break;
      case '--skip-video':    opts.skipVideo = true; break;
      case '--anthropic-key': opts.anthropicKey = next; i++; break;
      case '--kie-key':       opts.kieKey = next; i++; break;
      case '--model':         opts.model = next; i++; break;
      case '--dry-run':       opts.dryRun = true; break;
      case '--resume':        opts.resume = next; i++; break;
      case '--help': case '-h':
        console.log(HELP_TEXT);
        process.exit(0);
    }
  }

  if (!opts.topic) {
    console.error('Error: --topic is required\n');
    console.log(HELP_TEXT);
    process.exit(1);
  }
  if (!opts.anthropicKey) {
    console.error('Error: ANTHROPIC_API_KEY env var or --anthropic-key required');
    process.exit(1);
  }
  const skipsKie = opts.format === 'text_only' || opts.format === 'terminal';
  if (!opts.kieKey && !skipsKie) {
    console.error('Error: KIE_API_KEY env var or --kie-key required (unless --format text_only|terminal)');
    process.exit(1);
  }
  if (!TONES.includes(opts.tone)) {
    console.error(`Error: --tone must be one of: ${TONES.join(', ')}`);
    process.exit(1);
  }
  if (!LENGTHS[opts.length]) {
    console.error(`Error: --length must be one of: ${Object.keys(LENGTHS).join(', ')}`);
    process.exit(1);
  }
  if (!TEMPLATES.includes(opts.template)) {
    console.error(`Error: --template must be one of: ${TEMPLATES.join(', ')}`);
    process.exit(1);
  }
  if (!FORMATS.includes(opts.format)) {
    console.error(`Error: --format must be one of: ${FORMATS.join(', ')}`);
    process.exit(1);
  }

  return opts;
}

const HELP_TEXT = `
Breadstick Pipeline CLI — Carousel Video Pipeline

Usage:
  node pipeline-cli.js --topic <topic> [options]

Required:
  --topic <text>          Content topic (e.g. "quantum encryption")

Options:
  --tone <tone>           ${TONES.join(' | ')} (default: dramatic)
  --length <len>          test | short | medium | long (default: medium)
  --template <id>         ${TEMPLATES.join(' | ')} (default: plain-black)
  --format <id>           ${FORMATS.join(' | ')} (default: image_body)
                          text_only & terminal skip 16-GAMI art (faster, free)
  --research              Enable Anthropic web_search for live/current topics
  --animate               Render typing-animation mp4 per terminal slide
                          (only valid with --format terminal)
  --handle <handle>       Footer handle (default: @yourhandle)
  --tag <text>            Upper-left tag badge (default: BREADSTICK)
  --upper-right <text>    Upper-right text (default: empty)
  --lower-right <text>    Lower-right text (default: swipe for more)
  --motion <style>        ${Object.keys(MOTIONS).join(' | ')} | random (default: paper-unfold)
  --duration <sec>        3 | 5 | 10 (default: 5)
  --aspect-ratio <ar>     9:16 | 16:9 | 1:1 (default: 9:16)
  --resolution <res>      1K | 2K | 4K (default: 2K)
  --video-mode <mode>     pro | std (default: pro)
  --skip-video            Skip frame sandwich video generation
  --anthropic-key <key>   Anthropic API key (or ANTHROPIC_API_KEY env)
  --kie-key <key>         kie.ai API key (or KIE_API_KEY env)
  --model <model>         Anthropic model (default: claude-sonnet-4-6)
  --dry-run               Print the billing plan (task counts, models) and exit
                          without calling Anthropic or kie.ai
  --resume <file>         Resume from a kie checkpoint ledger — already-submitted
                          tasks are polled, not re-created (no double billing)

Environment:
  ANTHROPIC_API_KEY       Anthropic API key
  KIE_API_KEY             kie.ai API key

Examples:
  node pipeline-cli.js --topic "zero trust architecture" --tone analytical
  node pipeline-cli.js --topic "AI agents in 2026" --length long --skip-video
  node pipeline-cli.js --topic "ransomware" --motion origami-morph --duration 10
`.trim();


// ── Helpers ──────────────────────────────────────────────────────────────────
// log/sleep/timestamp/slugify and all Anthropic/kie plumbing live in
// lib/cli-core.js — shared with shortform-cli and maestro-cli.

const { post } = makeClient(SERVER);

// Run-scoped kie context: set once per run (main/runBroll) so every kieBatch
// call shares one checkpoint ledger and honors --dry-run.
const kieRunCtx = { checkpoint: null, dryRun: false };

function initKieRun(opts, kind) {
  kieRunCtx.dryRun = !!opts.dryRun;
  if (opts.dryRun) return;
  const file = opts.resume || `.tmp/kie-checkpoints/${kind}-${slugify(opts.topic || opts.theme)}-${timestamp()}.json`;
  kieRunCtx.checkpoint = openCheckpoint(file);
  log('LEDGER', `${opts.resume ? 'Resuming' : 'Checkpointing'} kie tasks → ${file}`);
}

function parseSlides(scriptText) {
  const lines = scriptText.split('\n').filter(l => l.trim().length > 0);
  const slides = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(/^(\d+)[.):\s]/);
    if (match) {
      if (current) slides.push(current);
      current = { num: parseInt(match[1]), text: line.replace(/^\d+[.):\s]+/, '').trim() };
    } else if (current) {
      current.text += ' ' + line.trim();
    }
  }
  if (current) slides.push(current);
  if (slides.length === 0) {
    return lines.filter(l => !l.startsWith('[')).map((l, i) => ({ num: i + 1, text: l.trim() }));
  }
  return slides;
}

function buildGamiPrompt(slideText) {
  return `${GAMI_ART_STYLE}\n\nThe sculpture depicts a scene inspired by this narrative:\n"${slideText}"\n\nTranslate the emotional core of this narrative into a single origami diorama. Use folded paper characters, layered cardstock environments, and pixel-grid textures to convey the mood. Angled macro-level perspective with shallow depth of field emphasizing paper textures and cardstock grain.`;
}

function buildGamiCtaPrompt() {
  return `${GAMI_ART_STYLE}\n\nThe sculpture depicts a small AI Agent. Origami paper folds and layered cardstock construction. Angled macro-level perspective with shallow depth of field emphasizing paper textures and cardstock grain.`;
}

function buildTitleCardPrompt(slideText) {
  const words = slideText.split(/\s+/);
  const title = words.length > 8 ? words.slice(0, 8).join(' ') + '...' : slideText;
  return `${TITLE_CARD_STYLE}\n\nThe text written on the paper reads: "${title}"\n\nThe paper sits naturally on a warm wooden desk. The handwriting is bold and legible, slightly imperfect like real handwriting. The paper has origami-style folded edges with visible cardstock layers. Environment props are minimal and desk-appropriate.`;
}


// ── kie.ai batch with polling ────────────────────────────────────────────────

async function kieBatch(label, kieKey, tasks) {
  // tasks: [{ model, input }] → [{ url, error }]
  return coreKieBatch({
    server: SERVER, kieKey, tasks, label,
    checkpoint: kieRunCtx.checkpoint, dryRun: kieRunCtx.dryRun,
  });
}


// ── Pipeline Steps ───────────────────────────────────────────────────────────

async function stepGenerateScript(opts) {
  const len = LENGTHS[opts.length];
  const parseRange = (s) => {
    const parts = String(s).split('-').map(p => parseInt(p, 10));
    return { min: parts[0] || 1, max: parts[1] || parts[0] || 1 };
  };
  const slidesR = parseRange(len.slides);
  const wordsR = parseRange(len.words);
  const maxPerSlide = Math.max(1, Math.ceil(wordsR.max / slidesR.max));
  const researchClause = opts.research
    ? `\n- This topic may involve current events past your training cutoff. Use the web_search tool to ground every factual claim in recent, verified sources. If search returns nothing usable, say so on slide 1 and stop, do NOT invent details, names, dates, or quotes.`
    : '';

  const systemPrompt = `You are a visual storytelling scriptwriter for 16-gami origami art content. You write scripts designed to be visualized as multi-slide carousel content with origami-style imagery.

HARD LENGTH BUDGET \u2014 these limits are non-negotiable and override every other instruction including tone:
- TOTAL: ${wordsR.max} words MAX across the entire script. Going over breaks the carousel layout.
- SLIDES: ${len.slides} numbered slides, no more.
- PER SLIDE: ${maxPerSlide} words MAX per slide. 1-2 sentences typical, 3 only when essential.
- The tone (${opts.tone}) controls voice, pacing, and word choice. It does NOT add words. Educational, Dramatic, Inspirational, Analytical, and Narrative all share the exact same length budget.

Style:
- Numbered slides, one concept per slide
- Vivid, visual language that translates well to imagery
- Slide 1 must be a scroll-stopping hook
- Final slide is a clear takeaway or call to reflection
- NEVER use em dashes (\u2014) or en dashes (\u2013). Use commas, periods, colons, or hyphens (-) instead. The downstream renderer cannot display them.${researchClause}

Output ONLY the script text. Each slide on its own line, prefixed with the slide number. No metadata, no commentary, no source citations in the body.`;

  log('SCRIPT', `Generating ${opts.tone} script about "${opts.topic}" (${opts.length}${opts.research ? ', research' : ''})...`);

  const { text: script } = await callAnthropic({
    server: SERVER,
    apiKey: opts.anthropicKey,
    model: opts.model,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Write a ${opts.tone} visual storytelling script about: ${opts.topic}` }],
    webSearch: !!opts.research,
  });
  if (!script) throw new Error('Empty script returned');

  const slides = parseSlides(script);
  log('SCRIPT', `Generated ${slides.length} slides`);
  return { script, slides };
}

async function stepGenerateArt(opts, slides) {
  const prompts = [
    ...slides.map(s => buildGamiPrompt(s.text)),
    buildGamiCtaPrompt(),
  ];

  log('16-GAMI', `Generating ${prompts.length} images (${slides.length} slides + 1 CTA)...`);

  const tasks = prompts.map(prompt => ({
    model: 'nano-banana-pro',
    input: { prompt, image_input: [], aspect_ratio: '1:1', resolution: opts.resolution, output_format: 'png' },
  }));

  return kieBatch('16-GAMI', opts.kieKey, tasks);
}

async function stepGenerateTitleCards(opts, slides) {
  const prompts = [
    ...slides.map(s => buildTitleCardPrompt(s.text)),
    buildTitleCardPrompt('Follow for more Cybersecurity and AI stories'),
  ];

  log('TITLE', `Generating ${prompts.length} title cards...`);

  const tasks = prompts.map(prompt => ({
    model: 'nano-banana-pro',
    input: { prompt, image_input: [], aspect_ratio: opts.aspectRatio, resolution: opts.resolution, output_format: 'png' },
  }));

  return kieBatch('TITLE', opts.kieKey, tasks);
}

function splitSlideForTextOnly(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { title: '', text: '' };
  const m = trimmed.match(/^(.+?[.!?])\s+(.+)$/);
  if (m) return { title: m[1].trim(), text: m[2].trim() };
  return { title: trimmed, text: '' };
}

function buildTerminalSlide(slideText, slideNum) {
  const trimmed = (slideText || '').trim();
  const sentences = trimmed.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const first = sentences[0] || trimmed;
  const rest = sentences.slice(1);
  const stripDot = (s) => s.replace(/\.+$/, '');
  const lines = rest.length > 0
    ? rest.map((s, i) => ({
        kind: i === rest.length - 1 ? 'success' : 'result',
        text: stripDot(s),
      }))
    : [{ kind: 'success', text: stripDot(first) }];
  return {
    title: first,
    text: '',
    terminal: {
      header: TERMINAL_DEFAULT_HEADER,
      subtitle: TERMINAL_DEFAULT_SUBTITLE,
      cwd: TERMINAL_DEFAULT_CWD,
      prompt: `read slide-${slideNum}`,
      lines,
    },
  };
}

async function stepRenderCarousel(opts, slides, artResults) {
  const corners = {
    tag: opts.tagText,
    upper_right: opts.upperRight,
    lower_right: opts.lowerRight,
  };
  const configSlides = [];
  const isTextOnly = opts.format === 'text_only';
  const isTerminal = opts.format === 'terminal';

  for (let i = 0; i < slides.length; i++) {
    if (isTextOnly) {
      const { title, text: body } = splitSlideForTextOnly(slides[i].text);
      configSlides.push({ type: 'body', ...corners, title, text: body });
    } else if (isTerminal) {
      const term = buildTerminalSlide(slides[i].text, i + 1);
      configSlides.push({ type: 'terminal_body', ...corners, ...term });
    } else {
      configSlides.push({
        type: 'image_body',
        ...corners,
        image: artResults[i]?.url ? `art_${i + 1}.png` : null,
        text: slides[i].text,
        text_position: 'bottom',
      });
    }
  }

  // CTA slide — text_only & terminal carousels get a typographic CTA, others use the art closer.
  const ctaIdx = slides.length;
  if (isTextOnly || isTerminal) {
    configSlides.push({
      type: 'body',
      ...corners,
      title: 'Follow for more.',
      text: 'Cybersecurity and AI stories.',
      lower_right: 'save for later',
    });
  } else {
    configSlides.push({
      type: 'cta_follow',
      ...corners,
      image: artResults[ctaIdx]?.url ? `art_${ctaIdx + 1}.png` : null,
      text: 'Follow for more Cybersecurity and Artificial Intelligence stories',
      handle_overlay: opts.handle,
      lower_right: 'save for later',
    });
  }

  const config = {
    title: opts.topic,
    template: opts.template,
    profile: { display_name: 'Breadstick', handle: opts.handle },
    theme: 'dark',
    slides: configSlides,
  };

  const imageUrls = artResults.map(r => r.url).filter(Boolean);

  const name = `pipeline_${Date.now()}`;
  log('CAROUSEL', `Rendering ${configSlides.length} slides...`);

  const data = await post('/api/carousel/render', { name, config, imageUrls });
  if (!data.success) throw new Error(data.error || 'Render failed');

  log('CAROUSEL', `Rendered ${data.slides.length} slides → ${name}/`);
  return { name, slides: data.slides, zones: data.zones || {}, configSlides };
}

// ── Stage 3: animate terminal_body slides via Remotion ──────────────────────
// Loads the template palette, then for each terminal_body slide calls the
// /api/remotion/animate-terminal endpoint to produce a typing-animation mp4.
function loadTemplatePalette(templateId) {
  try {
    const path = `carousels/templates/${templateId}.json`;
    const tpl = JSON.parse(readFileSync(path, 'utf8'));
    const colors = tpl.colors?.dark || tpl.colors?.light || {};
    return {
      bg: colors.bg, text: colors.text, muted: colors.text_muted,
      accent: colors.accent, border: colors.border,
    };
  } catch {
    return { bg: '#0a0a0f', text: '#e8e8e8', muted: '#777799', accent: '#5588ff', border: '#2a2a44' };
  }
}

async function stepAnimateTerminals(opts, configSlides, carouselName, zones) {
  const palette = loadTemplatePalette(opts.template);
  const terminalSlides = configSlides
    .map((cs, i) => ({ cs, idx: i + 1 }))
    .filter(({ cs }) => cs.type === 'terminal_body');

  if (terminalSlides.length === 0) {
    log('ANIMATE', 'No terminal_body slides — skipping');
    return [];
  }

  log('ANIMATE', `Animating ${terminalSlides.length} terminal slides via Remotion...`);
  const results = [];
  for (const { cs, idx } of terminalSlides) {
    const zone = zones[`slide_${idx}`];
    if (!zone) {
      log('ANIMATE', `  slide ${idx}: zones.json missing zone, skipping`);
      results.push({ slideIdx: idx, error: 'no zone' });
      continue;
    }
    try {
      const data = await post('/api/remotion/animate-terminal', {
        slidePath: `slide_${idx}.png`,
        terminalZone: zone,
        terminal: cs.terminal,
        palette,
        name: carouselName,
        slideIdx: idx,
      });
      log('ANIMATE', `  slide ${idx} → ${data.url} (${data.durationSec.toFixed(1)}s)`);
      results.push({ slideIdx: idx, url: data.url, durationSec: data.durationSec });
    } catch (err) {
      log('ANIMATE', `  slide ${idx} FAILED: ${err.message}`);
      results.push({ slideIdx: idx, error: err.message });
    }
  }
  return results;
}

async function stepFrameSandwich(opts, artResults, titleResults) {
  const pairCount = Math.min(
    artResults.filter(r => r.url).length,
    titleResults.filter(r => r.url).length,
  );

  if (pairCount === 0) {
    log('SANDWICH', 'No valid pairs — skipping');
    return [];
  }

  let motionPrompt;
  if (opts.motion === 'random') {
    const keys = Object.keys(MOTIONS);
    motionPrompt = MOTIONS[keys[Math.floor(Math.random() * keys.length)]];
  } else {
    motionPrompt = MOTIONS[opts.motion] || MOTIONS['paper-unfold'];
  }

  log('SANDWICH', `Generating ${pairCount} videos (${opts.motion}, ${opts.duration}s, ${opts.videoMode})...`);

  const tasks = [];
  for (let i = 0; i < pairCount; i++) {
    if (!titleResults[i]?.url || !artResults[i]?.url) continue;
    tasks.push({
      model: 'kling-3.0/video',
      input: {
        prompt: motionPrompt,
        image_urls: [titleResults[i].url, artResults[i].url],
        sound: false,
        duration: opts.duration,
        aspect_ratio: opts.aspectRatio,
        mode: opts.videoMode,
        multi_shots: false,
        multi_prompt: [],
      },
    });
  }

  return kieBatch('SANDWICH', opts.kieKey, tasks);
}


// ── Subcommands: pop-beats + stack ──────────────────────────────────────────
//
// These are simple FFmpeg passes that hit dedicated server endpoints. Both
// require `npm run server` to be running on :3001 (same as the carousel flow).
// Detected by argv[2] before the carousel-specific arg parser kicks in, so
// the existing `--topic` flow continues to work as before.

const SUBCOMMANDS = ['pop-beats', 'stack', 'image', 'broll'];

function parsePopBeatsArgs(args) {
  const opts = { input: null, pops: [], sound: 'subtle', gainDb: 0, output: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i], next = args[i + 1];
    switch (a) {
      case '--input': opts.input = next; i++; break;
      case '--pops':
        opts.pops = String(next || '').split(',').map(s => parseFloat(s.trim())).filter(n => !Number.isNaN(n));
        i++;
        break;
      case '--sound': opts.sound = next; i++; break;
      case '--gain': opts.gainDb = parseFloat(next); i++; break;
      case '--output': opts.output = next; i++; break;
      case '--help': case '-h':
        console.log(`\nPop Beats — inject pop sounds at motion-graphic event timestamps\n\nUsage:\n  node pipeline-cli.js pop-beats --input <video> --pops "2.5,5.8,9.1" [--sound subtle|sharp|soft|<path>] [--gain -6] [--output <path>]\n\nRequires: server running (npm run server)\n`);
        process.exit(0);
    }
  }
  if (!opts.input) { console.error('Error: --input <video> required'); process.exit(1); }
  if (opts.pops.length === 0) { console.error('Error: --pops "T1,T2,..." required (timestamps in seconds)'); process.exit(1); }
  return opts;
}

function parseImageArgs(args) {
  const opts = {
    theme: null,
    provider: 'nano-banana-pro',
    style: '16gami',
    aspect: '1:1',
    resolution: '2K',
    output: null,
    kieKey: process.env.KIE_API_KEY || '',
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i], next = args[i + 1];
    switch (a) {
      case '--theme':      opts.theme = next; i++; break;
      case '--provider':   opts.provider = next; i++; break;
      case '--style':      opts.style = next; i++; break;
      case '--aspect':     opts.aspect = next; i++; break;
      case '--resolution': opts.resolution = next; i++; break;
      case '--output':     opts.output = next; i++; break;
      case '--kie-key':    opts.kieKey = next; i++; break;
      case '--dry-run':    opts.dryRun = true; break;
      case '--help': case '-h':
        console.log(`\nSingle Image — one-shot 16-GAMI / Image-2 generator\n\nUsage:\n  node pipeline-cli.js image --theme "<text>" [--provider nano-banana-pro|image-2] [--style 16gami|raw]\n     [--aspect 1:1|9:16|16:9] [--resolution 1K|2K|4K] [--output <path>] [--kie-key <key>]\n\n  --provider nano-banana-pro  default; runs through /api/gami/generate when style=16gami\n  --provider image-2          OpenAI Image-2 via kie.ai (model: image-2)\n  --style 16gami              auto-wrap theme in 16-GAMI Brand DNA prompt (default)\n  --style raw                 pass theme through verbatim, no wrap\n  --dry-run                   print prompt + model and exit, no API call\n\nRequires: server running (npm run server) AND KIE_API_KEY set\n`);
        process.exit(0);
    }
  }
  if (!opts.theme || !opts.theme.trim()) { console.error('Error: --theme "<text>" required'); process.exit(1); }
  if (!['nano-banana-pro', 'image-2'].includes(opts.provider)) { console.error('Error: --provider must be nano-banana-pro|image-2'); process.exit(1); }
  if (!['16gami', 'raw'].includes(opts.style)) { console.error('Error: --style must be 16gami|raw'); process.exit(1); }
  if (!opts.kieKey) { console.error('Error: KIE_API_KEY env var or --kie-key required'); process.exit(1); }
  return opts;
}

async function pollKieTask(taskId, kieKey, label, maxWaitMs = 300000, intervalMs = 3000) {
  const r = await corePollKieTask({
    server: SERVER, kieKey, taskId, maxWaitMs, intervalMs,
    onTick: ({ elapsed, state }) => log(label, `polling... (${elapsed}s, state=${state})`),
  });
  if (!r.url) throw new Error('Task succeeded but no resultUrls');
  return r.url;
}

async function downloadFile(url, outPath) {
  const { writeFile: wf, mkdir: mk } = await import('fs/promises');
  const { dirname: dn } = await import('path');
  await mk(dn(outPath), { recursive: true });
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  await wf(outPath, buf);
  return buf.length;
}

function slugify(text) {
  return coreSlugify(text, 60, 'image');
}

async function runImage() {
  const opts = parseImageArgs(process.argv.slice(3));
  console.log(`\n=== SINGLE IMAGE ===\nTheme:      ${opts.theme}\nProvider:   ${opts.provider}\nStyle:      ${opts.style}\nAspect:     ${opts.aspect}\nResolution: ${opts.resolution}\n`);

  if (opts.dryRun) {
    const promptText = opts.style === '16gami' ? buildGamiPrompt(opts.theme) : opts.theme;
    log('DRY', `Would submit 1 ${opts.provider} task (${opts.resolution}, ${opts.aspect})`);
    log('DRY', `Prompt: ${promptText.slice(0, 200)}${promptText.length > 200 ? '...' : ''}`);
    log('DRY', 'No API calls made. Remove --dry-run to execute.');
    process.exit(0);
  }

  // Submit task
  log('IMAGE', `Submitting to ${opts.provider}...`);
  let taskId;
  try {
    if (opts.provider === 'nano-banana-pro' && opts.style === '16gami') {
      // Use the dedicated /api/gami/generate which auto-wraps via buildGamiPrompt.
      const data = await post('/api/gami/generate', {
        apiKey: opts.kieKey,
        prompt: opts.theme,
        aspectRatio: opts.aspect,
        resolution: opts.resolution,
      });
      taskId = data.taskId;
    } else {
      // Generic kie.ai path (image-2 OR nano-banana-pro raw).
      const promptText = opts.style === '16gami' ? buildGamiPrompt(opts.theme) : opts.theme;
      const model = opts.provider === 'image-2' ? 'image-2' : 'nano-banana-pro';
      const data = await post('/api/kie/create', {
        apiKey: opts.kieKey,
        model,
        input: {
          prompt: promptText,
          image_input: [],
          aspect_ratio: opts.aspect,
          resolution: opts.resolution,
          output_format: 'png',
        },
      });
      taskId = data?.data?.taskId;
      if (!taskId) throw new Error('No taskId returned from kie.ai');
    }
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }
  log('IMAGE', `Task ${taskId} submitted, polling...`);

  // Poll
  let imageUrl;
  try {
    imageUrl = await pollKieTask(taskId, opts.kieKey, 'IMAGE');
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }
  log('IMAGE', `Done → ${imageUrl}`);

  // Download
  const ts = Date.now();
  const slug = slugify(opts.theme);
  const outPath = opts.output || `output/images/${slug}_${ts}.png`;
  let bytes;
  try {
    bytes = await downloadFile(imageUrl, outPath);
  } catch (err) {
    console.error(`\nDownload failed: ${err.message}`);
    console.log(`Image URL still available: ${imageUrl}`);
    process.exit(1);
  }

  console.log(`\n=== IMAGE READY ===`);
  console.log(`URL:        ${imageUrl}`);
  console.log(`Local:      ${outPath} (${(bytes / 1024).toFixed(1)} KB)`);
  console.log(`IMAGE_PATH:${outPath}`);
  console.log(`IMAGE_URL:${imageUrl}`);
  console.log();
  process.exit(0);
}

function parseStackArgs(args) {
  const opts = {
    top: null, bottom: null,
    orientation: 'vertical',
    width: 1080, height: 1920,
    audio: 'top', sync: 'shortest',
    fit: 'contain',
    padColor: 'black',
    output: null,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i], next = args[i + 1];
    switch (a) {
      case '--top': opts.top = next; i++; break;
      case '--bottom': opts.bottom = next; i++; break;
      case '--orientation': opts.orientation = next; i++; break;
      case '--width': opts.width = parseInt(next, 10); i++; break;
      case '--height': opts.height = parseInt(next, 10); i++; break;
      case '--audio': opts.audio = next; i++; break;
      case '--sync': opts.sync = next; i++; break;
      case '--fit': opts.fit = next; i++; break;
      case '--pad-color': opts.padColor = next; i++; break;
      case '--output': opts.output = next; i++; break;
      case '--help': case '-h':
        console.log(`\nStack Video — vstack/hstack composer for split-frame edits\n\nUsage:\n  node pipeline-cli.js stack --top <video> --bottom <video> [--orientation vertical|horizontal]\n     [--width 1080] [--height 1920] [--audio top|bottom|mix|none] [--sync shortest|loop-shorter|hold-last]\n     [--fit contain|cover] [--pad-color black] [--output <path>]\n\n  --fit contain  letterbox source to preserve full content (default)\n  --fit cover    crop source to fill panel — no bars, content at edges may be lost\n\nRequires: server running (npm run server)\n`);
        process.exit(0);
    }
  }
  if (!opts.top || !opts.bottom) { console.error('Error: --top <video> and --bottom <video> both required'); process.exit(1); }
  if (!['vertical', 'horizontal'].includes(opts.orientation)) { console.error('Error: --orientation must be vertical|horizontal'); process.exit(1); }
  if (!['contain', 'cover'].includes(opts.fit)) { console.error('Error: --fit must be contain|cover'); process.exit(1); }
  return opts;
}

async function runPopBeats() {
  const opts = parsePopBeatsArgs(process.argv.slice(3));
  console.log(`\n=== POP BEATS ===\nInput:  ${opts.input}\nPops:   ${opts.pops.join(', ')}s\nSound:  ${opts.sound}\nGain:   ${opts.gainDb}dB\n`);

  const res = await fetch(`${SERVER}/api/pop-beats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoUrl: opts.input,
      pops: opts.pops,
      sound: opts.sound,
      gainDb: opts.gainDb,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    console.error(`\nError: ${data.error || 'pop-beats failed'}`);
    process.exit(1);
  }
  console.log(`Done.\nOutput: ${SERVER}${data.url}\n`);
  process.exit(0);
}

async function runStackVideo() {
  const opts = parseStackArgs(process.argv.slice(3));
  console.log(`\n=== STACK VIDEO ===\nTop:    ${opts.top}\nBottom: ${opts.bottom}\nLayout: ${opts.orientation} ${opts.width}x${opts.height}\nFit:    ${opts.fit}\nAudio:  ${opts.audio}\nSync:   ${opts.sync}\n`);

  const res = await fetch(`${SERVER}/api/stack-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topUrl: opts.top,
      bottomUrl: opts.bottom,
      orientation: opts.orientation,
      width: opts.width,
      height: opts.height,
      audioMode: opts.audio,
      syncMode: opts.sync,
      fit: opts.fit,
      padColor: opts.padColor,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    console.error(`\nError: ${data.error || 'stack-video failed'}`);
    process.exit(1);
  }
  console.log(`Done.\nOutput: ${SERVER}${data.url}\n`);
  process.exit(0);
}


// ── Subcommand: broll v2 ────────────────────────────────────────────────────
//
// `broll <topic>` from Slack: structured beats script + per-beat TWO 16-gami
// pictures (start + end anchors, narrative arc) + per-beat Kling 3.0
// animation with start+end frame sandwich + 9-field opinionated prompt
// template. Lands in a timestamped local folder.
//
// Pivot history (2026-05-23): originally designed against Higgsfield CLI for
// the start+end frame feature, but the local Higgsfield CLI on this Windows
// install can't PUT to its own CloudFront upload URLs (TLS/network issue).
// kie.ai's kling-3.0/video model natively supports `image_urls: [start, end]`
// as frame-sandwich (already used by carousel-pipeline), so we route v2's
// Kling calls through kie.ai instead — same model, same start+end benefit,
// zero Higgsfield dependency.
//
// Spec: docs/superpowers/specs/2026-05-23-broll-v2-design.md
// v1 (kie.ai single-image, deprecated): 2026-05-23-broll-pipeline-design.md

function parseBrollArgs(args) {
  const opts = {
    topic: null,
    beats: 5,
    aspect: '16:9',
    resolution: '2K',
    outDir: 'pipeline/broll',
    anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    kieKey: process.env.KIE_API_KEY || '',
    model: 'claude-sonnet-4-6',
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i], next = args[i + 1];
    switch (a) {
      case '--topic':         opts.topic = next; i++; break;
      case '--beats':         opts.beats = parseInt(next, 10); i++; break;
      case '--aspect':        opts.aspect = next; i++; break;
      case '--resolution':    opts.resolution = next; i++; break;
      case '--out-dir':       opts.outDir = next; i++; break;
      case '--anthropic-key': opts.anthropicKey = next; i++; break;
      case '--kie-key':       opts.kieKey = next; i++; break;
      case '--model':         opts.model = next; i++; break;
      case '--dry-run':       opts.dryRun = true; break;
      case '--resume':        opts.resume = next; i++; break;
      case '--help': case '-h':
        console.log(`\nBroll v2 — kie.ai Kling 3.0 + start+end frame + 9-field template\n\nUsage:\n  node pipeline-cli.js broll --topic "<topic>" [--beats 5]\n     [--aspect 16:9] [--resolution 2K] [--out-dir pipeline/broll]\n\n  --beats N        Number of beats (3-7). Default 5.\n  --aspect <r>     1:1 | 9:16 | 16:9. Default 16:9.\n  --resolution <r> 1K | 2K | 4K. Default 2K.\n  --dry-run        Print the billing plan and exit, no API calls.\n  --resume <file>  Resume a kie checkpoint ledger (no re-billing).\n\nRequires: server running (npm run server), ANTHROPIC_API_KEY, KIE_API_KEY.\nOutput: <out-dir>/<ISO-timestamp>_<topic-slug>/ with script.md, manifest.json,\nbeat_N_art_start.png, beat_N_art_end.png, beat_N.mp4.\n`);
        process.exit(0);
    }
  }
  if (!opts.topic || !opts.topic.trim()) { console.error('Error: --topic "<text>" required'); process.exit(1); }
  if (!Number.isInteger(opts.beats) || opts.beats < 3 || opts.beats > 7) {
    console.error(`Error: --beats must be an integer 3..7 (got ${opts.beats})`); process.exit(1);
  }
  if (!opts.anthropicKey) { console.error('Error: ANTHROPIC_API_KEY env var or --anthropic-key required'); process.exit(1); }
  if (!opts.kieKey) { console.error('Error: KIE_API_KEY env var or --kie-key required'); process.exit(1); }
  return opts;
}

function buildBrollSystemPrompt(beatCount) {
  return `You are a visual storytelling scriptwriter for short-form video b-rolls.

For each beat, you produce a spoken line PLUS TWO concrete visual anchors:
- start_anchor: the opening composition (a paper-craft scene at the beat's start)
- end_anchor: the closing composition (a related-but-distinct scene at the beat's end)

The end_anchor must form a narrative-arc relation to the start_anchor: a transformation, consequence, or next-state. Both anchors must be CONCRETE noun phrases that a paper-craft artist could sculpt.

Rules:
- Exactly ${beatCount} beats. No more, no less.
- Each text is a complete sentence, conversational, 10-18 words. Suitable to be read aloud.
- start_anchor and end_anchor are each 2-5 word concrete noun phrases. Sculptable in paper.
- end_anchor is a narrative arc from start_anchor, NOT just a different view of the same subject.
  Good arc pairs:
    "rusty paper key" -> "shiny new key in lock"
    "paper padlock closed" -> "paper padlock split open"
    "stacked paper coins" -> "scattered paper coins"
  Bad arc pairs:
    "paper key wide" -> "paper key close" (same subject, no arc)
    "trust" -> "betrayal" (abstract, not sculptable)
- Beats flow as a sequence: each builds on the previous.
- NEVER use em dashes or en dashes. Use commas, periods, or hyphens (-).

OUTPUT FORMAT: strict JSON array, nothing else, no prose before or after:
[
  {"beat": 1, "text": "...", "start_anchor": "...", "end_anchor": "..."},
  {"beat": 2, "text": "...", "start_anchor": "...", "end_anchor": "..."}
]`;
}

function buildBrollKling3Prompt(startAnchor, endAnchor) {
  return `Subject: paper-craft transformation from ${startAnchor} to ${endAnchor}
SubjectDescription: hand-folded cardstock origami sculpture. The scene begins as ${startAnchor} and physically reshapes into ${endAnchor} through visible paper-craft mechanics. Warm cream and gold cardstock with stair-stepped pixelated edges, hyper-realistic paper fiber texture, layered paper depth, every fold and crease deliberate
Movement: stop-motion paper-craft animation. The starting paper composition slowly UNFOLDS, layers SEPARATE, creased panels FLIP open along visible fold lines, cardstock peels apart and refolds outward to reveal the end composition. All motion governed by real paper physics: discrete crease hinges, panels swinging on visible folds, layers stacking and unstacking with the weight of actual cardstock. The camera is locked off, the paper does all the moving
Scene: a minimal paper-craft studio still life
SceneDescription: smooth oak wooden surface, neutral paper-toned backdrop, soft directional lighting catching paper fibers and fold creases, hints of layered cardstock depth in the background
Camera: medium close-up, locked off (no camera movement), 50mm lens, shallow depth of field
Lighting: soft directional studio light from upper-left, warm 3200K color temperature, gentle drop shadows that move WITH the paper as it folds and unfolds, no flickers
Atmosphere: stop-motion paper-craft magic, the feel of holding a folded paper sculpture and watching it bloom open in your hands, macro paper-craft photography aesthetic, tactile and physical
Negative: smooth morph, liquid transformation, melting, dissolving, AI warping, CGI feel, fade transition, ball of paper, chaos, distorted forms, warped geometry, flickering, extra limbs, distorted faces, low resolution, blurry, watermark, text overlay, cartoonish, plastic skin`;
}

function extractJsonArray(text) {
  const m = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!m) throw new Error('No JSON array found in response');
  return JSON.parse(m[0]);
}

async function stepGenerateBrollScript(opts) {
  log('SCRIPT', `Generating ${opts.beats}-beat broll script for "${opts.topic}" (narrative-arc anchors)...`);
  const systemPrompt = buildBrollSystemPrompt(opts.beats);
  const callOnce = async (extraPrefix = '') => {
    const { text } = await callAnthropic({
      server: SERVER,
      apiKey: opts.anthropicKey,
      model: opts.model,
      system: extraPrefix + systemPrompt,
      messages: [{ role: 'user', content: `Topic: ${opts.topic}` }],
    });
    if (!text) throw new Error('Empty script returned');
    return extractJsonArray(text);
  };

  let beats;
  try {
    beats = await callOnce();
  } catch (err) {
    log('SCRIPT', `First parse failed (${err.message}). Retrying with stricter prompt...`);
    beats = await callOnce('RETURN JSON ONLY. NO PROSE BEFORE OR AFTER THE ARRAY.\n\n');
  }
  if (!Array.isArray(beats) || beats.length === 0) throw new Error('Script returned empty array');
  if (beats.length < opts.beats) {
    throw new Error(`Script returned ${beats.length} beats, expected ${opts.beats}`);
  }
  beats = beats.slice(0, opts.beats).map((b, i) => ({
    beat: i + 1,
    text: String(b.text || '').trim(),
    start_anchor: String(b.start_anchor || '').trim(),
    end_anchor: String(b.end_anchor || '').trim(),
  }));
  for (const b of beats) {
    if (!b.text) throw new Error(`Beat ${b.beat} missing text`);
    if (!b.start_anchor) throw new Error(`Beat ${b.beat} missing start_anchor`);
    if (!b.end_anchor) throw new Error(`Beat ${b.beat} missing end_anchor`);
  }
  log('SCRIPT', `Got ${beats.length} beats with start+end anchors`);
  return beats;
}

async function stepGenerateBrollArt(opts, beats) {
  // Build 2N tasks interleaved: [b1_start, b1_end, b2_start, b2_end, ...]
  const tasks = [];
  for (const b of beats) {
    tasks.push({
      model: 'nano-banana-pro',
      input: {
        prompt: buildGamiPrompt(b.start_anchor),
        image_input: [],
        aspect_ratio: opts.aspect,
        resolution: opts.resolution,
        output_format: 'png',
      },
    });
    tasks.push({
      model: 'nano-banana-pro',
      input: {
        prompt: buildGamiPrompt(b.end_anchor),
        image_input: [],
        aspect_ratio: opts.aspect,
        resolution: opts.resolution,
        output_format: 'png',
      },
    });
  }
  log('16-GAMI', `Generating ${tasks.length} images (${beats.length} beats × 2 anchors)...`);
  const results = await kieBatch('16-GAMI', opts.kieKey, tasks);
  // Re-shape to per-beat {start, end}
  return beats.map((_, i) => ({
    start: results[i * 2],
    end: results[i * 2 + 1],
  }));
}

async function stepGenerateBrollVideos(opts, beats, artResults) {
  // Per beat with both art images succeeded: fire kie.ai kling-3.0/video with
  // image_urls=[start, end] (frame sandwich — same pattern carousel-pipeline
  // uses for title+art). Kling treats first as start frame, second as end frame.
  // Per-beat 9-field prompt template via buildBrollKling3Prompt.
  const tasks = [];
  const beatIdxByTask = [];
  for (let i = 0; i < beats.length; i++) {
    const start = artResults[i]?.start;
    const end = artResults[i]?.end;
    if (!start?.url || !end?.url) continue;
    const prompt = buildBrollKling3Prompt(beats[i].start_anchor, beats[i].end_anchor);
    tasks.push({
      model: 'kling-3.0/video',
      input: {
        prompt,
        image_urls: [start.url, end.url],
        sound: false,
        duration: 5,
        aspect_ratio: opts.aspect,
        mode: 'std',
        multi_shots: false,
        multi_prompt: [],
      },
    });
    beatIdxByTask.push(i);
  }
  if (tasks.length === 0) {
    log('KLING', 'No art succeeded — skipping video generation');
    return beats.map(() => ({ url: '', error: 'no art' }));
  }
  log('KLING', `Submitting ${tasks.length} Kling 3.0 jobs (kie.ai, start+end frame, 9-field prompt)...`);
  const submitted = await kieBatch('KLING', opts.kieKey, tasks);
  const perBeat = beats.map(() => ({ url: '', error: 'no art' }));
  for (let t = 0; t < submitted.length; t++) {
    perBeat[beatIdxByTask[t]] = submitted[t];
  }
  return perBeat;
}

async function runBroll() {
  const opts = parseBrollArgs(process.argv.slice(3));
  const startTime = Date.now();

  console.log(`\n=== BROLL v2 ===\nTopic:      ${opts.topic}\nBeats:      ${opts.beats}\nAspect:     ${opts.aspect}\nResolution: ${opts.resolution}\nEngine:     kie.ai Kling 3.0 (start+end frame, 9-field prompt)\n`);

  if (opts.dryRun) {
    log('DRY', `Anthropic ${opts.model}: 1 script call (${opts.beats} beats, start+end anchors)`);
    log('DRY', `kie.ai nano-banana-pro: ${opts.beats * 2} anchor images (${opts.resolution}, ${opts.aspect})`);
    log('DRY', `kie.ai kling-3.0/video: up to ${opts.beats} clips (5s, std)`);
    log('DRY', 'No API calls made. Remove --dry-run to execute.');
    return;
  }

  try { await fetch(`${SERVER}/api/kie/status/test`); }
  catch { console.error(`\nError: Server not reachable at ${SERVER}\nStart it with: npm run server\n`); process.exit(1); }

  initKieRun(opts, 'broll');

  // 1. Script
  let beats;
  try { beats = await stepGenerateBrollScript(opts); }
  catch (err) { console.error(`\nScript failed: ${err.message}`); process.exit(1); }

  // 2. Folder
  const { writeFile, mkdir } = await import('fs/promises');
  const { resolve: rs, join: jn } = await import('path');
  const tsIso = timestamp();
  const slug = slugify(opts.topic);
  const folder = rs(opts.outDir, `${tsIso}_${slug}`);
  await mkdir(folder, { recursive: true });
  log('OUTPUT', `Writing to ${folder}`);

  // 3. Art (2N parallel kie.ai images)
  const artResults = await stepGenerateBrollArt(opts, beats);

  // 4. Videos (kie.ai kling-3.0/video with image_urls=[start, end])
  const videoResults = await stepGenerateBrollVideos(opts, beats, artResults);

  // 5. Download all deliverables + build manifest + script.md
  const beatsData = [];
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    const startUrl = artResults[i]?.start?.url || '';
    const endUrl = artResults[i]?.end?.url || '';
    const videoUrl = videoResults[i]?.url || '';
    const startPath = `beat_${b.beat}_art_start.png`;
    const endPath = `beat_${b.beat}_art_end.png`;
    const videoPath = `beat_${b.beat}.mp4`;

    let startStatus = artResults[i]?.start?.error
      ? `failed:${artResults[i].start.error}`
      : (startUrl ? 'ok' : 'failed:no url');
    let endStatus = artResults[i]?.end?.error
      ? `failed:${artResults[i].end.error}`
      : (endUrl ? 'ok' : 'failed:no url');
    let videoStatus = videoResults[i]?.error
      ? `failed:${videoResults[i].error}`
      : (videoUrl ? 'ok' : 'failed:no url');

    if (startUrl) {
      try { await downloadFile(startUrl, jn(folder, startPath)); }
      catch (err) { startStatus = `failed:start download ${err.message}`; }
    }
    if (endUrl) {
      try { await downloadFile(endUrl, jn(folder, endPath)); }
      catch (err) { endStatus = `failed:end download ${err.message}`; }
    }
    if (videoUrl) {
      try { await downloadFile(videoUrl, jn(folder, videoPath)); }
      catch (err) { videoStatus = `failed:video download ${err.message}`; }
    }

    beatsData.push({
      beat: b.beat,
      text: b.text,
      start_anchor: b.start_anchor,
      end_anchor: b.end_anchor,
      start_art_path: startStatus === 'ok' ? startPath : null,
      end_art_path: endStatus === 'ok' ? endPath : null,
      video_path: videoStatus === 'ok' ? videoPath : null,
      start_art_url: startUrl || null,
      end_art_url: endUrl || null,
      video_url: videoUrl || null,
      start_art_status: startStatus,
      end_art_status: endStatus,
      video_status: videoStatus,
    });
  }

  const startOk = beatsData.filter(b => b.start_art_status === 'ok').length;
  const endOk = beatsData.filter(b => b.end_art_status === 'ok').length;
  const videoOk = beatsData.filter(b => b.video_status === 'ok').length;
  const failedBeats = beatsData
    .filter(b => b.start_art_status !== 'ok' || b.end_art_status !== 'ok' || b.video_status !== 'ok')
    .map(b => ({ beat: b.beat, start: b.start_art_status, end: b.end_art_status, video: b.video_status }));

  const manifest = {
    topic: opts.topic,
    topic_slug: slug,
    version: 'v2',
    engine: 'kie.ai-kling-3.0',
    beats: opts.beats,
    generated_at: new Date().toISOString(),
    model: opts.model,
    aspect_ratio: opts.aspect,
    resolution: opts.resolution,
    beats_data: beatsData,
    summary: { total: beats.length, start_art_ok: startOk, end_art_ok: endOk, video_ok: videoOk, failed_beats: failedBeats },
  };
  await writeFile(jn(folder, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const mdLines = [`# ${opts.topic}`, '', `Engine: kie.ai Kling 3.0 (start+end frame, 9-field prompt)`, `Generated: ${manifest.generated_at}`, ''];
  for (const b of beatsData) {
    mdLines.push(`## Beat ${b.beat}`, '');
    mdLines.push(`**Spoken:** ${b.text}`, '');
    mdLines.push(`**Start:** ${b.start_anchor}`, '');
    mdLines.push(`**End:** ${b.end_anchor}`, '');
    mdLines.push(`**Files:** ${b.start_art_path || '(start failed)'} | ${b.end_art_path || '(end failed)'} | ${b.video_path || '(video failed)'}`, '');
  }
  await writeFile(jn(folder, 'script.md'), mdLines.join('\n'));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== BROLL v2 READY ===`);
  console.log(`Folder:    ${folder}`);
  console.log(`Beats:     ${beats.length} (start ${startOk}/${beats.length}, end ${endOk}/${beats.length}, video ${videoOk}/${beats.length})`);
  console.log(`Elapsed:   ${elapsed}s`);
  if (failedBeats.length > 0) {
    console.log(`Failures:  ${failedBeats.map(f => `beat ${f.beat}`).join(', ')}`);
  }
  console.log(`BROLL_PATH:${folder}`);
  console.log();
  process.exit(0);
}


// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Subcommand dispatch — must run before parseArgs() since the carousel flow
  // demands --topic which subcommands don't provide.
  const subcommand = process.argv[2];
  if (subcommand === 'pop-beats') return runPopBeats();
  if (subcommand === 'stack') return runStackVideo();
  if (subcommand === 'image') return runImage();
  if (subcommand === 'broll') return runBroll();

  const opts = parseArgs();
  const startTime = Date.now();

  console.log('\n=== BREADSTICK PIPELINE CLI ===\n');
  log('INIT', `Topic: "${opts.topic}"`);
  log('INIT', `Config: ${opts.tone} / ${opts.length} / ${opts.template} / ${opts.format}${opts.research ? ' / research' : ''} / ${opts.motion} / ${opts.duration}s`);
  log('INIT', `Handle: ${opts.handle}`);

  // Dry run: print the billing plan and exit before any paid call.
  if (opts.dryRun) {
    const len = LENGTHS[opts.length];
    const maxSlides = parseInt(String(len.slides).split('-').pop(), 10) || 1;
    const skipsArt = opts.format === 'text_only' || opts.format === 'terminal';
    log('DRY', `Anthropic ${opts.model}: 1 script call (${len.slides} slides, ${len.words} words${opts.research ? ', web_search' : ''})`);
    if (skipsArt) {
      log('DRY', `kie.ai: 0 tasks (${opts.format} format skips art + titles + video)`);
    } else {
      log('DRY', `kie.ai nano-banana-pro: up to ${maxSlides + 1} art + ${maxSlides + 1} title cards (${opts.resolution})`);
      log('DRY', opts.skipVideo
        ? 'kie.ai kling-3.0/video: 0 (--skip-video)'
        : `kie.ai kling-3.0/video: up to ${maxSlides + 1} clips (${opts.duration}s, ${opts.videoMode})`);
    }
    log('DRY', 'No API calls made. Remove --dry-run to execute.');
    return;
  }

  // Check server is running
  try {
    await fetch(`${SERVER}/api/kie/status/test`);
  } catch {
    console.error(`\nError: Server not reachable at ${SERVER}`);
    console.error('Start it with: npm run server\n');
    process.exit(1);
  }

  initKieRun(opts, 'carousel');

  // Step 1: Generate script
  const { script, slides } = await stepGenerateScript(opts);
  console.log('\n--- SCRIPT ---');
  console.log(script);
  console.log('---\n');

  // Step 2 & 3: Art + Title Cards (parallel — both only need the script)
  // text_only & terminal carousels skip both — no images needed at all, faster + free.
  let artResults = [];
  let titleResults = [];
  const skipsArt = opts.format === 'text_only' || opts.format === 'terminal';
  if (skipsArt) {
    log('BATCH', `Skipping 16-GAMI art + title cards (${opts.format} format)`);
  } else {
    log('BATCH', 'Starting 16-GAMI art + title cards in parallel...');
    [artResults, titleResults] = await Promise.all([
      stepGenerateArt(opts, slides),
      stepGenerateTitleCards(opts, slides),
    ]);
  }

  // Step 4: Render carousel (needs art images for image_body format)
  const carousel = await stepRenderCarousel(opts, slides, artResults);

  // Step 4b: Optional terminal typing animations (only when --animate + --format terminal)
  let terminalAnimations = [];
  if (opts.animate && opts.format === 'terminal') {
    terminalAnimations = await stepAnimateTerminals(opts, carousel.configSlides, carousel.name, carousel.zones);
  } else if (opts.animate) {
    log('ANIMATE', `Ignored (--animate only applies to --format terminal, you chose ${opts.format})`);
  }

  // Step 5: Frame sandwich videos (needs title cards + art)
  let videoResults = [];
  if (!opts.skipVideo) {
    videoResults = await stepFrameSandwich(opts, artResults, titleResults);
  } else {
    log('SANDWICH', 'Skipped (--skip-video)');
  }

  // ── Summary ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const artOk = artResults.filter(r => r.url).length;
  const titleOk = titleResults.filter(r => r.url).length;
  const vidOk = videoResults.filter(r => r?.url).length;

  console.log('\n=== PIPELINE COMPLETE ===\n');
  console.log(`  Topic:       ${opts.topic}`);
  console.log(`  Slides:      ${slides.length} content + 1 CTA`);
  console.log(`  16-GAMI:     ${artOk}/${artResults.length} images`);
  console.log(`  Title Cards: ${titleOk}/${titleResults.length} cards`);
  console.log(`  Carousel:    ${carousel.slides.length} rendered → carousels/workspace/${carousel.name}/`);
  if (terminalAnimations.length > 0) {
    const animOk = terminalAnimations.filter(r => r.url).length;
    console.log(`  Terminal anim: ${animOk}/${terminalAnimations.length} mp4s → renders/${carousel.name}/`);
  }
  if (!opts.skipVideo) {
    console.log(`  Videos:      ${vidOk}/${videoResults.length} clips`);
  }
  console.log(`  Time:        ${elapsed}s`);
  console.log();

  // Output manifest
  const manifest = {
    topic: opts.topic,
    config: { tone: opts.tone, length: opts.length, handle: opts.handle, motion: opts.motion },
    script,
    slides: slides.map((s, i) => ({
      num: s.num,
      text: s.text,
      artUrl: artResults[i]?.url || null,
      titleCardUrl: titleResults[i]?.url || null,
      carouselSlide: carousel.slides[i] || null,
      videoUrl: videoResults[i]?.url || null,
    })),
    cta: {
      artUrl: artResults[slides.length]?.url || null,
      titleCardUrl: titleResults[slides.length]?.url || null,
      carouselSlide: carousel.slides[slides.length] || null,
      videoUrl: videoResults[slides.length]?.url || null,
    },
    elapsed: parseFloat(elapsed),
    timestamp: new Date().toISOString(),
  };

  const manifestPath = `pipeline_${carousel.name}.json`;
  const { writeFile } = await import('fs/promises');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  log('OUTPUT', `Manifest saved → ${manifestPath}`);
}

main().catch(err => {
  console.error(`\nPipeline failed: ${err.message}`);
  if (kieRunCtx.checkpoint) {
    console.error(`Submitted kie tasks are checkpointed — resume without re-billing:`);
    console.error(`  node pipeline-cli.js ${process.argv.slice(2).join(' ')} --resume "${kieRunCtx.checkpoint.file}"`);
  }
  process.exit(1);
});

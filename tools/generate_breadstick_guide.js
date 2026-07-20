/**
 * Generate "Breadstick — Operator Guide" as a .docx for your community.
 *
 * Usage:
 *   node tools/generate_breadstick_guide.js [outputPath]
 *
 * Default output: <repo>/tools/breadstick_operator_guide.docx
 */

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  TabStopType, TabStopPosition, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, ExternalHyperlink,
} from 'docx';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = process.argv[2] || join(__dirname, 'breadstick_operator_guide.docx');

// ── Styling helpers ────────────────────────────────────────────────────────

const GOLD = 'C9A227';
const DARK = '1a1a1a';
const MUTED = '555555';
const ACCENT_BG = 'F5EFD9';
const CODE_BG = 'F2F2F2';
const BORDER_GRAY = 'CCCCCC';

const border = { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY };
const cellBorders = { top: border, bottom: border, left: border, right: border };

function H1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true })],
  });
}
function H2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true })],
  });
}
function H3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, bold: true })],
  });
}
function P(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 120 },
  });
}
function Lead(text) {
  return new Paragraph({
    children: [new TextRun({ text, italics: true, color: MUTED })],
    spacing: { after: 240 },
  });
}
function Bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun({ text })],
  });
}
function Step(n, text) {
  return new Paragraph({
    numbering: { reference: 'steps', level: 0 },
    children: [new TextRun({ text })],
  });
}
function Code(text) {
  // Shaded paragraph, monospace
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: CODE_BG },
    spacing: { before: 80, after: 160 },
    children: [new TextRun({ text, font: 'Consolas', size: 20 })],
  });
}
function Callout(title, body) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: cellBorders,
            width: { size: 9360, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: ACCENT_BG },
            margins: { top: 160, bottom: 160, left: 200, right: 200 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: title.toUpperCase(), bold: true, color: GOLD, size: 20 })],
                spacing: { after: 80 },
              }),
              new Paragraph({
                children: [new TextRun({ text: body, size: 22 })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}
function Divider() {
  return new Paragraph({
    children: [],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 1 } },
    spacing: { before: 240, after: 240 },
  });
}
function Spacer() {
  return new Paragraph({ children: [new TextRun('')], spacing: { after: 120 } });
}

function SimpleTable(headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      borders: cellBorders,
      width: { size: widths[i], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: ACCENT_BG },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
    })),
  });
  const bodyRows = rows.map(row => new TableRow({
    children: row.map((cell, i) => new TableCell({
      borders: cellBorders,
      width: { size: widths[i], type: WidthType.DXA },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: cell })] })],
    })),
  }));
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: [headerRow, ...bodyRows],
  });
}

// ── Content ────────────────────────────────────────────────────────────────

const content = [];

// Cover
content.push(
  new Paragraph({
    children: [new TextRun({ text: 'BREADSTICK', bold: true, size: 64, color: GOLD })],
    alignment: AlignmentType.LEFT,
    spacing: { before: 2400, after: 120 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'Operator Guide', size: 48, color: DARK })],
    alignment: AlignmentType.LEFT,
    spacing: { after: 120 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'From Classic Dashboard to Canvas, end-to-end.', italics: true, size: 26, color: MUTED })],
    spacing: { after: 480 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'Author: Breadstick', size: 22 })],
  }),
  new Paragraph({
    children: [new TextRun({ text: 'Version: 2026.04.20 · For the Skool community', size: 22, color: MUTED })],
    spacing: { after: 480 },
  }),
  new Paragraph({ children: [new PageBreak()] }),
);

// TOC
content.push(
  H1('Table of Contents'),
  ...[
    '1. What Breadstick Is',
    '2. First-Time Setup',
    '3. Classic Dashboard',
    '4. Canvas View',
    '5. The Four Content Pipelines',
    '6. Pipeline CLI (Headless Mode)',
    '7. Shortform CLI (Quick Take)',
    '8. 16-GAMI Portal (Mobile / On-the-Go)',
    '9. Carousel Rendering',
    '10. Remotion Studio',
    '11. Infrastructure & Skills',
    '12. Troubleshooting',
    '13. File Reference',
  ].map(t => new Paragraph({ children: [new TextRun({ text: t })], spacing: { after: 60 } })),
  new Paragraph({ children: [new PageBreak()] }),
);

// ───────────────────────────────────────────────────────────────────────────
// Part 1 — What Breadstick Is
// ───────────────────────────────────────────────────────────────────────────
content.push(
  H1('1. What Breadstick Is'),
  Lead('An agent-native workflow engine for AI video, carousels, and shortform content. Canvas is the IDE. Pipelines are deployable artifacts.'),

  P('Breadstick has two faces of the same machine:'),
  Bullet('Classic Dashboard — a linear form: pick a character, pick ingredients, generate a production-ready script and prompt bundle.'),
  Bullet('Canvas View — a node-based pipeline editor: wire ingredients, script generators, image/video models, and post-processing into a visual graph.'),
  P('Every pipeline you build in the Canvas runs against the same Express server endpoints that the Dashboard and the CLIs use. That means any pipeline you validate by clicking can be run headlessly via `pipeline-cli.js` or triggered by an agent over HTTP. Sandbox equals production.'),
  Spacer(),

  H2('The four pipelines at a glance'),
  SimpleTable(
    ['Pipeline', 'Purpose', 'Key Nodes'],
    [
      ['UGC Lane', 'AI-influencer talking-head videos (Kling 3.0 lip-sync).', 'Character → Ingredients → Script Gen UGC → Clip Splitter → Avatar Frames + UGC Video'],
      ['Carousel Video Lane', 'Title-card + video-in-slide Instagram carousels.', 'Niche Script Gen → Title Card + 16-GAMI Art → Frame Sandwich → Carousel + Remotion Compositor'],
      ['16-GAMI Lane', 'Pure image carousels in Skyframe\'s signature paper-origami look.', 'Niche Script Gen → 16-GAMI Art → Carousel'],
      ['Video Lane', 'Single-image-to-video Reels (Kling 2.6).', 'Niche Script Gen → 16-GAMI Art → Video Prompt → KIE Img2Vid'],
    ],
    [2000, 3200, 4160],
  ),
  Spacer(),

  Callout('What makes it different',
    'Competitors put an agent INSIDE a workflow node. Breadstick puts the agent OUTSIDE the canvas — the canvas is the agent\'s workbench, not its cage. Any node you build works identically whether triggered by a mouse click or a CLI flag.'),
  new Paragraph({ children: [new PageBreak()] }),
);

// ───────────────────────────────────────────────────────────────────────────
// Part 2 — First-Time Setup
// ───────────────────────────────────────────────────────────────────────────
content.push(
  H1('2. First-Time Setup'),
  Lead('Install once, then both servers run in parallel forever.'),

  H2('Prerequisites'),
  Bullet('Node.js 18 or newer'),
  Bullet('Python 3.11+ (for the carousel renderer and overlay tools)'),
  Bullet('FFmpeg on your PATH (for color grading, compositing, chromakey)'),
  Bullet('ImageMagick optional (only if you render 16-bit art locally)'),
  Spacer(),

  H2('API keys you will need'),
  SimpleTable(
    ['Service', 'Used For', 'Where to Set'],
    [
      ['Anthropic', 'Script generation (Claude).', '.env as ANTHROPIC_API_KEY or paste in UI'],
      ['kie.ai', 'Nano Banana Pro images + Kling video.', '.env as KIE_API_KEY or paste in UI'],
      ['Blotato', 'Auto-posting to social platforms.', '.env as BLOTATO_API_KEY or paste in UI'],
      ['ElevenLabs', 'Voice generation + transcription.', '.env as ELEVENLABS_API_KEY'],
    ],
    [1800, 4200, 3360],
  ),
  Spacer(),

  H2('Install and start'),
  Step(1, 'Clone the repo to a workspace folder (example: ~/breadstick).'),
  Step(2, 'Install node dependencies.'),
  Code('npm install'),
  Step(3, 'Copy .env.example to .env and paste your API keys.'),
  Step(4, 'Open two terminals. Run these in parallel — both are required.'),
  Code('# Terminal A — Vite dev server (port 5173)\nnpm run dev\n\n# Terminal B — Express API proxy (port 3001)\nnpm run server'),
  Step(5, 'Open http://localhost:5173 in your browser. You should see the Breadstick Dashboard.'),
  Spacer(),

  Callout('Why two servers?',
    'Vite serves the React front-end with hot reload on 5173. The Express proxy on 3001 forwards your API calls (Anthropic, kie.ai, Blotato, FFmpeg jobs, Google Drive helpers) so your keys never touch the browser. If either one is down, the app looks frozen.'),
  new Paragraph({ children: [new PageBreak()] }),
);

// ───────────────────────────────────────────────────────────────────────────
// Part 3 — Classic Dashboard
// ───────────────────────────────────────────────────────────────────────────
content.push(
  H1('3. Classic Dashboard'),
  Lead('Linear workflow: pick a character, mix ingredients, generate a production-ready script with prompts attached.'),

  H2('Layout'),
  Bullet('Left panel — Character roster. Click a character to load their voice, niche, and pain-point library.'),
  Bullet('Main panel — Ingredient selectors (five categories). Your selections shape the script.'),
  Bullet('Output panel — Generated script + six production prompts (avatar image, voice, video, caption, DM, etc.).'),
  Spacer(),

  H2('Step-by-step: your first script'),
  Step(1, 'Click a character in the left panel. Their details populate the Main panel.'),
  Step(2, 'In the Main panel, pick an ingredient from each category: Pain Point, Hook, Monetization Path, Script Type, CTA.'),
  Step(3, 'Click Generate. Claude writes a script using your character\'s voice and the AI Content System\'s psychology rules.'),
  Step(4, 'Review the output. Each production prompt is copy-ready — one click puts it on your clipboard.'),
  Step(5, 'Paste the script into ElevenLabs for voice. Paste the avatar prompt into Sora 2 or your image tool.'),
  Spacer(),

  H2('Adding a new character'),
  P('The Dashboard supports adding characters without code changes.'),
  Step(1, 'Click + Add Character in the Left panel.'),
  Step(2, 'Fill in the form: name, handle, niche, tagline, demographic, cameo name (if you have a Sora 2 cameo), avatar description, voice, 5+ pain points, 5+ hooks, monetization, ManyChat triggers, CTA style, accent color.'),
  Step(3, 'Save. The character is now in your roster. Their data persists across sessions.'),
  Spacer(),

  Callout('Sora 2 cameo tip',
    'If your character has a Sora 2 cameo (for example @yourcameo), add the cameoName. The Dashboard will switch to lean prompts (just @cameoname + action + setting) and let Sora handle wardrobe. Characters without cameos get the full avatar description injected per clip.'),
  new Paragraph({ children: [new PageBreak()] }),
);

// ───────────────────────────────────────────────────────────────────────────
// Part 4 — Canvas View
// ───────────────────────────────────────────────────────────────────────────
content.push(
  H1('4. Canvas View'),
  Lead('The visual pipeline editor. Drag nodes, wire them, run the chain.'),

  H2('Opening the Canvas'),
  Step(1, 'From the Dashboard, click the Canvas toggle in the header. It lazy-loads on first use.'),
  Step(2, 'You see a dark grid with a Palette on the left and the Core Nodes already placed on the canvas (Characters, Types, Generator, Outputs). These four cannot be deleted — they are the spine of the UGC workflow.'),
  Spacer(),

  H2('Node anatomy'),
  Bullet('Gradient header bar — title + right-aligned badge (status / mode).'),
  Bullet('8-pixel status dot — idle (gray) · generating (pulsing gold) · done (green) · error (red).'),
  Bullet('Body — the node\'s controls (dropdowns, text areas, API key, preview).'),
  Bullet('Left handle(s) — inputs. Right handle — output. Wires glow with the source node\'s accent color.'),
  Bullet('Delete button on non-protected nodes. Core pipeline nodes are delete-protected.'),
  Spacer(),

  H2('Step-by-step: wire your first pipeline'),
  Step(1, 'Click a character card in the Characters node. Its details light up in the Generator node.'),
  Step(2, 'Drag an ingredient type (e.g., Pain Point) from the Types node. A Pain Point node spawns on the canvas.'),
  Step(3, 'Pick a specific pain point inside that spawned node. Its output handle becomes active.'),
  Step(4, 'Wire the Pain Point node\'s output to the Generator node\'s input handle.'),
  Step(5, 'Repeat for Hook, Monetization, Script Type, CTA.'),
  Step(6, 'Paste your Anthropic key into the Generator node (it persists to localStorage).'),
  Step(7, 'Click Generate. The Outputs node below fills with the script and production prompts.'),
  Spacer(),

  H2('Key conventions to remember'),
  Bullet('Every node writes results into a shared "nodeOutputs" map keyed by its own ID. Downstream nodes read from that map, tracing edges backward. This is why wires feel instant — data flows via state, not re-renders.'),
  Bullet('Drag from the Palette to spawn any of the 20+ node types. Some nodes (kie.ai, Blotato, FFmpeg Grade, Chroma Composite) are single-purpose tools; others (Niche Script Gen, Carousel) are pipeline anchors.'),
  Bullet('Group nodes visually by dragging a Group node over them. Groups are resizable and helpful for separating pipelines on one canvas.'),
  Spacer(),

  Callout('Infinite render loop warning',
    'If you build a custom node: read handlers from React Context ("CanvasCtx"), NEVER call useEffect on node state. Also never wrap nodeOutputs in useMemo — it produces stale data. Both of those patterns caused the canvas to freeze during Phase 2 development.'),
  new Paragraph({ children: [new PageBreak()] }),
);

// ───────────────────────────────────────────────────────────────────────────
// Part 5 — The Four Content Pipelines
// ───────────────────────────────────────────────────────────────────────────
content.push(
  H1('5. The Four Content Pipelines'),
  Lead('Recipes. Each lives on the same canvas and shares the same server endpoints.'),

  H2('5A. UGC Lane — AI Influencer Talking Heads'),
  P('Goal: produce realistic AI-avatar talking-head Reels, 30–60s, with lip-synced speech and b-roll cutaways.'),
  Step(1, 'Start with the Character node. Pick a character with a configured Sora 2 cameo for best results.'),
  Step(2, 'Wire ingredients into Script Gen UGC. Select UGC iPhone (V4) prompt style for natural, hand-held realism. Use Cinematic only if the brief calls for it.'),
  Step(3, 'Choose Clip Mode: Full Scene (8s clips) or Clip Mode (5s talking + 5s b-roll). Clip Mode tiers: 30s (4T+2B), 45s (5T+4B), 60s (7T+5B).'),
  Step(4, 'Pipe the script into Clip Splitter. It parses the script into 5-second clips, enforces the 12-word sentence ceiling, and emits clip-by-clip prompts.'),
  Step(5, 'Wire Clip Splitter → Avatar Frames (pulls your character\'s headshot library). Wire Clip Splitter → UGC Video (Kling 3.0 first-frame animation).'),
  Step(6, 'Generate. You\'ll get talking clips + b-roll clips that can be stitched in your editor of choice (or via Remotion Compositor).'),
  Spacer(),

  H2('5B. Carousel Video Lane — Title Cards with Motion'),
  P('Goal: Instagram carousels where each slide has a rendered 16-GAMI art piece and a small video loop inside the art zone.'),
  Step(1, 'Start with Niche Script Gen. Enter topic + tone; it writes numbered slide copy matching your carousel template rules (no em-dashes, under 32 words per slide).'),
  Step(2, 'Wire the script into Title Card (generates the first-frame slide art via Nano Banana Pro) AND 16-GAMI Art (batch-renders one image per slide).'),
  Step(3, 'Feed both images into Frame Sandwich. It pairs first-frame + last-frame and hands them to Kling 3.0 for a 3–5s motion loop.'),
  Step(4, 'Wire the motion clips + slide copy into the Carousel node. Choose template (Skyframe or Droplets) and theme (Dark or Light).'),
  Step(5, 'Optionally route through Remotion Compositor to composite each motion clip INTO its slide art zone for the final video-in-slide effect.'),
  Spacer(),

  H2('5C. 16-GAMI Lane — Pure Image Carousels'),
  P('Goal: classic static carousels in Skyframe\'s signature paper-origami hybrid look. Fastest pipeline — no video processing.'),
  Step(1, 'Niche Script Gen produces the slide copy.'),
  Step(2, '16-GAMI Art node renders one image per slide via Nano Banana Pro. The node prepends the Brand DNA style block automatically — you don\'t have to write a prompt.'),
  Step(3, 'Carousel node assembles images + copy into final 1080×1350 slides using the template renderer.'),
  Step(4, 'Optional: wire Carousel output into a Blotato node to auto-post to Instagram / Facebook / TikTok.'),
  Spacer(),

  H2('5D. Video Lane — Single Image to Reel'),
  P('Goal: one hero image becomes a 5–10s Reel.'),
  Step(1, 'Niche Script Gen writes a single narrative beat.'),
  Step(2, '16-GAMI Art renders one hero image.'),
  Step(3, 'Video Prompt node wraps the image with a motion brief (Subject + Action + Environment + Style + Camera Movement).'),
  Step(4, 'KIE Img2Vid (Kling 2.6) animates the hero into the final Reel.'),
  new Paragraph({ children: [new PageBreak()] }),
);

// ───────────────────────────────────────────────────────────────────────────
// Part 6 — Pipeline CLI
// ───────────────────────────────────────────────────────────────────────────
content.push(
  H1('6. Pipeline CLI (Headless Mode)'),
  Lead('Run the full carousel pipeline from the terminal. Same endpoints as the Canvas, zero UI.'),

  P('Use cases: cron-driven content factories, agent-triggered runs, unattended batch jobs. You design and validate in the Canvas, then deploy as a CLI one-liner.'),
  Spacer(),

  H2('Example invocation'),
  Code('node pipeline-cli.js \\\n  --topic "How Encryption Works" \\\n  --tone educational \\\n  --length 14 \\\n  --handle "@yourhandle" \\\n  --tag "YOUR PROJECT" \\\n  --upper-right "01 / 14" \\\n  --lower-right "save for later" \\\n  --motion kling3 \\\n  --skip-video'),
  Spacer(),

  H2('Common flags'),
  SimpleTable(
    ['Flag', 'Purpose'],
    [
      ['--topic', 'The topic or angle the script generator writes about.'],
      ['--tone', 'Voice tone: educational · hot-take · story · declarative.'],
      ['--length', 'Number of slides (6–14 recommended).'],
      ['--handle', 'Your @handle shown in the lower-left corner of each slide.'],
      ['--tag', 'Upper-left tag (e.g. YOUR PROJECT or a topic keyword).'],
      ['--upper-right', 'Upper-right text (often the slide counter).'],
      ['--lower-right', 'Lower-right text (swipe for more / save for later).'],
      ['--motion', 'Video engine: kling3 · kling2 · none.'],
      ['--skip-video', 'Skip video generation (16-GAMI still-only run).'],
    ],
    [2400, 6960],
  ),
  Spacer(),

  H2('Output'),
  Bullet('A manifest.json describing the run (topic, timings, cost estimates).'),
  Bullet('Rendered slide PNGs in the workspace folder.'),
  Bullet('Video URLs from kie.ai (if motion is enabled).'),
  new Paragraph({ children: [new PageBreak()] }),
);

// ───────────────────────────────────────────────────────────────────────────
// Part 7 — Shortform CLI
// ───────────────────────────────────────────────────────────────────────────
content.push(
  H1('7. Shortform CLI (Quick Take)'),
  Lead('Purpose-built for Ray-Ban Meta POV content. Teleprompter → record → transcribe → overlay → composite → Drive.'),

  H2('Three commands'),
  Bullet('quicktake — generate a teleprompter script OR a glance-once cue card.'),
  Bullet('process — download a raw recording from Drive, transcribe, color-grade, overlay, composite, upload the final cut.'),
  Bullet('gami — generate a single 16-GAMI image from plain English.'),
  Spacer(),

  H2('quicktake formats'),
  SimpleTable(
    ['Format', 'Use When', 'Output Shape'],
    [
      ['teleprompter', 'You\'re reading to camera (phone scroll, desktop).', 'Numbered bullets, full sentences, HOOK first + CTA last.'],
      ['beats', 'You\'re wearing Ray-Ban Meta — POV recording.', 'Cue card: natural OPEN, keyword beats, CLOSE direction. Do NOT read.'],
    ],
    [1800, 3280, 4280],
  ),
  Spacer(),

  H2('POV style and the four pillars'),
  P('The --style pov flag tunes the generator to match the content pattern that produced a proven high-save-rate short-form pattern. The --pillar flag routes the opener to one of four proven patterns:'),
  SimpleTable(
    ['Pillar', 'Lane', 'Opener Pattern'],
    [
      ['A', 'Workflow moment (replicable takeaway).', '"watch what happens when I..." / "here\'s what Claude does when I..."'],
      ['B', 'Research reveal (authority content).', '"just ran a new benchmark and..." / "session [N] just wrapped and..."'],
      ['C', 'Hot take / comparison (the proven winner).', '"I never hit X with Y because..." / "most people don\'t realize..."'],
      ['D', 'Breadstick in action (warm the funnel, no pitch).', '"this is my canvas for..." / "I built this thing that..."'],
    ],
    [1200, 3760, 4400],
  ),
  Spacer(),

  H2('Example invocations'),
  Code('# Teleprompter bullets (standard)\nnode shortform-cli.js quicktake "Prompt Injection" --bullets 7 --duration 60\n\n# POV cue card — hot take pillar\nnode shortform-cli.js quicktake "never hit rate limits" --format beats --style pov --pillar C\n\n# POV cue card — research reveal pillar\nnode shortform-cli.js quicktake "benchmark session 51 result" --format beats --style pov --pillar B'),
  Spacer(),

  H2('process — the record-to-upload pipeline'),
  Step(1, 'Record your Ray-Ban POV. The file syncs to your phone or desktop.'),
  Step(2, 'Upload the raw .mp4 to Google Drive /Short form IN/.'),
  Step(3, 'Run the process command. It will: transcribe via ElevenLabs Scribe (word-level timestamps), color-grade via FFmpeg (Warm UGC LUT by default), render 16-GAMI Remotion overlays that unfold at transcript cues, composite everything into a final VP9 WebM, run a QC check, and upload to /Short form OUT/.'),
  Code('# One-off run\nnode shortform-cli.js process\n\n# Poll loop (checks every 2 min for new files)\nnode shortform-cli.js process --watch'),
  Spacer(),

  H2('gami — single-image generation from the CLI'),
  Code('node shortform-cli.js gami "a dragon guarding a server room" --aspect-ratio 9:16 --resolution 2K'),
  P('The script wraps your description with the 16-GAMI Brand DNA block before it hits kie.ai. Result URL lands in stdout and is copied to your clipboard on Windows.'),
  new Paragraph({ children: [new PageBreak()] }),
);

// ───────────────────────────────────────────────────────────────────────────
// Part 8 — 16-GAMI Portal
// ───────────────────────────────────────────────────────────────────────────
content.push(
  H1('8. 16-GAMI Portal (Mobile / On-the-Go)'),
  Lead('A mobile-first web page for generating one image at a time when you\'re not at your desk.'),

  H2('Access'),
  Bullet('Local: http://localhost:3001/gami/'),
  Bullet('Remote (via your named Cloudflare tunnel): https://your-tunnel.example/gami/'),
  Spacer(),

  H2('Using it'),
  Step(1, 'Open the URL on your phone or desktop browser.'),
  Step(2, 'Paste your kie.ai API key in the key field. It is stored in your device\'s localStorage only — never transmitted.'),
  Step(3, 'Type a description or narrative beat in the textarea. You don\'t need to write a full prompt — the Brand DNA wrapper is applied server-side automatically.'),
  Step(4, 'Pick Aspect (1:1 for carousel, 9:16 for Reels/Story, 16:9 for landscape).'),
  Step(5, 'Pick Resolution (1K for quick tests, 2K default, 4K for hero images).'),
  Step(6, 'Tap Generate. The spinner shows status as the task queues, generates, and completes.'),
  Step(7, 'On finish, the image renders in the preview area. Tap Download to save directly. On mobile, tap-hold the image and use Share → Drive for one-step upload.'),
  Spacer(),

  Callout('Why this exists',
    'Pre-portal, generating a 16-GAMI image on the go required opening kie.ai\'s website and writing a full prompt by hand. The portal centralizes the Brand DNA on the server, so any input you type — narrative or subject — comes out as a Skyframe-branded image.'),
  new Paragraph({ children: [new PageBreak()] }),
);

// ───────────────────────────────────────────────────────────────────────────
// Part 9 — Carousel Rendering
// ───────────────────────────────────────────────────────────────────────────
content.push(
  H1('9. Carousel Rendering'),
  Lead('A Python renderer turns config + images into 1080×1350 Instagram slides. Two templates available today.'),

  H2('Templates'),
  SimpleTable(
    ['Template', 'Aesthetic', 'Fonts'],
    [
      ['skyframe', 'Particle network bg, tech / agent-forward. Yellow + cyan accents.', 'Audiowide · SpaceMono · Quantico'],
      ['droplets', 'Softer liquid motif. Warmer / lifestyle tone.', 'Custom droplet set'],
    ],
    [1800, 5000, 2560],
  ),
  Spacer(),

  H2('Slide types'),
  SimpleTable(
    ['Type', 'Use For', 'Requires'],
    [
      ['hook', 'Slide 1 — big typographic headline, no image.', 'text'],
      ['body', 'Pure text slide, medium headline.', 'text'],
      ['image_body', 'The workhorse — 16-GAMI art in the art zone + caption.', 'image, text, text_position'],
      ['cta', 'Text-only call to action.', 'text'],
      ['cta_follow', 'Follow prompt with AI Agent 16-GAMI icon.', 'image, text'],
      ['feature_grid', '4-up comparison or feature tiles.', 'grid'],
    ],
    [1600, 5000, 2760],
  ),
  Spacer(),

  H2('config.json schema'),
  Code('{\n  "title": "How Encryption Works",\n  "template": "skyframe",\n  "theme": "dark",\n  "profile": {\n    "display_name": "Your Brand",\n    "handle": "@yourhandle"\n  },\n  "slides": [\n    { "type": "hook", "tag": "YOUR PROJECT",\n      "text": "The math that makes your messages unreadable." },\n    { "type": "image_body", "tag": "SLIDE", "image": "art_1.png",\n      "text": "Every message you send travels through a storm of strangers...",\n      "text_position": "bottom" },\n    { "type": "cta_follow", "tag": "FOLLOW", "image": "cta_agent.png",\n      "text": "Follow @yourhandle for more." }\n  ]\n}'),
  Spacer(),

  H2('Running the renderer'),
  Code('# Local\npython3 carousels/render.py carousels/workspace/my-carousel\n\n# Via server API (same output, remote-callable)\ncurl -X POST http://localhost:3001/api/carousel/render \\\n  -H "Content-Type: application/json" \\\n  -d \'{"workspace":"my-carousel"}\''),
  Spacer(),

  Callout('Copy rules (non-negotiable)',
    'No em-dashes or en-dashes (house style). No smart quotes. No emoji. Numerals not words. One idea per slide. Hook ≤10 words. image_body ≤32 words. All right-side text inset 100px to avoid Instagram\'s slide-index and mute overlays.'),
  new Paragraph({ children: [new PageBreak()] }),
);

// ───────────────────────────────────────────────────────────────────────────
// Part 10 — Remotion Studio
// ───────────────────────────────────────────────────────────────────────────
content.push(
  H1('10. Remotion Studio'),
  Lead('React-based programmatic video. Used for the 16-GAMI overlays and carousel-video compositing.'),

  H2('Start the studio'),
  Code('npm run remotion:studio\n# Opens http://localhost:3333'),
  Spacer(),

  H2('What lives in Remotion'),
  Bullet('src/remotion/compositions/ — all video compositions.'),
  Bullet('GamiBannerOverlay — paper-banner overlays that unfold/fold on transcript-word timestamps.'),
  Bullet('CarouselVideoSlide — composites a motion clip INTO a carousel slide\'s art zone.'),
  Spacer(),

  H2('Workflow'),
  Step(1, 'Open the studio in the browser. Pick a composition from the sidebar.'),
  Step(2, 'Tweak props visually. Live reload on save.'),
  Step(3, 'When happy, render to VP9 WebM (alpha-preserved) via the Render button or CLI: npx remotion render <id> out.webm --pixel-format yuva420p --image-format png'),
  new Paragraph({ children: [new PageBreak()] }),
);

// ───────────────────────────────────────────────────────────────────────────
// Part 11 — Infrastructure & Skills
// ───────────────────────────────────────────────────────────────────────────
content.push(
  H1('11. Infrastructure & Skills'),
  Lead('The plumbing — tunnel, server endpoints, and the skill library that extends Claude Code.'),

  H2('Cloudflare Tunnel'),
  P('Breadstick\'s Express server runs on localhost:3001. The tunnel exposes it to the internet at https://your-tunnel.example so your phone and external agents can call in.'),
  Bullet('Start: POST /api/tunnel/start'),
  Bullet('Status: GET /api/tunnel/status'),
  Bullet('Stop: POST /api/tunnel/stop'),
  P('When the tunnel is active, the API panel shows a green TUNNEL badge.'),
  Spacer(),

  H2('Core server endpoints'),
  SimpleTable(
    ['Endpoint', 'Purpose'],
    [
      ['POST /api/generate', 'Anthropic proxy (Claude script generation).'],
      ['POST /api/kie/create', 'Create kie.ai task (any model).'],
      ['GET /api/kie/status/:taskId', 'Poll kie.ai task status.'],
      ['POST /api/gami/generate', 'Wrap prompt with 16-GAMI Brand DNA + fire to kie.ai.'],
      ['POST /api/ffmpeg/grade', 'Color-grade a video via FFmpeg.'],
      ['POST /api/ffmpeg/chroma-composite', 'Chroma Composite (character over slide).'],
      ['POST /api/upload-image', 'Upload a local file and get a public URL.'],
      ['POST /api/carousel/render', 'Run the Python carousel renderer.'],
      ['POST /api/remotion/composite', 'Composite a motion clip into a carousel slide.'],
      ['POST /api/blotato', 'Blotato CORS proxy for auto-posting.'],
    ],
    [3800, 5560],
  ),
  Spacer(),

  H2('Skills directory'),
  P('Claude Code skills live in .claude/skills/. Each is a markdown file with YAML frontmatter describing when it activates. Current skill library:'),
  Bullet('16gami-brand-dna — produces prompts that hit the Skyframe paper-origami look every time.'),
  Bullet('16gami-carousel-assembly — takes 16-GAMI images + copy and emits the renderer config.json.'),
  Bullet('carousel-pipeline — slash-command wrapper for end-to-end carousel runs.'),
  Bullet('sora2-prompt-generator — Sora 2 cameo + clip mode prompt builder.'),
  Bullet('product-ugc-pipeline — physical-product UGC workflow.'),
  Bullet('reactflow-canvas — patterns and do-not-do rules for building Canvas nodes.'),
  Bullet('digital-origami-orchestration — orchestration recipes across nodes.'),
  Bullet('breadstick-best-practices — general do\'s and don\'ts.'),
  new Paragraph({ children: [new PageBreak()] }),
);

// ───────────────────────────────────────────────────────────────────────────
// Part 12 — Troubleshooting
// ───────────────────────────────────────────────────────────────────────────
content.push(
  H1('12. Troubleshooting'),
  Lead('The issues you are most likely to hit in your first month.'),

  SimpleTable(
    ['Symptom', 'Likely Cause', 'Fix'],
    [
      ['Dashboard loads, clicking Generate does nothing.', 'Express server is not running.', 'Open a second terminal and run npm run server.'],
      ['Canvas feels frozen, no responses.', 'Infinite render loop (custom node using useEffect on node state).', 'Refactor to read handlers from CanvasCtx instead of useEffect.'],
      ['kie.ai task fails immediately.', 'Prompt too long (>500 words).', 'For batch runs, keep prompts ~60 words. Long prompts are safe for single-slide tests only.'],
      ['UGC Video node uploads but image never reaches Kling.', 'Free upload hosts (catbox / tmpfiles / 0x0) throwing 503s.', 'Start the Cloudflare tunnel — the server uses it first, then falls back to free hosts.'],
      ['Carousel images show but text overflows the art zone.', 'Slide copy exceeds the word-count ceiling.', 'Hook ≤10 words. image_body ≤32 words. Split long ideas into two slides.'],
      ['kie.ai CDN returns a broken image URL days later.', 'kie.ai CDN expiry.', 'Download the image immediately after generation or re-run the node.'],
      ['16-GAMI images look "cinematic" or CGI, not paper.', 'Extra lighting or art-style modifiers in the prompt.', 'Do not add modifiers on top of the Brand DNA block. Subject description only, ≤1 sentence.'],
      ['Sora 2 cameo speaks too fast.', 'Default pacing is too quick for deliberate delivery.', 'Always prompt explicitly for slow, deliberate pacing.'],
      ['Remotion alpha doesn\'t carry through composite.', 'Using VP8 (no alpha support).', 'Use VP9 WebM with --pixel-format yuva420p --image-format png.'],
      ['Teleprompter script is unreadable on phone.', 'Drive mobile can\'t preview markdown.', 'Save teleprompter output as Google Docs, not .md.'],
    ],
    [2600, 3200, 3560],
  ),
  new Paragraph({ children: [new PageBreak()] }),
);

// ───────────────────────────────────────────────────────────────────────────
// Part 13 — File Reference
// ───────────────────────────────────────────────────────────────────────────
content.push(
  H1('13. File Reference'),
  Lead('Where every important thing lives in the repo.'),

  SimpleTable(
    ['Path', 'What It Is'],
    [
      ['App.jsx', 'Classic Dashboard entry point.'],
      ['src/canvas/CanvasView.jsx', 'Canvas View — all nodes, edges, resolver, and handlers. Single-file architecture.'],
      ['server.js', 'Express API proxy. All /api/* endpoints.'],
      ['pipeline-cli.js', 'Headless carousel pipeline runner.'],
      ['shortform-cli.js', 'Shortform pipeline CLI.'],
      ['carousels/render.py', 'Python carousel renderer.'],
      ['carousels/templates/', 'Template definitions: skyframe.json, droplets.json.'],
      ['carousels/workspace/', 'Per-run working folders with config.json + rendered slides.'],
      ['src/data/characters.js', 'Character roster (shared by Dashboard and Canvas).'],
      ['src/data/scriptPrompts.js', 'Script-generation system prompts + ingredient definitions.'],
      ['src/data/sora2.js', 'Sora 2 continuity blocks, b-roll libraries, cameo config.'],
      ['src/remotion/compositions/', 'All Remotion compositions.'],
      ['public/gami/', '16-GAMI mobile portal (index.html).'],
      ['.claude/skills/', 'Skill markdown files — used by Claude Code.'],
      ['docs/', 'Reference library (AI Content System, conversion scripts, niche research).'],
      ['renders/', 'Output folder for FFmpeg grades, chroma composites, etc.'],
      ['.env', 'API keys — never commit this file.'],
    ],
    [3400, 5960],
  ),
  Spacer(),

  Divider(),
  new Paragraph({
    children: [new TextRun({ text: 'End of Operator Guide · version 2026.04.20', italics: true, color: MUTED, size: 20 })],
    alignment: AlignmentType.CENTER,
  }),
);

// ── Document assembly ──────────────────────────────────────────────────────

const doc = new Document({
  creator: 'Breadstick',
  title: 'Breadstick Operator Guide',
  description: 'Step-by-step guide covering Breadstick from Classic Dashboard to Canvas and every supporting system.',
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 40, bold: true, font: 'Calibri', color: GOLD },
        paragraph: { spacing: { before: 360, after: 240 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Calibri', color: DARK },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Calibri', color: DARK },
        paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          children: [
            new TextRun({ text: 'BREADSTICK · Operator Guide', bold: true, size: 18, color: GOLD }),
            new TextRun('\t'),
            new TextRun({ text: 'v2026.04.20', size: 18, color: MUTED }),
          ],
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD, space: 4 } },
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          children: [
            new TextRun({ text: 'Breadstick', size: 18, color: MUTED }),
            new TextRun('\t'),
            new TextRun({ text: 'Page ', size: 18, color: MUTED }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: MUTED }),
          ],
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        })],
      }),
    },
    children: content,
  }],
});

Packer.toBuffer(doc).then(buffer => {
  writeFileSync(outPath, buffer);
  console.log(`Wrote ${outPath} (${buffer.length} bytes)`);
});

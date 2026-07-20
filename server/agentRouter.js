/**
 * agentRouter — surface-agnostic command dispatcher for Breadstick agents.
 *
 * Both /api/whatsapp/webhook and /api/slack/webhook parse incoming text via
 * `parseAgentCommand` and dispatch via `routeAgentCommand`. Each surface
 * passes its own `transport` (send / sendStarting / sendImage) so handlers
 * never know which chat surface they're talking to.
 *
 * History: extracted from server.js's WhatsApp router 2026-05-03 when adding
 * Slack as a second surface (PRD: docs/PRD_slack_integration_2026_05_02.md).
 * Verbs and behavior MUST stay identical to pre-extraction WhatsApp behavior.
 */

import { scanText } from '../src/lib/shipGate.js';

// ── Carousel arg parser ────────────────────────────────────────────────────
//
// Strips recognized modifier tokens from the END of a carousel command's tail
// in any order. Whatever remains is the topic. Supports voice phrasing like
// "carousel about Gemini 3.3 plain blue short live".

function parseCarouselArgs(rest) {
  const TEMPLATE_TOKENS = [
    ['plain blue', 'plain-blue'], ['plain black', 'plain-black'], ['plain white', 'plain-white'],
    ['plain-blue', 'plain-blue'], ['plain-black', 'plain-black'], ['plain-white', 'plain-white'],
    ['plainblue', 'plain-blue'], ['plainblack', 'plain-black'], ['plainwhite', 'plain-white'],
    ['skyframe', 'skyframe'], ['droplets', 'droplets'],
  ];
  const LENGTH_TOKENS = ['test', 'short', 'medium', 'long'];
  const FLAG_TOKENS = { live: 'research', research: 'research' };
  const FORMAT_TOKENS = {
    text: 'text_only', 'text-only': 'text_only', typography: 'text_only',
    terminal: 'terminal', cli: 'terminal', console: 'terminal',
  };

  const opts = { topic: '', template: 'plain-black', length: 'short', format: 'image_body', research: false };
  let words = rest.trim().split(/\s+/);
  let changed = true;
  while (changed && words.length > 0) {
    changed = false;
    const last = words[words.length - 1].toLowerCase();
    if (FLAG_TOKENS[last]) {
      opts[FLAG_TOKENS[last]] = true;
      words.pop(); changed = true; continue;
    }
    if (LENGTH_TOKENS.includes(last)) {
      opts.length = last;
      words.pop(); changed = true; continue;
    }
    if (FORMAT_TOKENS[last]) {
      opts.format = FORMAT_TOKENS[last];
      words.pop(); changed = true; continue;
    }
    if (words.length >= 2) {
      const last2 = (words[words.length - 2] + ' ' + last).toLowerCase();
      const tpl2 = TEMPLATE_TOKENS.find(([token]) => token === last2);
      if (tpl2) {
        opts.template = tpl2[1];
        words.pop(); words.pop(); changed = true; continue;
      }
    }
    const tpl1 = TEMPLATE_TOKENS.find(([token]) => token === last);
    if (tpl1) {
      opts.template = tpl1[1];
      words.pop(); changed = true; continue;
    }
  }
  opts.topic = words.join(' ').trim();
  return opts;
}

// ── Image (16gami / image2) arg parser ─────────────────────────────────────
//
// Forms:
//   16gami <theme>            → nano-banana-pro, style=16gami
//   16gami raw <theme>        → nano-banana-pro, style=raw
//   image2 <theme>            → image-2, style=16gami
//   image2 raw <theme>        → image-2, style=raw

function parseImageVerb(verb, rest) {
  let style = '16gami';
  let body = rest.trim();
  const m = body.match(/^raw[\s:]+(.+)$/i);
  if (m) { style = 'raw'; body = m[1].trim(); }
  if (!body) return null;
  const provider = verb === 'image2' ? 'image-2' : 'nano-banana-pro';
  return { cmd: verb, theme: body, provider, style };
}

// ── Broll arg parser (v2) ──────────────────────────────────────────────────
//
// `broll <topic> [N beats]` — recognized trailing tokens stripped from the end,
// remainder = topic. Matches parseCarouselArgs shape.
//
// v2 dropped the motion override (the 9-field Kling 3.0 template IS the motion now).
//
// Examples:
//   "broll AI agents"             → 5 beats
//   "broll AI agents 3 beats"     → 3 beats
//   "broll about quantum computing" → 5 beats, topic "quantum computing"

function parseBrollArgs(rest) {
  const opts = { topic: '', beats: 5 };
  let words = rest.trim().split(/\s+/);
  let changed = true;
  while (changed && words.length > 0) {
    changed = false;
    const last = words[words.length - 1].toLowerCase();
    if (words.length >= 2 && last === 'beats') {
      const n = parseInt(words[words.length - 2], 10);
      if (Number.isInteger(n) && n >= 3 && n <= 7) {
        opts.beats = n;
        words.pop(); words.pop(); changed = true; continue;
      }
    }
  }
  opts.topic = words.join(' ').trim();
  return opts;
}

// ── Master text → command parser ───────────────────────────────────────────

export function parseAgentCommand(text) {
  const t = (text || '').trim().replace(/^[\s"'“”‘’]+/, ''); // strip leading quotes/space — Scribe wraps utterances
  if (!t) return null;
  const lower = t.toLowerCase();
  if (lower === 'help' || lower === '?') return { cmd: 'help' };
  let pm = t.match(/^process(?:\s+(\w[\w-]*))?\.?$/i);
  if (pm) {
    const arg = (pm[1] || '').toLowerCase();
    const pack = (!arg || arg === 'latest') ? null : arg;
    return { cmd: 'process', pack };
  }
  if (/^longform(\s+latest)?\.?$/i.test(t)) return { cmd: 'longform' };
  if (/^silence[-\s]?cut(\s+latest)?\.?$/i.test(t)) return { cmd: 'silence-cut' };
  if (/^jobs\.?$/i.test(t)) return { cmd: 'jobs' };
  const cm = t.match(/^cancel(?:\s+(\S+?))?\.?$/i);
  if (cm) return { cmd: 'cancel', id: cm[1] || null };

  let m = t.match(/^beats(?:\s+for)?[:\s]+(.+)$/i);
  if (m) return { cmd: 'beats', topic: m[1].trim() };

  m = t.match(/^(?:teleprompter|script)(?:\s+for)?[:\s]+(.+)$/i);
  if (m) return { cmd: 'teleprompter', topic: m[1].trim() };

  // Voice-friendly: transcription often inserts punctuation after the verb
  // ("Build. Change the hero…", "build, add…"), so accept any run of separators.
  m = t.match(/^build[\s:.,!?-]+(.+)$/i);
  if (m) return { cmd: 'build', instruction: m[1].trim() };

  if (/^diary\.?$/i.test(t)) return { cmd: 'diary', thought: null };
  m = t.match(/^diary[\s:.,!?-]+(.+)$/i);
  if (m) return { cmd: 'diary', thought: m[1].trim() };

  m = t.match(/^carousel(?:\s+(?:for|about))?[:\s]+(.+)$/i);
  if (m) {
    const args = parseCarouselArgs(m[1]);
    if (!args.topic) return null;
    return { cmd: 'carousel', ...args };
  }

  m = t.match(/^16[\s-]?gami(?:\s+(?:for|about|of))?[:\s]+(.+)$/i);
  if (m) return parseImageVerb('16gami', m[1]);

  m = t.match(/^image[\s-]?2(?:\s+(?:for|about|of))?[:\s]+(.+)$/i);
  if (m) return parseImageVerb('image2', m[1]);

  m = t.match(/^broll(?:\s+(?:for|about|on))?[:\s]+(.+)$/i);
  if (m) {
    const args = parseBrollArgs(m[1]);
    if (!args.topic) return null;
    return { cmd: 'broll', ...args };
  }

  return null;
}

// ── Help text ──────────────────────────────────────────────────────────────

export const HELP_TEXT =
  'Breadstick commands:\n' +
  '• beats for <topic> — fast beats script\n' +
  '• teleprompter for <topic> — full script, posted to Notion\n' +
  '• process [pack] — edit newest clip in /Short form IN/\n' +
  '    packs: skyframe-5beat (default) | skyframe-code | skyframe-pov | gami-banner | none\n' +
  '• longform — longform pipeline on newest clip\n' +
  '• silence-cut — longform + auto silence removal on newest clip\n' +
  '• jobs — list active (queued + running) jobs\n' +
  '• cancel [id] — cancel the running job (or a specific id)\n' +
  '• carousel <topic> [template] [length] [format] [live] — render carousel\n' +
  '    e.g. "carousel about Gemini 3.3 plain-blue short terminal live"\n' +
  '    templates: skyframe | droplets | plain-blue | plain-black | plain-white\n' +
  '    lengths:   test | short | medium | long  (default: short)\n' +
  '    formats:   text (typography) | terminal (CLI block) — both skip art (~30 sec)\n' +
  '    live = web-grounded for current events\n' +
  '• 16gami <theme> — single 2K 1:1 origami image (Nano Banana Pro). Add "raw" before <theme> to skip the 16-GAMI wrap.\n' +
  '• image2 <theme> — same but via OpenAI Image-2. "raw" works here too.\n' +
  '• broll <topic> [N beats] — script + N start+end 16-gami pairs + N kie.ai Kling 3.0 b-rolls\n' +
  '    9-field prompt template, narrative-arc anchors per beat (~5-8 min)\n' +
  '    e.g. "broll rotating API keys 5 beats"\n' +
  '• build <instruction> — Claude edits the sandbox app, build-gates it, pushes a preview branch, and sends the Vercel preview URL.\n' +
  '• diary [look,look] [reflection] — LifeJournal diary cut. Optional leading comma-list of series names (looks) pins which series to draw from. Bare = silent; with a spoken/typed reflection = narrated in your voice.\n' +
  '• help — this list\n\n' +
  'Anything else falls through to Claude.';

// ── Transport-safe send wrapper ────────────────────────────────────────────
//
// Every outbound text goes through scanText (ship-gate pattern). If a
// payload trips an injection signature we replace it with a quarantine notice
// before handing to the transport, never leaking the suspect bytes downstream.

async function safeSend(transport, text, kind = 'text') {
  if (typeof text !== 'string' || !text) {
    return transport.send(text || '(empty)');
  }
  const verdict = scanText(text);
  if (verdict.verdict === 'QUARANTINE') {
    const types = verdict.violations.map(v => v.type).join(', ') || 'unknown';
    console.warn(`[agentRouter] outbound quarantined (kind=${kind}, types=${types}, taint=${verdict.taintScore.toFixed(2)})`);
    return transport.send('[content blocked: ship-gate caught injection signatures in outbound text]');
  }
  return transport.send(text);
}

async function safeSendStarting(transport, text) {
  const verdict = scanText(text || '');
  const safe = verdict.verdict === 'QUARANTINE' ? '[starting]' : (text || '[starting]');
  if (typeof transport.sendStarting === 'function') return transport.sendStarting(safe);
  return transport.send(safe);
}

async function safeSendImage(transport, filePath, caption) {
  const safeCaption = (() => {
    if (!caption) return '';
    const v = scanText(caption);
    return v.verdict === 'QUARANTINE' ? '' : caption;
  })();
  if (typeof transport.sendImage === 'function') {
    return transport.sendImage(filePath, safeCaption);
  }
  return transport.send(`Image ready: ${filePath}${safeCaption ? `\n${safeCaption}` : ''}`);
}

// ── Handler dispatcher ─────────────────────────────────────────────────────

export async function routeAgentCommand({ cmd, transport, ctx }) {
  const { runCli, driveListNewestVideo, paths, extract, enqueueJob, cancelJob, listJobs } = ctx;

  switch (cmd.cmd) {
    case 'help':
      return safeSend(transport, HELP_TEXT, 'help');

    case 'beats': {
      const r = await runCli(paths.SHORTFORM_CLI, ['quicktake', cmd.topic, '--format', 'beats'], 600000);
      if (r.exitCode !== 0) {
        return safeSend(transport, `Beats failed (exit ${r.exitCode}).\n${(r.stderr || '').slice(0, 400)}`);
      }
      const script = extract.script(r.stdout);
      const notion = extract.notion(r.stdout);
      const body = (script || 'Generated — inline capture missed.').slice(0, 3500);
      return safeSend(transport, notion ? `${body}\n\nNotion: ${notion}` : body);
    }

    case 'teleprompter': {
      await safeSendStarting(transport, `Starting teleprompter: ${cmd.topic}...`);
      const r = await runCli(paths.SHORTFORM_CLI, ['quicktake', cmd.topic, '--format', 'teleprompter'], 600000);
      if (r.exitCode !== 0) {
        return safeSend(transport, `Teleprompter failed (exit ${r.exitCode}).\n${(r.stderr || '').slice(0, 400)}`);
      }
      const notion = extract.notion(r.stdout);
      return safeSend(transport, notion
        ? `Script ready.\n${notion}`
        : 'Script generated — Notion URL missed, check Drive /teleprompter/.');
    }

    case 'process': {
      const VALID_PACKS = ['skyframe-5beat', 'skyframe-code', 'skyframe-pov', 'gami-banner', 'none'];
      const pack = cmd.pack || 'skyframe-5beat';
      if (!VALID_PACKS.includes(pack)) {
        return safeSend(transport,
          `Unknown overlay pack: "${pack}". Valid: ${VALID_PACKS.join(', ')}`);
      }
      const job = enqueueJob({ type: 'shortform-process', input: { pack }, notify: transport.notify });
      return safeSend(transport, `Queued job ${job.id} — processing newest clip with ${pack}. I'll ping you when it's done.`);
    }

    case 'longform': {
      const latest = await driveListNewestVideo(paths.SHORTFORM_IN_FOLDER_ID);
      if (!latest) return safeSend(transport, 'No video in /Short form IN/. Upload first.');
      const job = enqueueJob({ type: 'longform', input: { fileId: latest.id }, notify: transport.notify });
      return safeSend(transport, `Queued job ${job.id} — longform on ${latest.name}. I'll ping you when it's done.`);
    }

    case 'silence-cut': {
      const latest = await driveListNewestVideo(paths.SHORTFORM_IN_FOLDER_ID);
      if (!latest) return safeSend(transport, 'No video in /Short form IN/. Upload first.');
      const job = enqueueJob({ type: 'longform', input: { fileId: latest.id, silenceCut: true }, notify: transport.notify });
      return safeSend(transport, `Queued job ${job.id} — silence-cut longform on ${latest.name}. I'll ping you when it's done.`);
    }

    case 'build': {
      if (!cmd.instruction) return safeSend(transport, 'Usage: build <what to change>');
      const job = enqueueJob({ type: 'ship-template', input: { instruction: cmd.instruction }, notify: transport.notify });
      return safeSend(transport, `Queued job ${job.id} — building a preview. I'll ping you when it's done.`);
    }

    case 'diary': {
      let thought = cmd.thought, series = null;
      if (thought) {
        const parts = thought.split(/\s+/);
        const cand = parts[0].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        const known = (ctx.lifejournalSeries ? ctx.lifejournalSeries() : []).map((s) => s.toLowerCase());
        if (cand.length && cand.every((c) => known.includes(c))) { series = cand; thought = parts.slice(1).join(' ').trim() || null; }
      }
      const job = enqueueJob({ type: 'lifejournal-diary', input: { thought, ...(series ? { series } : {}) }, notify: transport.notify });
      return safeSend(transport, `Queued job ${job.id} — ${series ? series.join('+') + ' ' : ''}${thought ? 'narrated' : 'silent'} diary. I'll ping you when it's done.`);
    }

    case 'cancel': {
      let id = cmd.id;
      if (!id) {
        const running = listJobs({ status: 'running' });
        if (!running.length) return safeSend(transport, 'No running job to cancel.');
        id = running[0].id;
      }
      const res = cancelJob(id);
      if (!res.ok && res.reason === 'not_found') return safeSend(transport, `No job ${id}.`);
      if (!res.ok) return safeSend(transport, `Job ${id} already ${res.reason.replace('already_', '')}.`);
      if (res.job.status === 'cancelled') return safeSend(transport, `Cancelled job ${id} (was queued).`);
      return safeSend(transport, `Cancelling job ${id} — killing the process. I'll confirm when it's dead.`);
    }

    case 'jobs': {
      const active = listJobs().filter(j => j.status === 'queued' || j.status === 'running');
      if (!active.length) return safeSend(transport, 'No active jobs.');
      const lines = active.map(j => `${j.id} — ${j.type} (${j.status})`);
      return safeSend(transport, `Active jobs:\n${lines.join('\n')}`);
    }

    case 'carousel': {
      const cliArgs = ['--topic', cmd.topic, '--template', cmd.template, '--length', cmd.length, '--format', cmd.format, '--skip-video'];
      if (cmd.research) cliArgs.push('--research');
      const cfgLabel = `${cmd.template}, ${cmd.length}, ${cmd.format}${cmd.research ? ', research' : ''}`;
      const eta = (cmd.format === 'text_only' || cmd.format === 'terminal') ? '~30 sec' : '~5 min';
      await safeSendStarting(transport, `Starting carousel: "${cmd.topic}" (${cfgLabel})... ${eta}`);
      const r = await runCli(paths.PIPELINE_CLI, cliArgs, 1800000);
      if (r.exitCode !== 0) {
        return safeSend(transport, `Carousel failed (exit ${r.exitCode}).\n${(r.stderr || '').slice(0, 400)}`);
      }
      const m = r.stdout.match(/carousels\/workspace\/([^\s/]+)/);
      return safeSend(transport, m
        ? `Carousel rendered (${cmd.template}). Workspace: ${m[1]}. Open canvas to publish.`
        : 'Carousel complete — check canvas.');
    }

    case 'broll': {
      await safeSendStarting(transport, `Starting broll v2: "${cmd.topic}" (${cmd.beats} beats, kie.ai Kling 3.0 start+end frame)... ~5-8 min`);
      const r = await runCli(paths.PIPELINE_CLI, [
        'broll',
        '--topic', cmd.topic,
        '--beats', String(cmd.beats),
      ], 1800000);
      if (r.exitCode !== 0) {
        return safeSend(transport, `Broll failed (exit ${r.exitCode}).\n${(r.stderr || '').slice(0, 400)}`);
      }
      const pm = r.stdout.match(/BROLL_PATH:(.+)/);
      if (!pm) return safeSend(transport, 'Broll done — folder path missing from CLI output.');
      const folder = pm[1].trim();
      const summaryMatch = r.stdout.match(/Beats:\s+(\d+)\s+\(start\s+(\d+)\/\d+,\s+end\s+(\d+)\/\d+,\s+video\s+(\d+)\/\d+\)/);
      if (summaryMatch) {
        const [, total, startOk, endOk, videoOk] = summaryMatch;
        const fullSuccess = videoOk === total && startOk === total && endOk === total;
        return safeSend(transport, fullSuccess
          ? `B-roll set ready (${videoOk}/${total} videos).\nFolder: ${folder}`
          : `B-roll set ready (start ${startOk}/${total}, end ${endOk}/${total}, video ${videoOk}/${total}).\nFolder: ${folder}`);
      }
      return safeSend(transport, `B-roll set ready.\nFolder: ${folder}`);
    }

    case '16gami':
    case 'image2': {
      const styleLabel = cmd.style === 'raw' ? 'raw prompt' : '16-GAMI wrap';
      const providerLabel = cmd.provider === 'image-2' ? 'OpenAI Image-2' : 'Nano Banana Pro';
      await safeSendStarting(transport, `Generating ${providerLabel} image (${styleLabel})... ~30 sec.`);
      const r = await runCli(paths.PIPELINE_CLI, [
        'image',
        '--theme', cmd.theme,
        '--provider', cmd.provider,
        '--style', cmd.style,
        '--aspect', '1:1',
        '--resolution', '2K',
      ], 600000);
      if (r.exitCode !== 0) {
        return safeSend(transport, `Image failed (exit ${r.exitCode}).\n${(r.stderr || '').slice(0, 400)}`);
      }
      const pathMatch = r.stdout.match(/IMAGE_PATH:(\S+)/);
      const urlMatch = r.stdout.match(/IMAGE_URL:(\S+)/);
      if (!pathMatch && !urlMatch) {
        return safeSend(transport, 'Image generated but path missing from CLI output.');
      }
      const localPath = pathMatch?.[1];
      const url = urlMatch?.[1];
      if (localPath) {
        return safeSendImage(transport, localPath, `${providerLabel} • ${cmd.theme}`);
      }
      return safeSend(transport, `Image ready (download failed locally).\n${url || ''}`);
    }

    default:
      return safeSend(transport, `Unknown command: ${cmd.cmd}`);
  }
}

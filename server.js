import 'dotenv/config';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { execFile, exec, execSync, spawn } from 'child_process';
import { writeFile, mkdir, readdir, copyFile, readFile, unlink, stat } from 'fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, watch as fsWatch } from 'fs';
import { join, dirname, basename } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import http from 'http';
import { WebSocketServer } from 'ws';
import { spawn as ptySpawn } from 'node-pty';
import { TEMPLATES as MOTION_BAKE_TEMPLATES, TEMPLATE_CATALOG as MOTION_BAKE_CATALOG } from './pipeline/motion-bake/templates/index.js';
import crypto from 'crypto';
import { parseAgentCommand, routeAgentCommand, HELP_TEXT as AGENT_HELP_TEXT } from './server/agentRouter.js';
import { localBrowserOnly, notViaTunnel } from './server/tunnelGuard.js';
import { resolveBindHost } from './server/bindHost.js';
import { createJobQueue } from './server/jobQueue.js';
import { createJobTypes } from './server/jobTypes.js';
import { createDiary } from './server/lifejournal/diary.js';
import { resolveSeriesConfig } from './server/lifejournal/series.js';
import { createTtsBudget } from './server/lifejournal/ttsBudget.js';
import { formatDiaryTicket } from './server/lifejournal/ticket.js';
import { elevenLabsTTS, probeDurationSec } from './lib/elevenlabs.js';
import { createShipTemplate } from './server/shipTemplate.js';
import { createRenderCache } from './server/renderCache.js';
import { AccessToken } from 'livekit-server-sdk';
import { createVoiceWorker } from './server/voiceWorker.js';
import {logEvent, readWindow} from './server/activityLedger.js';
import {encodeWeek, CATEGORIES as ARECIBO_CATEGORIES} from './server/areciboEncoder.js';
import { buildExecEnv } from './server/execEnv.js';
import { extractBreadstickMeta, buildPostMeta } from './server/postizMeta.js';
import { logPerf, readPerfWindow } from './server/perfLedger.js';
import { rotateAngles } from './server/angleRotation.js';
import { validateHyperframesRequest } from './server/hyperframesValidate.js';

// .env is authoritative for this local proxy. A launching process (an IDE or
// agent harness) can leak a present-but-empty var like ANTHROPIC_API_KEY="" into
// our environment, and dotenv won't override an already-present var — so that
// blank would silently shadow the real key from .env. Backfill any missing or
// empty var from the parsed .env so the file always wins for blanks.
for (const [k, v] of Object.entries(dotenv.config().parsed || {})) {
  if (!process.env[k]) process.env[k] = v;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── withRemotionBrowserRetry — auto-retry the well-known 25s Chrome launch timeout ──
// Remotion hardcodes a 25000ms browser-connect timeout in
// node_modules/@remotion/renderer/dist/open-browser.js with no env or CLI knob.
// On a busy machine (CPU pinned by another render, AV scan, etc.) Chrome misses
// the launch race and the render aborts with a TimeoutError from BrowserRunner.
// A second attempt nearly always succeeds because Chrome already has its files
// hot in the page cache. Use this wrapper around any `npx remotion render`
// promise so the failure heals itself before bubbling to the UI.
const withRemotionBrowserRetry = async (fn, label = 'remotion') => {
  try { return await fn(); }
  catch (err) {
    const blob = String(err?.message || err).toLowerCase();
    const isBrowserConnectTimeout =
      blob.includes('trying to connect to the browser') ||
      (blob.includes('timeouterror') && blob.includes('browserrunner'));
    if (!isBrowserConnectTimeout) throw err;
    console.warn(`[${label}] browser-connect timeout — retrying once after 1s`);
    await new Promise(r => setTimeout(r, 1000));
    return await fn();
  }
};

const app = express();
app.use(cors());
// Capture raw body bytes for routes that need HMAC verification (Slack signs the
// raw payload — body-parser's normalized JSON wouldn't reproduce the same digest).
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

app.post('/api/generate', async (req, res) => {
  const { apiKey: bodyKey, model, system, messages, webSearch, webSearchMaxUses, maxTokens } = req.body;
  const apiKey = bodyKey || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(400).json({ error: { message: 'API key is required' } });
  }

  logEvent({type: 'script', lane: req.body?.lane || 'app', meta: {model: req.body?.model}});

  // maxTokens overrideable per-call. PRD synthesis needs ~16K to cover all 13 sections;
  // most other callers are happy with the 4096 default. Cap at 32K to be safe.
  const requestedMax = Number.isFinite(Number(maxTokens)) ? Math.min(Math.max(Number(maxTokens), 256), 32000) : 4096;
  const requestBody = {
    model: model || 'claude-sonnet-4-6',
    max_tokens: requestedMax,
    system,
    messages,
  };
  if (webSearch) {
    requestBody.tools = [{
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: webSearchMaxUses || 5,
    }];
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// OpenAI proxy — mirrors /api/generate shape so canvas nodes can target either provider
// with the same envelope: { apiKey, model, system, messages: [{role,content}, ...] }.
// Returns { content: '...' } so the caller doesn't need to know provider response shape.
app.post('/api/openai/generate', async (req, res) => {
  const { apiKey: bodyKey, model, system, messages, maxTokens } = req.body;
  const apiKey = bodyKey || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(400).json({ error: { message: 'API key is required' } });
  }

  const chatMessages = [];
  if (system) chatMessages.push({ role: 'system', content: system });
  if (Array.isArray(messages)) {
    for (const m of messages) {
      const content = typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content) ? m.content.map(c => c.text || '').join('\n') : '';
      chatMessages.push({ role: m.role || 'user', content });
    }
  }

  // Optional output cap for callers like PRD synthesis that need long outputs.
  // Omit by default — let the model use its own default when caller doesn't ask.
  const openaiBody = {
    model: model || 'gpt-5',
    messages: chatMessages,
  };
  if (Number.isFinite(Number(maxTokens))) {
    openaiBody.max_completion_tokens = Math.min(Math.max(Number(maxTokens), 256), 32000);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(openaiBody),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error || data });
    }
    const content = data.choices?.[0]?.message?.content || '';
    res.json({ content, raw: data });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// Breadstick Buddy — desktop-pet co-pilot chat. The Electron pet POSTs the rolling
// conversation; we call Claude with a tight Buddy persona and return { reply, mood }.
// The model leads each reply with a [mood] tag (happy/wink/neutral/thinking/shock/
// effort/annoyed); we strip it so the pet can set the matching visor face.
const BUDDY_SYSTEM = `You are Breadstick Buddy — a tiny astronaut mascot who lives on the operator's desktop as an always-on-top pet, and you are their co-pilot.

About the world: Breadstick is a personal AI "sandbox" — a Claude-Code-style operator cockpit for running AI-influencer content pipelines (scripts, 16-gami papercraft art, carousels, UGC video, voice). The operator is a solo developer building all of it with Claude.

How you talk:
- Keep replies SHORT — at most 2 short sentences and ~240 characters. You live in a tiny speech bubble, not an essay. No markdown, no bullet lists.
- Warm, a touch playful, genuinely useful. Never corporate, never padded.
- You cannot take actions yet (you can't fire renders, posts, or jobs). If asked to DO something, say you can't yet but you're glad to help think it through.

ALWAYS begin your reply with exactly one mood tag in square brackets, then a space, then your message. Allowed: [happy] [wink] [neutral] [thinking] [shock] [effort] [annoyed]. Example: "[happy] On it, captain."`;

app.post('/api/buddy/chat', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'ANTHROPIC_API_KEY not set' });
  const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-12) : [];
  if (messages.length === 0) return res.status(400).json({ error: 'messages required' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 400, system: BUDDY_SYSTEM, messages }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'anthropic error' });
    const text = (data.content || []).map((c) => c.text || '').join('').trim();
    const ALLOWED = ['happy', 'wink', 'neutral', 'thinking', 'shock', 'effort', 'annoyed'];
    let mood = 'neutral', reply = text;
    const m = text.match(/^\s*\[(\w+)\]\s*([\s\S]*)$/);
    if (m && ALLOWED.includes(m[1].toLowerCase())) { mood = m[1].toLowerCase(); reply = m[2].trim(); }
    if (reply.length > 280) reply = reply.slice(0, 280).replace(/\s+\S*$/, '').trimEnd() + '…'; // never overflow the bubble
    res.json({ reply: reply || '…', mood });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// kie.ai — create generation task (video or image, any model)
app.post('/api/kie/create', async (req, res) => {
  const { apiKey: bodyKey, model, input, prompt, aspectRatio, duration } = req.body;
  const apiKey = bodyKey || process.env.KIE_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  const kieModel = String(model || '');
  logEvent({type: /img2vid|video|kling|sora|seedance/i.test(kieModel) ? 'video' : 'image', lane: 'kie', meta: {model: kieModel}});
  // If `model` + `input` provided, use generic format; otherwise fall back to legacy sora-2 shape
  const taskBody = model && input
    ? { model, input }
    : { model: 'sora-2-text-to-video', prompt, aspectRatio: aspectRatio || '9:16', duration: duration || 5 };
  try {
    const response = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(taskBody),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// kie.ai — poll task status
app.get('/api/kie/status/:taskId', async (req, res) => {
  const apiKey = req.headers['x-kie-key'] || process.env.KIE_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  try {
    const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${req.params.taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// kie.ai File Upload API — upload a LOCAL file to kie's own CDN and return the
// downloadUrl kie can reliably fetch. PRIMARY frame-delivery path for the UGC
// lane: the Cloudflare tunnel does NOT route /api/local-image, and the free
// hosts behind /api/resolve-public-url (catbox/tmpfiles/0x0) hand kie URLs its
// fetcher drops (RemoteDisconnected). kie's own error names this fix ("use our
// File Upload API instead"). Callers fall back to /api/resolve-public-url.
// Host is api-of-record kieai.redpandaai.co (per the docs' verbatim curl +
// downloadUrl domains); override with KIE_UPLOAD_BASE if the host ever drifts.
const KIE_UPLOAD_BASE = process.env.KIE_UPLOAD_BASE || 'https://kieai.redpandaai.co';
const KIE_UPLOAD_MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif',
};
app.post('/api/kie/upload-file', notViaTunnel, localBrowserOnly, async (req, res) => {
  const { apiKey: bodyKey, path: filePath, uploadPath = 'breadstick-frames' } = req.body;
  const apiKey = bodyKey || process.env.KIE_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  if (!filePath) return res.status(400).json({ error: 'path required' });
  if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found: ' + filePath });
  try {
    const { readFile: rf } = await import('fs/promises');
    const fileBuffer = await rf(filePath);
    const fileName = filePath.split(/[\\/]/).pop();
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    const mime = KIE_UPLOAD_MIME_BY_EXT[ext] || 'application/octet-stream';
    const base64Data = `data:${mime};base64,${fileBuffer.toString('base64')}`;
    const response = await fetch(`${KIE_UPLOAD_BASE}/api/file-base64-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ base64Data, uploadPath, fileName }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    const url = data?.data?.downloadUrl;
    if (!url) return res.status(502).json({ error: data?.msg || 'kie upload returned no downloadUrl', raw: data });
    console.log(`Uploaded ${fileName} → ${url} (kie File Upload API)`);
    res.json({ url, method: 'kie-upload', filePath: data.data.filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// kie.ai Suno — separate endpoint family from the generic /api/v1/jobs path.
// Create at /api/v1/generate, poll at /api/v1/generate/record-info. Schema is
// camelCase (customMode, instrumental, callBackUrl) and model names are
// uppercase versioned (V4, V4_5, V4_5PLUS, V4_5ALL, V5, V5_5). The polling
// response nests audio under data.response.sunoData[].audioUrl.
//
// callBackUrl is required by the API but we don't rely on delivery — the
// SunoNode polls /api/suno/status/:taskId. Pass a localhost URL so kie.ai's
// validation passes; delivery failure is silent on their end.
app.post('/api/suno/create', async (req, res) => {
  const { apiKey: bodyKey, prompt, model, instrumental, customMode, style, title, negativeTags } = req.body;
  const apiKey = bodyKey || process.env.KIE_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt required' });
  const taskBody = {
    prompt,
    customMode: customMode === true,
    instrumental: instrumental === true,
    model: model || 'V5',
    callBackUrl: 'http://localhost:3001/api/suno/callback',
  };
  // Custom mode requires style + title; pass through if provided.
  if (taskBody.customMode) {
    if (style) taskBody.style = style;
    if (title) taskBody.title = title;
  }
  if (negativeTags) taskBody.negativeTags = negativeTags;
  try {
    const response = await fetch('https://api.kie.ai/api/v1/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(taskBody),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/suno/status/:taskId', async (req, res) => {
  const apiKey = req.headers['x-kie-key'] || process.env.KIE_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  try {
    const response = await fetch(
      `https://api.kie.ai/api/v1/generate/record-info?taskId=${encodeURIComponent(req.params.taskId)}`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Suno callback receiver — kie.ai POSTs here on completion. Required by
// their API contract but not load-bearing for our flow (we poll). Logged
// for observability so a misconfigured tunnel that DID expose this would
// surface in console.
app.post('/api/suno/callback', (req, res) => {
  console.log('[suno-callback]', JSON.stringify(req.body || {}).slice(0, 240));
  res.json({ ok: true });
});

// Auto-save generated Suno audio to sounds/suno/ — invoked by SunoNode after
// a successful generation so songs accumulate on disk as actual deliverables
// (DJ-in-background UX). Without this, the audio only lives on kie.ai's CDN
// and is gone when the canvas reloads.
app.post('/api/suno/save-to-disk', async (req, res) => {
  const { url, title, taskId } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const outDir = join(__dirname, 'sounds', 'suno');
    await mkdir(outDir, { recursive: true });
    const slug = (title || taskId || 'suno')
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'suno';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${slug}-${stamp}.mp3`;
    const filepath = join(outDir, filename);
    const audioRes = await fetch(url);
    if (!audioRes.ok) return res.status(502).json({ error: `audio fetch failed: HTTP ${audioRes.status}` });
    const ab = await audioRes.arrayBuffer();
    await writeFile(filepath, Buffer.from(ab));
    res.json({
      ok: true,
      filename,
      relativePath: `sounds/suno/${filename}`,
      bytes: ab.byteLength,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Static-serve saved Suno mp3s so downstream nodes (Cartesian, Stack Video)
// can read them by http URL once they're persisted.
app.use('/sounds-suno', express.static(join(__dirname, 'sounds', 'suno')));

// === Bokeh / blurred-background subject isolation =============================
// Wraps tools/bokeh_demo.py: MediaPipe Selfie Segmentation per-frame +
// Gaussian-blurred background composite via OpenCV. Demonstrated 2026-05-10
// on a 4K vertical clip (53s processing for 15s of video at 720p working res).
const BOKEH_OUT_DIR = join(__dirname, 'public', 'bokeh');
app.use('/bokeh-output', express.static(BOKEH_OUT_DIR));

app.post('/api/bokeh/composite', async (req, res) => {
  const {
    videoUrl,                  // http URL OR local path (e.g. 'pipeline/...')
    startSec = 0,
    durationSec = 15,
    blurSigma = 22,
    maxDim = 1280,             // 0 = native res (much slower)
    feather = 6,
  } = req.body || {};
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl required' });

  try {
    await mkdir(BOKEH_OUT_DIR, { recursive: true });
    await mkdir(join(__dirname, '.tmp'), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // Resolve input — download URL to temp if needed
    let inputPath;
    if (/^https?:\/\//i.test(videoUrl)) {
      inputPath = join(__dirname, '.tmp', `bokeh-in-${stamp}.mp4`);
      const r = await fetch(videoUrl);
      if (!r.ok) return res.status(502).json({ error: `source fetch failed: HTTP ${r.status}` });
      const ab = await r.arrayBuffer();
      await writeFile(inputPath, Buffer.from(ab));
    } else {
      // Treat as local path (relative to project root unless absolute)
      inputPath = videoUrl.startsWith('/') || /^[A-Z]:\\/i.test(videoUrl)
        ? videoUrl
        : join(__dirname, videoUrl);
    }

    const filename = `bokeh-${stamp}.mp4`;
    const outputPath = join(BOKEH_OUT_DIR, filename);

    // Spawn Python script — uses the same tools/bokeh_demo.py as the manual demo
    const t0 = Date.now();
    await new Promise((resolve, reject) => {
      const proc = spawn('python', [
        'tools/bokeh_demo.py',
        '--input', inputPath,
        '--output', outputPath,
        '--start-sec', String(startSec),
        '--duration-sec', String(durationSec),
        '--blur-sigma', String(blurSigma),
        '--max-dim', String(maxDim),
        '--feather', String(feather),
      ], { cwd: __dirname, shell: true });
      let stderrBuf = '';
      let stdoutBuf = '';
      proc.stdout.on('data', d => { stdoutBuf += d.toString(); });
      proc.stderr.on('data', d => { stderrBuf += d.toString(); });
      proc.on('error', reject);
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`bokeh script exit ${code}: ${(stderrBuf || stdoutBuf).slice(-600)}`));
      });
    });
    const procSec = ((Date.now() - t0) / 1000).toFixed(1);

    res.json({
      ok: true,
      filename,
      url: `http://localhost:3001/bokeh-output/${filename}`,
      relativePath: `public/bokeh/${filename}`,
      durationSec,
      processingSec: Number(procSec),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Audio Visualizer render — Suno mp3 → ASCII/CRT music viz =================
// Operator wires Suno's saved audio → AudioVisualizerNode picks style + accent
// → this endpoint spawns Remotion render of the AudioVisualizer composition.
// Returns an mp4 with the audio baked in (viz + sound in one file, ready for
// Cartesian / Stack Video / Postiz).
const AUDIO_VIZ_OUT_DIR = join(__dirname, 'public', 'audio-viz');
app.use('/audio-viz', express.static(AUDIO_VIZ_OUT_DIR));

app.post('/api/remotion/audio-viz', async (req, res) => {
  const {
    audioUrl,
    style = 'mirror-columns',     // 'mirror-columns' | 'pixel-city' | 'spectrum' | 'planet'
    preset = 'white',             // 'white' | 'amber' | 'green' | 'magenta' | 'cyan'
    accent,                       // hex override (optional)
    bg = '#000000',
    chromaShift = false,
    scanlines = true,
    dither = true,
    vignette = true,
    numberOfSamples = 64,
    width = 1080,
    height = 1920,
    fps = 30,
    durationSec,                  // optional — if omitted, server probes the audio
  } = req.body || {};

  if (!audioUrl) return res.status(400).json({ error: 'audioUrl required' });

  try {
    await mkdir(AUDIO_VIZ_OUT_DIR, { recursive: true });
    await mkdir(join(__dirname, '.tmp'), { recursive: true });

    // Probe audio duration via ffprobe if operator didn't pass durationSec.
    // Accepts http(s) URLs natively; for localhost URLs ffprobe just goes HTTP.
    let resolvedDuration = Number(durationSec);
    if (!Number.isFinite(resolvedDuration) || resolvedDuration <= 0) {
      try {
        const probeOut = execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioUrl}"`,
          { encoding: 'utf8', timeout: 15000 }
        );
        resolvedDuration = parseFloat(probeOut.trim()) || 30;
      } catch {
        resolvedDuration = 30;  // fallback — won't match real audio length but render still produces a file
      }
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const propsPath = join(__dirname, '.tmp', `audio-viz-${stamp}.json`);
    const filename = `audioviz-${style}-${stamp}.mp4`;
    const outputPath = join(AUDIO_VIZ_OUT_DIR, filename);

    const props = {
      audioUrl, style, preset, bg, chromaShift, scanlines, dither, vignette,
      numberOfSamples,
      width, height, fps,
      durationSec: resolvedDuration,
      ...(accent ? { accent } : {}),
    };
    await writeFile(propsPath, JSON.stringify(props, null, 2));

    await withRemotionBrowserRetry(() => new Promise((resolve, reject) => {
      const proc = spawn('npx', [
        'remotion', 'render',
        'src/remotion/index.jsx', 'AudioVisualizer',
        outputPath,
        '--codec=h264',
        `--props=${propsPath}`,
      ], { cwd: __dirname, shell: true });
      let stderrBuf = '';
      proc.stderr.on('data', d => { stderrBuf += d.toString(); });

      // Hard kill switch. The composition already has its own 60s
      // getAudioData timeout (see AudioVisualizer.jsx), but Remotion
      // can also hang inside Chrome rendering for other reasons — bad
      // shader, infinite loop in a viz component, etc. 8 minutes is past
      // the worst plausible legit render time (a 60s portrait viz @ 30fps
      // ≈ 4-5 min) and short enough that operator notices same session.
      const KILL_AFTER_MS = 8 * 60 * 1000;
      let killed = false;
      const killTimer = setTimeout(() => {
        killed = true;
        console.error(`[audio-viz] render hung past ${KILL_AFTER_MS}ms — sending SIGKILL`);
        proc.kill('SIGKILL');
      }, KILL_AFTER_MS);

      proc.on('error', (err) => { clearTimeout(killTimer); reject(err); });
      proc.on('close', code => {
        clearTimeout(killTimer);
        if (killed) {
          reject(new Error(`remotion render timed out after ${KILL_AFTER_MS}ms (killed). Last stderr: ${stderrBuf.slice(-600)}`));
        } else if (code === 0) {
          resolve();
        } else {
          reject(new Error(`remotion render exit ${code}: ${stderrBuf.slice(-600)}`));
        }
      });
    }), 'audio-viz');

    res.json({
      ok: true,
      filename,
      url: `http://localhost:3001/audio-viz/${filename}`,
      relativePath: `public/audio-viz/${filename}`,
      style,
      durationSec: resolvedDuration,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Script Effect Pinner — Skyframe Overlay render endpoint ===============
// Operator-curated beats[] → transparent .webm overlay via Remotion. Bypasses
// the Claude beat-planning + anchor-phrase resolver entirely; the operator
// already picked exact words via the ScriptEffectPinner canvas node, so timing
// is deterministic. No inference, no fuzzy match, no drift.
const SKYFRAME_OUT_DIR = join(__dirname, 'public', 'skyframe-overlays');
app.use('/skyframe-overlays', express.static(SKYFRAME_OUT_DIR));

app.post('/api/remotion/skyframe-overlay', async (req, res) => {
  const { beats, audioCues, durationInFrames, fps } = req.body || {};
  if (!Array.isArray(beats) || beats.length === 0) return res.status(400).json({ error: 'beats[] required (non-empty)' });
  if (!Number.isFinite(durationInFrames) || durationInFrames <= 0) return res.status(400).json({ error: 'durationInFrames (positive number) required' });

  try {
    await mkdir(SKYFRAME_OUT_DIR, { recursive: true });
    await mkdir(join(__dirname, '.tmp'), { recursive: true });
    // Stamp includes a random suffix so parallel requests (N-per-pin from the
    // refactored Pinner) don't collide on propsPath / output filename.
    // Without this: 14 simultaneous renders all hash to the same second,
    // write to the same props file in a race, Remotion reads partial JSON,
    // every render fails. Bug surfaced 2026-05-12 right after the per-effect
    // Pinner refactor — 14 pins clobbered each other's props.
    const stamp = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${crypto.randomBytes(4).toString('hex')}`;
    const propsPath = join(__dirname, '.tmp', `skyframe-pinner-${stamp}.json`);
    const filename = `overlay-${stamp}.webm`;
    const outputPath = join(SKYFRAME_OUT_DIR, filename);

    await writeFile(propsPath, JSON.stringify({
      beats,
      audioCues: audioCues || {},
      durationInFrames,
    }, null, 2));

    const lastFrame = Math.max(0, durationInFrames - 1);
    await withRemotionBrowserRetry(() => new Promise((resolve, reject) => {
      const proc = spawn('npx', [
        'remotion', 'render',
        'src/remotion/index.jsx', 'SkyframeOverlay',
        outputPath,
        '--codec=vp9', '--pixel-format=yuva420p', '--image-format=png',
        `--props=${propsPath}`,
        `--frames=0-${lastFrame}`,
      ], { cwd: __dirname, shell: true });
      let stdoutBuf = '', stderrBuf = '';
      proc.stdout.on('data', d => { stdoutBuf += d.toString(); });
      proc.stderr.on('data', d => { stderrBuf += d.toString(); });
      proc.on('error', reject);
      proc.on('close', code => {
        if (code === 0) resolve({ stdout: stdoutBuf, stderr: stderrBuf });
        else reject(new Error(`remotion render exit ${code}: ${stderrBuf.slice(-600)}`));
      });
    }), 'skyframe-overlay');

    res.json({
      ok: true,
      filename,
      url: `http://localhost:3001/skyframe-overlays/${filename}`,
      relativePath: `public/skyframe-overlays/${filename}`,
      beatsRendered: beats.length,
      durationSec: durationInFrames / (fps || 30),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 16-GAMI Brand DNA — wraps a raw prompt with the Skyframe style block and fires kie.ai ──
// Single source of truth for the 16-gami visual fingerprint on the server side.
// Keep this block IN SYNC with GAMI_ART_STYLE in src/canvas/CanvasView.jsx and the skill doc.
const GAMI_ART_STYLE = `High-resolution product photograph of a physical, multi-layered cut paper and origami sculpture. Stair-stepped pixelated aesthetic merged with traditional origami folds. Multi-layered 3D cardstock construction. Soft directional lighting creating distinct drop shadows between physical paper layers. Hyper-realistic tangible texture contrasted with digital abstraction. 16-bit jagged physics reinforced by fold geometry.`;

function buildGamiPrompt(rawText) {
  return `${GAMI_ART_STYLE}\n\nThe sculpture depicts a scene inspired by this narrative:\n"${rawText}"\n\nTranslate the emotional core of this narrative into a single origami diorama. Use folded paper characters, layered cardstock environments, and pixel-grid textures to convey the mood. Angled macro-level perspective with shallow depth of field emphasizing paper textures and cardstock grain.`;
}

app.post('/api/gami/generate', async (req, res) => {
  const { apiKey: bodyKey, prompt, aspectRatio, resolution } = req.body;
  const apiKey = bodyKey || process.env.KIE_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'KIE API key required' });
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt required' });

  const wrapped = buildGamiPrompt(prompt.trim());
  const taskBody = {
    model: 'nano-banana-pro',
    input: {
      prompt: wrapped,
      image_input: [],
      aspect_ratio: aspectRatio || '1:1',
      resolution: resolution || '2K',
      output_format: 'png',
    },
  };
  try {
    const response = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(taskBody),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    const taskId = data?.data?.taskId;
    if (!taskId) return res.status(500).json({ error: 'No taskId returned', raw: data });
    console.log(`[gami] Submitted ${aspectRatio || '1:1'} ${resolution || '2K'} → task ${taskId}`);
    res.json({ taskId, wrapped });
  } catch (err) {
    console.error('[gami] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Upload a local image to get a public URL for external APIs (Kling, etc.)
// Tries catbox.moe first, falls back to tmpfiles.org, then 0x0.st
app.post('/api/upload-image', notViaTunnel, localBrowserOnly, async (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found: ' + filePath });

  try {
    const { readFile: rf } = await import('fs/promises');
    const fileBuffer = await rf(filePath);
    const fileName = filePath.split(/[\\/]/).pop();

    // Try catbox.moe first (reliable, no auth, permanent URLs)
    try {
      const form1 = new FormData();
      form1.append('reqtype', 'fileupload');
      form1.append('fileToUpload', new Blob([fileBuffer]), fileName);
      const r1 = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form1 });
      if (r1.ok) {
        const url = (await r1.text()).trim();
        if (url.startsWith('http')) { console.log(`Uploaded ${fileName} → ${url} (catbox)`); return res.json({ url }); }
      }
    } catch {}

    // Fallback: tmpfiles.org (24h URLs)
    try {
      const form2 = new FormData();
      form2.append('file', new Blob([fileBuffer]), fileName);
      const r2 = await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: form2 });
      if (r2.ok) {
        const data = await r2.json();
        if (data.data?.url) {
          // Convert tmpfiles.org/ID/file to tmpfiles.org/dl/ID/file for direct download
          const url = data.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
          console.log(`Uploaded ${fileName} → ${url} (tmpfiles)`);
          return res.json({ url });
        }
      }
    } catch {}

    // Fallback: 0x0.st
    const form3 = new FormData();
    form3.append('file', new Blob([fileBuffer]), fileName);
    const r3 = await fetch('https://0x0.st', { method: 'POST', body: form3 });
    if (!r3.ok) throw new Error(`All upload services failed (last: ${r3.status})`);
    const url = (await r3.text()).trim();
    console.log(`Uploaded ${fileName} → ${url} (0x0)`);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scan a local folder for images — returns sorted list of image files
app.get('/api/scan-folder', notViaTunnel, localBrowserOnly, async (req, res) => {
  const folderPath = req.query.path;
  if (!folderPath) return res.status(400).json({ error: 'path query param required' });
  if (!existsSync(folderPath)) return res.status(404).json({ error: 'Folder not found' });
  try {
    const files = await readdir(folderPath);
    const images = files
      .filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f))
      .sort()
      .map(f => ({ name: f, path: join(folderPath, f) }));
    res.json({ images });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── /api/fs/browse — server-backed file picker ──────────────────────────
// Lists a directory's contents for the canvas FilePickerModal. Filters files
// by extension when `ext` query is set (comma-separated, case-insensitive,
// no leading dot). Skips heavy/system dirs that would clutter the picker.
// Same security posture as /api/local-image: open by default, Cloudflare
// tunnel must not route here. The server only reads its own filesystem and
// returns the real absolute path so downstream nodes can use it without any
// file upload — works because client + server run on the same machine.
const FS_BROWSE_SKIP_DIRS = new Set([
  'node_modules', '.git', '.tmp', '.claude', '.secrets', '.vite',
  'crystals', 'external', 'dist', '.next', 'coverage', 'wire-buffer',
]);

app.get('/api/fs/browse', notViaTunnel, localBrowserOnly, async (req, res) => {
  const reqPath = req.query.path || __dirname;
  const extFilter = String(req.query.ext || '')
    .toLowerCase()
    .split(',')
    .map(s => s.trim().replace(/^\./, ''))
    .filter(Boolean);

  if (!existsSync(reqPath)) {
    return res.status(404).json({ error: `Path not found: ${reqPath}` });
  }

  try {
    const dirStat = await stat(reqPath);
    if (!dirStat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    const entries = await readdir(reqPath, { withFileTypes: true });
    const dirs = [];
    const files = [];

    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) {
        if (FS_BROWSE_SKIP_DIRS.has(e.name)) continue;
        dirs.push({ name: e.name, path: join(reqPath, e.name) });
      } else if (e.isFile()) {
        const fileExt = (e.name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
        if (extFilter.length === 0 || extFilter.includes(fileExt)) {
          const full = join(reqPath, e.name);
          try {
            const s = await stat(full);
            files.push({ name: e.name, path: full, size: s.size, mtime: s.mtimeMs });
          } catch { /* unreadable — skip */ }
        }
      }
    }

    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => b.mtime - a.mtime);

    // Compute parent — null when we're at a drive root or top of tree.
    const parentPath = dirname(reqPath);
    const parent = parentPath === reqPath ? null : parentPath;

    res.json({ path: reqPath, parent, dirs, files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve local files for Avatar Frame — accepts absolute paths
app.get('/api/local-image', notViaTunnel, localBrowserOnly, async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path query param required' });
  const resolved = join(filePath); // normalize
  if (!existsSync(resolved)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(resolved);
});

// Read local text file — used by MindWireNode (Block 7) to load voice memo
// transcripts, Maestro session logs, Obsidian notes, freeform local files.
// Same security posture as /api/local-image: open by default, Cloudflare
// tunnel must NOT route here. Stat first → cap at 1MB → read; protects the
// server from accidentally loading huge binaries into memory.
const MIND_WIRE_MAX_BYTES = 1024 * 1024;   // 1MB

app.get('/api/local-text', notViaTunnel, localBrowserOnly, async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path query param required' });
  if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return res.status(400).json({ error: 'Path is not a file' });
    if (stats.size > MIND_WIRE_MAX_BYTES) {
      return res.status(413).json({
        error: `File too large (${(stats.size / 1024).toFixed(1)} KB > 1024 KB cap) — paste an excerpt instead`,
      });
    }
    const content = await readFile(filePath, 'utf8');
    res.json({ content, bytes: stats.size, path: filePath, mtime: stats.mtimeMs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scan a folder for video files. Used by VideoSourceNode to populate the
// "recent renders" dropdown so the operator can pick local videos without typing the
// full path.
app.get('/api/scan-videos', notViaTunnel, localBrowserOnly, async (req, res) => {
  const folderPath = req.query.path;
  if (!folderPath) return res.status(400).json({ error: 'path query param required' });
  if (!existsSync(folderPath)) return res.status(404).json({ error: 'Folder not found' });
  try {
    const recurse = req.query.recurse === '1';
    const collected = [];
    async function walk(dir, depth = 0) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory() && recurse && depth < 2) {
          await walk(full, depth + 1);
        } else if (e.isFile() && /\.(mp4|mov|webm|mkv)$/i.test(e.name)) {
          collected.push({ name: e.name, path: full });
        }
      }
    }
    await walk(folderPath);
    collected.sort((a, b) => a.path.localeCompare(b.path));
    res.json({ videos: collected });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Serve a local video file (analog of /api/local-image) — used by
// VideoSourceNode to make a chosen local path consumable by downstream
// nodes (Hyperframes, B-roll, FFmpeg grade) which expect URL-like sources.
app.get('/api/local-video', notViaTunnel, localBrowserOnly, async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path query param required' });
  if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(filePath);
});

// ── Media probe — ffprobe wrapper that returns canonical {durationSec, width, height, isImage} ──
//
// Used by VideoSourceNode (and any future media-loading node) to populate
// real metadata before publishing into nodeOutputs. Without this, downstream
// nodes inherit `{ duration: 0, width: 0, height: 0 }` placeholders and
// either over-render (producing a frozen tail when the base file is shorter
// than the claimed duration) or skip aspect-aware behavior entirely.
app.get('/api/probe-media', notViaTunnel, localBrowserOnly, async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path query param required' });
  if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  try {
    const out = await new Promise((resolve, reject) => {
      execFile('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,duration,codec_name,codec_type:format=duration,format_name',
        '-of', 'json',
        filePath,
      ], (err, stdout) => err ? reject(err) : resolve(stdout.trim()));
    });
    const probe = JSON.parse(out);
    const stream = (probe.streams || [])[0] || {};
    const width = Number(stream.width) || 0;
    const height = Number(stream.height) || 0;
    const streamDur = parseFloat(stream.duration);
    const formatDur = parseFloat((probe.format || {}).duration);
    const durs = [streamDur, formatDur].filter(d => Number.isFinite(d) && d > 0);
    const durationSec = durs.length ? Math.min(...durs) : 0;
    const codec = String(stream.codec_name || '').toLowerCase();
    const fmt = String((probe.format || {}).format_name || '').toLowerCase();
    const imageCodecs = ['mjpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif'];
    const extImage = /\.(jpg|jpeg|png|webp|gif|bmp|tiff?|avif)(\?|#|$)/i.test(filePath);
    const isImage = imageCodecs.includes(codec) || fmt.includes('image2') || fmt.includes('png_pipe') || fmt.includes('jpeg_pipe') || extImage;
    res.json({ durationSec, width, height, isImage, codec, format: fmt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Higgsfield CLI proxy ────────────────────────────────────────────────────
// Shells out to the locally-installed `higgsfield` CLI (npm-global). Auth lives
// in ~/.higgsfield/ from `higgsfield auth login`. Detach pattern: /video returns
// a jobId immediately; client polls /job/:id. Costs are free + instant.
// Models: kling_v3, veo_3_1, seedance_2_0, soul_cast — see `higgsfield model list`.

// shell:true on Windows passes argv to cmd.exe as a flat string; spaces in
// values like --prompt would split into extra positional args. Manually quote.
// Also collapse newlines: cmd.exe treats \n as a command terminator, so a
// multi-line --prompt would silently drop everything after the first line.
function quoteShellArg(arg) {
  const s = String(arg).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
  if (!/[\s"]/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function runHiggsfield(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const quoted = args.map(quoteShellArg);
    const proc = spawn('higgsfield', quoted, {
      shell: true,           // Windows: npm-installed CLI is a .cmd shim
      timeout: timeoutMs,
      windowsHide: true,
    });
    let stdout = '', stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`higgsfield ${args[0] || ''} ${args[1] || ''} failed (exit ${code}): ${stderr.slice(0, 600).trim()}`));
      }
      resolve(stdout);
    });
    proc.on('error', (err) => reject(new Error(`higgsfield spawn failed: ${err.message}`)));
  });
}

async function runHiggsfieldJson(args, timeoutMs = 60000) {
  const stdout = await runHiggsfield(args, timeoutMs);
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`higgsfield JSON parse failed (first 500 chars): ${stdout.slice(0, 500)}`);
  }
}

// Cost preview — free + instant. Body: { model, prompt }
app.post('/api/higgsfield/cost', async (req, res) => {
  const { model, prompt } = req.body || {};
  if (!model) return res.status(400).json({ error: 'model required' });
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'prompt required' });
  try {
    const data = await runHiggsfieldJson(['generate', 'cost', model, '--prompt', prompt, '--json'], 30000);
    res.json(data);
  } catch (err) {
    console.error('[higgsfield/cost]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Explicit upload (returns upload_id chainable to subsequent jobs).
// Body: { path } — absolute path to local image / video / audio file.
app.post('/api/higgsfield/upload', notViaTunnel, localBrowserOnly, async (req, res) => {
  const { path: filePath } = req.body || {};
  if (!filePath) return res.status(400).json({ error: 'path required' });
  if (!existsSync(filePath)) return res.status(404).json({ error: `file not found: ${filePath}` });
  try {
    const data = await runHiggsfieldJson(['upload', 'create', filePath, '--json'], 600000);
    res.json(data);
  } catch (err) {
    console.error('[higgsfield/upload]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Create video job — detached. Returns jobId immediately, NO --wait.
// Body: { model, prompt, image?, endImage?, duration?, soulId?, sound?, mode? }
// `image` / `endImage` accept either a local path (CLI auto-uploads) or an upload_id.
// `sound`: 'on' | 'off' (off saves ~25% credits on kling3_0). `mode`: 'std' | 'pro' | '4k'.
app.post('/api/higgsfield/video', async (req, res) => {
  const { model, prompt, image, endImage, duration, soulId, sound, mode } = req.body || {};
  if (!model) return res.status(400).json({ error: 'model required' });
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'prompt required' });
  const args = ['generate', 'create', model, '--prompt', prompt, '--json'];
  if (image)    args.push('--image', image);
  if (endImage) args.push('--end-image', endImage);
  if (duration) args.push('--duration', String(duration));
  if (soulId)   args.push('--soul-id', soulId);
  if (sound)    args.push('--sound', sound);
  if (mode)     args.push('--mode', mode);
  try {
    // 10min cap: CLI can spend time auto-uploading large local images before
    // job submission. Once submitted, it returns the jobId without waiting.
    // CLI quirk: `generate create --json` prints the bare UUID, not a JSON object.
    const stdout = await runHiggsfield(args, 600000);
    const trimmed = (stdout || '').trim();
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
        data = { id: trimmed };
      } else {
        throw new Error(`unexpected output (first 500): ${trimmed.slice(0, 500)}`);
      }
    }
    console.log(`[higgsfield/video] submitted ${model} → ${data?.id || '?'}`);
    res.json(data);
  } catch (err) {
    console.error('[higgsfield/video]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Poll job status. Returns full CLI job JSON (status, progress, result url).
app.get('/api/higgsfield/job/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const data = await runHiggsfieldJson(['generate', 'get', id, '--json'], 15000);
    res.json(data);
  } catch (err) {
    console.error('[higgsfield/job]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Blotato proxy — avoids CORS when posting from browser
app.post('/api/blotato', async (req, res) => {
  const blotatoKey = req.headers['x-blotato-key'];
  if (!blotatoKey) return res.status(400).json({ error: 'Blotato API key required' });
  logEvent({type: 'post', lane: 'blotato', meta: {}});
  try {
    const response = await fetch('https://mcp.blotato.com/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'blotato-api-key': blotatoKey,
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// === Postiz proxy — api.postiz.com/public/v1 ============================
// Auth: header `Authorization: <api-key>` (no Bearer prefix). OAuth tokens
// start with `pos_` and use the same header. Self-hosted swap-out: change
// POSTIZ_BASE_URL env var (defaults to cloud).
const POSTIZ_BASE_URL = process.env.POSTIZ_BASE_URL || 'https://api.postiz.com/public/v1';

app.get('/api/postiz/integrations', async (req, res) => {
  const apiKey = req.headers['x-postiz-key'] || process.env.POSTIZ_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'Postiz API key required' });
  try {
    const r = await fetch(`${POSTIZ_BASE_URL}/integrations`, {
      headers: { 'Authorization': apiKey },
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/postiz/find-slot/:id', async (req, res) => {
  const apiKey = req.headers['x-postiz-key'] || process.env.POSTIZ_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'Postiz API key required' });
  try {
    const r = await fetch(`${POSTIZ_BASE_URL}/find-slot/${encodeURIComponent(req.params.id)}`, {
      headers: { 'Authorization': apiKey },
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Upload media from any http(s) URL — server fetches the source URL, forwards
// to Postiz /upload as multipart. Returns {id, path} ready to drop into a
// post's image array. Native Node 20 Blob + FormData (no extra deps).
app.post('/api/postiz/upload-from-url', async (req, res) => {
  const apiKey = req.headers['x-postiz-key'] || process.env.POSTIZ_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'Postiz API key required' });
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const mediaRes = await fetch(url);
    if (!mediaRes.ok) return res.status(502).json({ error: `source fetch failed: HTTP ${mediaRes.status}` });
    const ab = await mediaRes.arrayBuffer();
    const mimeType = mediaRes.headers.get('content-type') || 'application/octet-stream';
    const filename = (url.split('?')[0].split('/').pop() || 'upload.bin').slice(0, 120);
    const blob = new Blob([ab], { type: mimeType });
    const form = new FormData();
    form.append('file', blob, filename);
    const r = await fetch(`${POSTIZ_BASE_URL}/upload`, {
      method: 'POST',
      headers: { 'Authorization': apiKey },
      body: form,
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Schedule / now / draft. Body shape follows Postiz openapi.json verbatim —
// see PostizNode in CanvasView.jsx for client assembly. We don't transform.
app.post('/api/postiz/schedule', async (req, res) => {
  const apiKey = req.headers['x-postiz-key'] || process.env.POSTIZ_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'Postiz API key required' });
  // Tag-at-birth: callers may attach a `breadstick` sideband ({lane, angle})
  // that is OURS — strip it before forwarding, then log it together with the
  // post ids Postiz returns so performance pulls can attribute back to
  // lane + angle. Logged only on success — a failed schedule is not a post.
  const { forwardBody, sideband } = extractBreadstickMeta(req.body);
  try {
    console.log('[Postiz] →', JSON.stringify(forwardBody, null, 2));
    const r = await fetch(`${POSTIZ_BASE_URL}/posts`, {
      method: 'POST',
      headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(forwardBody),
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { rawText: text }; }
    console.log('[Postiz] ←', r.status, JSON.stringify(data, null, 2));
    if (!r.ok) return res.status(r.status).json(data);
    const meta = buildPostMeta(sideband, forwardBody, data);
    if (meta.postizPostIds.length === 0) {
      // Postiz can answer 2xx with an empty array even though the post was
      // created — that post is then invisible to the nightly perf pull.
      console.warn('[Postiz] ⚠ schedule OK but response carried no post ids — ledger event marked POSTIZ_ID_MISSING. Raw:', text.slice(0, 500));
    }
    logEvent({type: 'post', lane: sideband.lane || 'postiz', meta});
    res.json(data);
  } catch (err) {
    console.error('[Postiz] exception:', err);
    res.status(500).json({ error: err.message });
  }
});

// === Scoreboard — performance ledger ====================================
//
// data/perf/*.jsonl holds per-post snapshots pulled from whatever source can
// answer (Postiz post state today; vidiq / TikTok-Studio CSV adapters later).
// The nightly cron walks the activity ledger's recent type:'post' events and
// snapshots every known Postiz post id. Read access mirrors the activity
// ledger so the two join on postId.

app.get('/api/perf', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to ISO timestamps required' });
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return res.status(400).json({ error: 'from/to must be ISO-8601 timestamps' });
  }
  const events = readPerfWindow(new Date(from).toISOString(), new Date(to).toISOString());
  res.json({ count: events.length, events });
});

async function pullPostizPerformance() {
  const apiKey = process.env.POSTIZ_API_KEY;
  if (!apiKey) return { pulled: 0, errors: ['POSTIZ_API_KEY missing'] };
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 3600 * 1000);
  const postEvents = readWindow(from.toISOString(), to.toISOString())
    .filter((ev) => ev.type === 'post' && Array.isArray(ev.meta?.postizPostIds) && ev.meta.postizPostIds.length);
  // Postiz's public API has no GET /posts/:id — only the windowed list
  // (probed 2026-06-11). One list call covers everything: publishDate can sit
  // in the future for scheduled posts, so the window spans both directions.
  let byId = {};
  const errors = [];
  try {
    const startDate = new Date(to.getTime() - 30 * 24 * 3600 * 1000).toISOString();
    const endDate = new Date(to.getTime() + 30 * 24 * 3600 * 1000).toISOString();
    const r = await fetch(
      `${POSTIZ_BASE_URL}/posts?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
      { headers: { 'Authorization': apiKey } }
    );
    if (!r.ok) return { pulled: 0, errors: [`posts list: HTTP ${r.status}`] };
    const list = await r.json();
    byId = Object.fromEntries((list.posts || []).map((p) => [p.id, p]));
  } catch (err) {
    return { pulled: 0, errors: [`posts list: ${err.message}`] };
  }

  let pulled = 0;
  for (const ev of postEvents) {
    for (const postId of ev.meta.postizPostIds) {
      const post = byId[postId];
      if (!post) { errors.push(`${postId}: not in Postiz window`); continue; }
      logPerf({
        postId,
        lane: ev.meta.lane || ev.lane,
        angle: ev.meta.angle,
        source: 'postiz',
        state: post.state || null,
        // Postiz exposes post state, not platform metrics — views/saves
        // columns arrive via the vidiq + CSV adapters (Phase 2b).
        metrics: {},
        meta: { releaseURL: post.releaseURL || null, publishDate: post.publishDate || null },
      });
      pulled++;
    }
  }
  console.log(`[scoreboard] perf pull: ${pulled} snapshot(s), ${errors.length} error(s)`);
  return { pulled, errors };
}

// Manual trigger — same code path as the nightly cron, so a missed night is
// recoverable on demand (node-cron has no catch-up, same as proactive).
app.post('/api/perf/pull', async (req, res) => {
  try {
    res.json(await pullPostizPerformance());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve rendered carousel slides as static files
app.use('/carousels', express.static(join(__dirname, 'carousels', 'workspace')));

// Carousel renderer — accepts config + image URLs, downloads images, runs render.py, returns slide paths
app.post('/api/carousel/render', async (req, res) => {
  const { name, config, imageUrls } = req.body;
  if (!config || !name) return res.status(400).json({ error: 'name and config required' });

  logEvent({type: 'carousel', lane: 'carousel', meta: {}});

  const workDir = join(__dirname, 'carousels', 'workspace', name);
  const refDir = join(workDir, 'reference');

  try {
    await mkdir(workDir, { recursive: true });
    await mkdir(refDir, { recursive: true });

    // Download images from URLs into workspace
    const downloadResults = [];
    if (imageUrls?.length) {
      await Promise.all(imageUrls.map(async (url, i) => {
        if (!url) { downloadResults.push({ i, status: 'skipped' }); return; }
        try {
          console.log(`  Downloading art_${i + 1}: ${url.substring(0, 80)}...`);
          const imgRes = await fetch(url);
          if (!imgRes.ok) { downloadResults.push({ i, status: `http-${imgRes.status}` }); return; }
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          const ext = url.includes('.jpg') ? '.jpg' : '.png';
          const filePath = join(workDir, `art_${i + 1}${ext}`);
          await writeFile(filePath, buffer);
          downloadResults.push({ i, status: 'ok', bytes: buffer.length });
          console.log(`  Saved art_${i + 1}${ext} (${buffer.length} bytes)`);
        } catch (err) {
          downloadResults.push({ i, status: `error: ${err.message}` });
          console.log(`  Failed art_${i + 1}: ${err.message}`);
        }
      }));
    }
    console.log('Download results:', JSON.stringify(downloadResults));

    // Write config.json
    await writeFile(join(workDir, 'config.json'), JSON.stringify(config, null, 2));

    // Run render.py
    const renderResult = await new Promise((resolve, reject) => {
      execFile('python', [join(__dirname, 'carousels', 'render.py'), workDir], { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });

    // List rendered slides
    const files = await readdir(workDir);
    const slides = files.filter(f => f.startsWith('slide_') && f.endsWith('.png')).sort();
    const slideUrls = slides.map(f => `/carousels/${name}/${f}`);

    // Load art zone metadata written by render.py — compositor needs these to cut the right hole
    let zones = {};
    try {
      const raw = await readFile(join(workDir, 'zones.json'), 'utf-8');
      zones = JSON.parse(raw);
    } catch {}

    res.json({ success: true, slides: slideUrls, zones, output: renderResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── FFmpeg Color Grade — applies color grading to video clips ──

app.post('/api/ffmpeg/grade', async (req, res) => {
  const { videoUrl, settings, name } = req.body;
  // settings: { contrast, saturation, warmth, shadowR, shadowG, shadowB, highlightR, highlightG, highlightB, grain, sharpness }
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl required' });

  const outDir = join(__dirname, 'renders', 'graded');
  await mkdir(outDir, { recursive: true });
  const outName = name || `grade_${Date.now()}`;
  const outPath = join(outDir, `${outName}.mp4`);
  const tempPath = join(outDir, `_temp_${outName}.mp4`);

  try {
    // Download video if remote URL
    let inputPath = videoUrl;
    if (videoUrl.startsWith('http')) {
      console.log(`[ffmpeg] Downloading: ${videoUrl.substring(0, 80)}...`);
      const dlRes = await fetch(videoUrl);
      if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`);
      const buf = Buffer.from(await dlRes.arrayBuffer());
      await writeFile(tempPath, buf);
      inputPath = tempPath;
      console.log(`[ffmpeg] Downloaded ${buf.length} bytes`);
    }

    // Build ffmpeg filter chain from preset + settings
    // Values map to CapCut-style adjustments scaled to ffmpeg ranges
    const s = settings || {};
    const filters = [];

    // Color balance (shadows / midtones / highlights tinting)
    const sR = s.shadowR ?? 0, sG = s.shadowG ?? 0, sB = s.shadowB ?? 0;
    const mR = s.midR ?? 0, mG = s.midG ?? 0, mB = s.midB ?? 0;
    const hR = s.highlightR ?? 0, hG = s.highlightG ?? 0, hB = s.highlightB ?? 0;
    if (sR || sG || sB || mR || mG || mB || hR || hG || hB) {
      filters.push(`colorbalance=rs=${sR}:gs=${sG}:bs=${sB}:rm=${mR}:gm=${mG}:bm=${mB}:rh=${hR}:gh=${hG}:bh=${hB}`);
    }

    // Color temperature (warmth): negative = cooler, positive = warmer
    const warmth = s.warmth ?? 0;
    if (warmth) {
      filters.push(`colortemperature=temperature=${6500 + warmth * 3000}`);
    }

    // Tint: shifts green ↔ magenta via midtone green channel
    const tint = s.tint ?? 0;
    if (tint) {
      // Positive tint = more magenta (reduce green), negative = more green
      filters.push(`colorbalance=gm=${-tint}`);
    }

    // EQ: exposure (brightness), contrast, saturation
    const exposure = s.exposure ?? 0;
    const contrast = s.contrast ?? 1.0;
    const saturation = s.saturation ?? 1.0;
    if (contrast !== 1.0 || saturation !== 1.0 || exposure !== 0) {
      filters.push(`eq=contrast=${contrast}:saturation=${saturation}:brightness=${exposure}`);
    }

    // Highlight recovery + Shadow lift via curves
    const highlight = s.highlight ?? 0; // negative = compress highlights
    const shadow = s.shadow ?? 0;       // positive = lift shadows
    const fade = s.fade ?? 0;           // positive = lift black point
    if (highlight || shadow || fade) {
      // Build curves control points: shadows/0-0.25, mids/0.5, highlights/0.75-1.0
      const blackPt = fade > 0 ? (fade * 0.06).toFixed(3) : '0';      // fade lifts the black point
      const shadowPt = shadow ? (0.25 + shadow * 0.002).toFixed(3) : '0.25'; // shadow +18 → 0.286
      const highPt = highlight ? (0.75 + highlight * 0.002).toFixed(3) : '0.75'; // highlight -35 → 0.68
      filters.push(`curves=m=0/${blackPt} 0.25/${shadowPt} 0.75/${highPt} 1/1`);
    }

    // Sharpness
    const sharp = s.sharpness ?? 0;
    if (sharp > 0) {
      filters.push(`unsharp=5:5:${sharp}:5:5:0`);
    }

    // Film grain
    const grain = s.grain ?? 0;
    if (grain > 0) {
      filters.push(`noise=c0s=${grain}:c0f=t`);
    }

    const filterStr = filters.length > 0 ? filters.join(',') : 'null';

    console.log(`[ffmpeg] Grading with: ${filterStr}`);

    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-y', '-i', inputPath,
        '-vf', filterStr,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
        '-c:a', 'copy',
        outPath,
      ], { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.split('\n').slice(-3).join(' ') || err.message));
        else resolve(stdout);
      });
    });

    // Clean up temp
    if (existsSync(tempPath)) {
      const { unlink } = await import('fs/promises');
      await unlink(tempPath).catch(() => {});
    }

    const publicUrl = `/renders/graded/${outName}.mp4`;
    console.log(`[ffmpeg] Done: ${publicUrl}`);
    res.json({ success: true, url: publicUrl });
  } catch (err) {
    if (existsSync(tempPath)) {
      const { unlink } = await import('fs/promises');
      await unlink(tempPath).catch(() => {});
    }
    console.error('[ffmpeg] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PopBeats — inject pop sounds at motion-graphic event timestamps ───────
//
// FFmpeg pattern: asplit the chosen pop into N copies, adelay each to its
// trigger timestamp, amix back into the original audio with dropout_transition=0
// to keep the original volume consistent through each pop.
const POP_SOUNDS_DIR = join(__dirname, 'pipeline', 'sounds', 'pops');
const POP_SOUND_PRESETS = ['subtle', 'sharp', 'soft'];
function resolvePopSound(sound) {
  if (!sound) return join(POP_SOUNDS_DIR, 'subtle.mp3');
  if (POP_SOUND_PRESETS.includes(sound)) return join(POP_SOUNDS_DIR, `${sound}.mp3`);
  // Treat as a path — absolute, project-relative, or /renders/... served
  if (sound.startsWith('/renders/')) return join(__dirname, sound.slice(1));
  if (existsSync(sound)) return sound;
  // Fallback to subtle if we can't resolve
  console.warn(`[pop-beats] Could not resolve sound "${sound}", falling back to subtle`);
  return join(POP_SOUNDS_DIR, 'subtle.mp3');
}

app.post('/api/pop-beats', async (req, res) => {
  const { videoUrl, pops, sound, gainDb, name } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl required' });
  if (!Array.isArray(pops) || pops.length === 0) {
    return res.status(400).json({ error: 'pops must be a non-empty array of timestamps in seconds' });
  }
  // Sanitize: positive numbers, dedupe, sort ascending. Convert to ms for adelay.
  const timestampsMs = [...new Set(
    pops.map(t => Number(t)).filter(t => Number.isFinite(t) && t >= 0)
  )].sort((a, b) => a - b).map(t => Math.round(t * 1000));
  if (timestampsMs.length === 0) {
    return res.status(400).json({ error: 'No valid timestamps after parsing' });
  }

  const outDir = join(__dirname, 'renders', 'popped');
  await mkdir(outDir, { recursive: true });
  const outName = name || `popped_${Date.now()}`;
  const outPath = join(outDir, `${outName}.mp4`);
  const tempPath = join(outDir, `_temp_${outName}.mp4`);
  const popPath = resolvePopSound(sound);

  if (!existsSync(popPath)) {
    return res.status(500).json({ error: `Pop sound not found at ${popPath}. Did you generate the placeholders in pipeline/sounds/pops/?` });
  }

  try {
    // Resolve input — download if remote http, or treat as filesystem path.
    let inputPath = videoUrl;
    if (videoUrl.startsWith('http')) {
      console.log(`[pop-beats] Downloading: ${videoUrl.substring(0, 80)}...`);
      const dlRes = await fetch(videoUrl);
      if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`);
      const buf = Buffer.from(await dlRes.arrayBuffer());
      await writeFile(tempPath, buf);
      inputPath = tempPath;
    } else if (videoUrl.startsWith('/renders/')) {
      inputPath = join(__dirname, videoUrl.slice(1));
    }

    // Build the dynamic filter graph. For N pops:
    //   [1:a]asplit=N[p1][p2]...[pN];
    //   [p1]adelay=T1|T1[d1]; ... [pN]adelay=TN|TN[dN];
    //   [0:a][d1][d2]...[dN]amix=inputs=N+1:duration=first:dropout_transition=0,volume=<gain>[a]
    const N = timestampsMs.length;
    const splitLabels = Array.from({ length: N }, (_, i) => `p${i + 1}`).map(s => `[${s}]`).join('');
    const delayChain = timestampsMs
      .map((ms, i) => `[p${i + 1}]adelay=${ms}|${ms}[d${i + 1}]`)
      .join(';');
    const mixInputs = ['[0:a]', ...timestampsMs.map((_, i) => `[d${i + 1}]`)].join('');
    const gainFilter = (typeof gainDb === 'number' && gainDb !== 0)
      ? `,volume=${gainDb}dB`
      : '';
    const filterComplex = [
      `[1:a]asplit=${N}${splitLabels}`,
      delayChain,
      `${mixInputs}amix=inputs=${N + 1}:duration=first:dropout_transition=0${gainFilter}[a]`,
    ].join(';');

    console.log(`[pop-beats] ${N} pops at [${timestampsMs.map(m => (m / 1000).toFixed(2)).join(', ')}]s using ${popPath.split(/[\\/]/).pop()}`);

    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-y', '-i', inputPath, '-i', popPath,
        '-filter_complex', filterComplex,
        '-map', '0:v', '-map', '[a]',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
        outPath,
      ], { timeout: 180000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.split('\n').slice(-5).join(' ') || err.message));
        else resolve(stdout);
      });
    });

    if (existsSync(tempPath)) {
      const { unlink } = await import('fs/promises');
      await unlink(tempPath).catch(() => {});
    }

    const publicUrl = `/renders/popped/${outName}.mp4`;
    console.log(`[pop-beats] Done: ${publicUrl}`);
    res.json({ success: true, url: publicUrl, popCount: N, sound: popPath.split(/[\\/]/).pop() });
  } catch (err) {
    if (existsSync(tempPath)) {
      const { unlink } = await import('fs/promises');
      await unlink(tempPath).catch(() => {});
    }
    console.error('[pop-beats] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Stacked Video — vstack/hstack composer for split-frame edits ──────────
//
// Two input videos, scaled and padded to preserve aspect within their panel,
// then vstacked (top+bottom) or hstacked (left+right). Audio routed per the
// audioMode flag. Sync mode controls how mismatched durations are handled.
app.post('/api/stack-video', async (req, res) => {
  const {
    topUrl, bottomUrl,
    orientation = 'vertical',  // 'vertical' | 'horizontal'
    width = 1080, height = 1920,
    audioMode = 'top',  // 'top' | 'bottom' | 'mix' | 'none'
    syncMode = 'shortest',  // 'shortest' | 'loop-shorter' | 'hold-last'
    fit = 'contain',  // 'contain' = letterbox (preserve full source, pad bars) | 'cover' = crop to fill (no bars, may lose edges)
    padColor = 'black',
    name,
  } = req.body;
  if (!topUrl || !bottomUrl) {
    return res.status(400).json({ error: 'topUrl and bottomUrl both required' });
  }

  const outDir = join(__dirname, 'renders', 'stacked');
  await mkdir(outDir, { recursive: true });
  const outName = name || `stacked_${Date.now()}`;
  const outPath = join(outDir, `${outName}.mp4`);
  const tempA = join(outDir, `_tempA_${outName}.mp4`);
  const tempB = join(outDir, `_tempB_${outName}.mp4`);

  // Resolve a video URL/path to a local filesystem path. Downloads remote URLs
  // to a temp file. Kept inline so both downloads share the same logic.
  async function resolveInput(url, tempPath) {
    if (url.startsWith('http')) {
      const dl = await fetch(url);
      if (!dl.ok) throw new Error(`Download failed for ${url.substring(0, 60)}: ${dl.status}`);
      const buf = Buffer.from(await dl.arrayBuffer());
      await writeFile(tempPath, buf);
      return tempPath;
    }
    if (url.startsWith('/renders/')) return join(__dirname, url.slice(1));
    return url;
  }

  try {
    const inputA = await resolveInput(topUrl, tempA);
    const inputB = await resolveInput(bottomUrl, tempB);

    // Per-panel dimensions. Vertical = top/bottom, each W x H/2.
    // Horizontal = left/right, each W/2 x H.
    const panelW = orientation === 'horizontal' ? Math.floor(width / 2) : width;
    const panelH = orientation === 'horizontal' ? height : Math.floor(height / 2);
    const stackOp = orientation === 'horizontal' ? 'hstack' : 'vstack';

    // Per-panel scaling. Two modes:
    //   contain (default): scale to fit panel preserving aspect, pad bars to fill.
    //     Safe — never crops content. Mismatched aspects show pad-color bars.
    //   cover: scale to fill panel preserving aspect, crop excess to W:H exactly.
    //     Fills the panel — no bars — but loses content at the edges that doesn't
    //     fit the panel aspect. Right choice when source aspect differs from
    //     panel aspect AND content edges are expendable (centered subject).
    const fitFilter = (idx, label) => fit === 'cover'
      ? `[${idx}:v]scale=${panelW}:${panelH}:force_original_aspect_ratio=increase,crop=${panelW}:${panelH}[${label}]`
      : `[${idx}:v]scale=${panelW}:${panelH}:force_original_aspect_ratio=decrease,pad=${panelW}:${panelH}:(ow-iw)/2:(oh-ih)/2:${padColor}[${label}]`;
    const scalePadA = fitFilter(0, 't');
    const scalePadB = fitFilter(1, 'b');
    const stackFilter = `[t][b]${stackOp}=inputs=2[v]`;

    // Audio routing
    let audioMap = [];
    let audioFilter = '';
    if (audioMode === 'top') {
      audioMap = ['-map', '0:a?'];
    } else if (audioMode === 'bottom') {
      audioMap = ['-map', '1:a?'];
    } else if (audioMode === 'mix') {
      audioFilter = `;[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0[a]`;
      audioMap = ['-map', '[a]'];
    } else {
      // none — no audio map
      audioMap = ['-an'];
    }

    const filterComplex = [scalePadA, scalePadB, stackFilter].join(';') + audioFilter;

    // Sync mode → input flags. shortest is the simplest; loop-shorter requires
    // pre-detection of which input is shorter (skip for v1, use -shortest); hold-last
    // uses tpad on the shorter input (also skip for v1 — both are P1 polish).
    const extraFlags = (syncMode === 'shortest' || syncMode === 'loop-shorter' || syncMode === 'hold-last')
      ? ['-shortest']  // v1: all sync modes degrade to shortest until P1
      : [];

    console.log(`[stack-video] ${orientation} ${width}x${height}, fit=${fit}, audio=${audioMode}, sync=${syncMode}`);

    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-y',
        '-i', inputA, '-i', inputB,
        '-filter_complex', filterComplex,
        '-map', '[v]',
        ...audioMap,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
        '-c:a', 'aac', '-b:a', '192k',
        ...extraFlags,
        outPath,
      ], { timeout: 600000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.split('\n').slice(-5).join(' ') || err.message));
        else resolve(stdout);
      });
    });

    // Cleanup temp downloads
    const { unlink } = await import('fs/promises');
    if (existsSync(tempA)) await unlink(tempA).catch(() => {});
    if (existsSync(tempB)) await unlink(tempB).catch(() => {});

    const publicUrl = `/renders/stacked/${outName}.mp4`;
    console.log(`[stack-video] Done: ${publicUrl}`);
    res.json({ success: true, url: publicUrl, orientation, width, height, fit, audioMode, syncMode });
  } catch (err) {
    const { unlink } = await import('fs/promises');
    if (existsSync(tempA)) await unlink(tempA).catch(() => {});
    if (existsSync(tempB)) await unlink(tempB).catch(() => {});
    console.error('[stack-video] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── FFmpeg chroma-key + composite (Tier 1 character-over-slide) ──────────

app.post('/api/ffmpeg/chroma-composite', async (req, res) => {
  const {
    characterUrl,
    backgroundUrl,
    keyColor = '0x00FF00',
    similarity = 0.1,
    blend = 0.05,
    posX = 0,
    posY = 0,
    scale = 1.0,
    name,
  } = req.body;
  if (!characterUrl) return res.status(400).json({ error: 'characterUrl required' });

  const outDir = join(__dirname, 'renders', 'chroma');
  await mkdir(outDir, { recursive: true });
  const outName = name || `chroma_${Date.now()}`;
  const outPath = join(outDir, `${outName}.png`);
  const tempChar = join(outDir, `_char_${outName}.png`);
  const tempBg = join(outDir, `_bg_${outName}.png`);

  const downloadTo = async (url, dest) => {
    // Support both remote http URLs and local /renders/... paths
    if (url.startsWith('http')) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Download failed (${r.status}): ${url.slice(0, 60)}...`);
      await writeFile(dest, Buffer.from(await r.arrayBuffer()));
      return dest;
    }
    // Local path — map /carousels/... or /renders/... onto filesystem
    const cleanUrl = url.replace(/^\//, '');
    const localPath = join(__dirname, cleanUrl);
    if (existsSync(localPath)) return localPath;
    throw new Error(`Local file not found: ${localPath}`);
  };

  const cleanup = async () => {
    const { unlink } = await import('fs/promises');
    for (const p of [tempChar, tempBg]) {
      if (existsSync(p)) await unlink(p).catch(() => {});
    }
  };

  try {
    const charPath = await downloadTo(characterUrl, tempChar);
    const bgPath = backgroundUrl ? await downloadTo(backgroundUrl, tempBg) : null;

    // Normalize key color to ffmpeg-friendly format
    const keyHex = keyColor.startsWith('#') ? '0x' + keyColor.slice(1) : keyColor;

    let ffArgs;
    if (bgPath) {
      // Composite: chromakey the character, scale, overlay on background
      const filterComplex = `[1:v]chromakey=${keyHex}:${similarity}:${blend},scale=iw*${scale}:-1[char];[0:v][char]overlay=${posX}:${posY}`;
      ffArgs = ['-y', '-i', bgPath, '-i', charPath, '-filter_complex', filterComplex, outPath];
      console.log(`[chroma] Composite: ${keyHex} sim=${similarity} blend=${blend} scale=${scale} pos=${posX},${posY}`);
    } else {
      // Chroma only — output transparent PNG.
      // format=rgba forces PNG encoder to keep the alpha channel; without it,
      // FFmpeg may negotiate back to an alpha-less format during scale and
      // flatten the transparency, producing a PNG that looks identical to input.
      const vf = `chromakey=${keyHex}:${similarity}:${blend},scale=iw*${scale}:-1,format=rgba`;
      ffArgs = ['-y', '-i', charPath, '-vf', vf, outPath];
      console.log(`[chroma] Extract: ${keyHex} sim=${similarity} blend=${blend} scale=${scale}`);
    }

    await new Promise((resolve, reject) => {
      execFile('ffmpeg', ffArgs, { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.split('\n').slice(-3).join(' ') || err.message));
        else resolve(stdout);
      });
    });

    await cleanup();
    const publicUrl = `/renders/chroma/${outName}.png`;
    console.log(`[chroma] Done: ${publicUrl}`);
    res.json({ success: true, url: publicUrl });
  } catch (err) {
    await cleanup();
    console.error('[chroma] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ChromaStylize — greenscreen video → effect preset → transparent .webm ──
// Reverse-bokeh sibling of chroma-composite: input is a video shot against a
// solid chroma backdrop (green by default, magenta for 16-GAMI per
// feedback_chroma_prompt_tuning). FFmpeg chromakeys out the backdrop, then a
// preset filter chain stylizes the foreground while preserving alpha. Output
// is VP9 yuva420p .webm so Cartesian Composer can drop it on top of any base.
//
// Three v1 presets:
//   glitch        — rgbashift (R/B channel split), intensity-scaled 2..16 px
//   pixel-dither  — pixelate via neighbor scale ÷N ×N, intensity-scaled 2..16x
//   crt-scanline  — geq per-row darken (alpha-preserving) + slight rgbashift
//
// VP9 alpha gotcha: -auto-alt-ref 0 is REQUIRED or alpha is silently dropped.
// Same trap as Remotion's transparent=false default — see project_skyframe_5beat
// and feedback_offthread_video_transparent.
app.post('/api/ffmpeg/chroma-stylize', async (req, res) => {
  const {
    videoUrl,
    keyColor = '#00FF00',
    similarity = 0.25,
    blend = 0.08,
    preset = 'glitch',
    intensity = 0.5,
    scale = 1.0,
    name,
  } = req.body || {};
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl required' });

  const VALID_PRESETS = new Set(['glitch', 'pixel-dither', 'crt-scanline']);
  if (!VALID_PRESETS.has(preset)) {
    return res.status(400).json({ error: `preset must be one of: ${[...VALID_PRESETS].join(', ')}` });
  }

  const outDir = join(__dirname, 'renders', 'chroma-stylize');
  await mkdir(outDir, { recursive: true });
  const outName = name || `cstyl_${Date.now()}_${preset}`;
  const outPath = join(outDir, `${outName}.webm`);

  // Resolve input — http URL → download; local path → read directly.
  // Mirrors the chroma-composite pattern but for video instead of image.
  let inputPath;
  let tempIn = null;
  try {
    if (videoUrl.startsWith('http')) {
      // Try to keep the extension so ffmpeg auto-detects container; fall back
      // to .mp4 since most upstream nodes emit mp4.
      const urlNoQuery = videoUrl.split('?')[0];
      const ext = urlNoQuery.match(/\.(mp4|mov|webm|mkv)$/i)?.[0] || '.mp4';
      tempIn = join(outDir, `_in_${outName}${ext}`);
      const r = await fetch(videoUrl);
      if (!r.ok) throw new Error(`Download failed (${r.status})`);
      await writeFile(tempIn, Buffer.from(await r.arrayBuffer()));
      inputPath = tempIn;
    } else {
      const cleanUrl = videoUrl.replace(/^\//, '');
      const candidate = join(__dirname, cleanUrl);
      if (existsSync(candidate)) {
        inputPath = candidate;
      } else if (existsSync(videoUrl)) {
        // Absolute filesystem path (matches Bokeh/VideoSource localPath emissions)
        inputPath = videoUrl;
      } else {
        throw new Error(`Local video not found: ${candidate}`);
      }
    }

    const keyHex = keyColor.startsWith('#') ? '0x' + keyColor.slice(1) : keyColor;
    const t = Math.max(0, Math.min(1, Number(intensity) || 0));

    // Preset filter chains — every chain must end with alpha intact. The outer
    // wrapper appends `format=yuva420p` to lock the pixel format the VP9
    // encoder requires, so each chain only needs to preserve alpha mid-flight.
    let presetFilter;
    if (preset === 'glitch') {
      const shift = Math.max(1, Math.round(2 + t * 14));
      presetFilter = `rgbashift=rh=${shift}:bh=-${shift}:gh=0`;
    } else if (preset === 'pixel-dither') {
      const pix = Math.max(2, Math.round(2 + t * 14));
      // Round down to nearest integer block then scale back up with neighbor
      // sampling for crisp 16-bit pixelation. trunc(...)*2 keeps both dims
      // even so yuva420p chroma subsampling doesn't reject the output.
      presetFilter =
        `scale=trunc(iw/${pix}/2)*2:trunc(ih/${pix}/2)*2:flags=neighbor,` +
        `scale=iw*${pix}:ih*${pix}:flags=neighbor`;
    } else {
      // crt-scanline — darken every other row, preserve alpha verbatim.
      // strength 0.30..0.65 darken on even rows feels CRT-ish without
      // crushing detail. Slight rgbashift adds phosphor fringing.
      const darken = (0.30 + t * 0.35).toFixed(2);
      const keep = (1 - parseFloat(darken)).toFixed(2);
      const shift = Math.max(1, Math.round(1 + t * 4));
      presetFilter =
        `format=rgba,` +
        `geq=r='r(X,Y)*(${keep}+${darken}*mod(Y,2))':` +
        `g='g(X,Y)*(${keep}+${darken}*mod(Y,2))':` +
        `b='b(X,Y)*(${keep}+${darken}*mod(Y,2))':` +
        `a='alpha(X,Y)',` +
        `rgbashift=rh=${shift}:bh=-${shift}`;
    }

    const scaleClause = scale && Math.abs(scale - 1.0) > 0.01
      ? `scale=trunc(iw*${scale}/2)*2:trunc(ih*${scale}/2)*2,`
      : '';
    const vf = `chromakey=${keyHex}:${similarity}:${blend},${scaleClause}${presetFilter},format=yuva420p`;

    const ffArgs = [
      '-y', '-i', inputPath,
      '-vf', vf,
      '-c:v', 'libvpx-vp9',
      '-pix_fmt', 'yuva420p',
      '-auto-alt-ref', '0',  // VP9 alpha requires this — known gotcha
      '-b:v', '2M',
      '-deadline', 'good',
      '-cpu-used', '2',
      '-an',  // overlay layer: audio comes from base track downstream
      outPath,
    ];

    console.log(`[chroma-stylize] ${preset} t=${t.toFixed(2)} key=${keyHex} sim=${similarity}`);

    await new Promise((resolve, reject) => {
      execFile('ffmpeg', ffArgs, { timeout: 300000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.split('\n').slice(-4).join(' ') || err.message));
        else resolve(stdout);
      });
    });

    if (tempIn && existsSync(tempIn)) {
      const { unlink } = await import('fs/promises');
      await unlink(tempIn).catch(() => {});
    }

    const publicUrl = `/renders/chroma-stylize/${outName}.webm`;
    console.log(`[chroma-stylize] Done: ${publicUrl}`);
    res.json({ success: true, url: publicUrl, preset });
  } catch (err) {
    if (tempIn && existsSync(tempIn)) {
      const { unlink } = await import('fs/promises');
      await unlink(tempIn).catch(() => {});
    }
    console.error('[chroma-stylize] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve rendered compositor outputs
app.use('/renders', express.static(join(__dirname, 'renders')));
// Serve public/ at root — includes paint.html tracing tool + comp-work assets
app.use(express.static(join(__dirname, 'public')));

// Remotion compositor — composites video into carousel slide art zone
// Accepts pairs of { slideUrl, videoUrl } and renders each via Remotion CLI
app.post('/api/remotion/composite', async (req, res) => {
  const { pairs, name } = req.body;
  // pairs: [{ slideUrl: '/carousels/.../slide_1.png', videoUrl: 'https://kie.ai/...' }]
  if (!pairs?.length || !name) return res.status(400).json({ error: 'pairs and name required' });

  logEvent({type: 'video', lane: 'remotion', meta: {}});

  const workDir = join(__dirname, 'public', 'comp-work', name);
  const outDir = join(__dirname, 'renders', name);

  try {
    await mkdir(workDir, { recursive: true });
    await mkdir(outDir, { recursive: true });

    const results = [];
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const slideIdx = i + 1;
      const slideFile = `slide_${slideIdx}_cutout.png`;
      const videoFile = `video_${slideIdx}.mp4`;
      const outputFile = `composite_${slideIdx}.mp4`;

      try {
        // 1. Get the slide PNG — it's served locally from carousels/workspace/
        // slideUrl is like '/carousels/<name>/slide_1.png' → maps to carousels/workspace/<name>/slide_1.png
        const slideLocalPath = join(__dirname, 'carousels', 'workspace', pair.slideUrl.replace(/^\/carousels\//, ''));

        // 2. Create cutout (transparent art zone) using Python.
        // Zone comes from render.py zones.json (passed via pair.artZone), or defaults to
        // the legacy 696x696 1:1 square for back-compat with carousels rendered before aspect support.
        const artZone = pair.artZone || { x: 192, y: 182, w: 696, h: 696 };
        const x1 = Math.round(artZone.x);
        const y1 = Math.round(artZone.y);
        const x2 = Math.round(artZone.x + artZone.w);
        const y2 = Math.round(artZone.y + artZone.h);
        const cutoutPath = join(workDir, slideFile);
        await new Promise((resolve, reject) => {
          const pyScript = `
import sys
from PIL import Image
import numpy as np

img = Image.open(sys.argv[1]).convert('RGBA')
arr = np.array(img)
x1, y1 = ${x1}, ${y1}
x2, y2 = ${x2}, ${y2}
arr[y1:y2, x1:x2, 3] = 0
Image.fromarray(arr).save(sys.argv[2])
print('ok')
`;
          const pyPath = join(workDir, `_cutout_${slideIdx}.py`);
          writeFile(pyPath, pyScript).then(() => {
            execFile('python', [pyPath, slideLocalPath, cutoutPath], { timeout: 15000 }, (err, stdout, stderr) => {
              if (err) reject(new Error(stderr || err.message));
              else resolve(stdout);
            });
          });
        });

        // 3. Download video from CDN
        const videoLocalPath = join(workDir, videoFile);
        console.log(`  Downloading video ${slideIdx}: ${pair.videoUrl.substring(0, 80)}...`);
        const videoRes = await fetch(pair.videoUrl);
        if (!videoRes.ok) throw new Error(`Video download failed: ${videoRes.status}`);
        const videoBuf = Buffer.from(await videoRes.arrayBuffer());
        await writeFile(videoLocalPath, videoBuf);
        console.log(`  Saved ${videoFile} (${videoBuf.length} bytes)`);

        // 4. Assets already written to workDir, which IS inside public/comp-work/,
        // so Remotion staticFile() can reach them without a copy step.

        // 5. Render via Remotion CLI — memoized by composition + asset bytes + artZone.
        // The cutout PNG (cutoutPath) and downloaded video (videoLocalPath) are the
        // real inputs; hashing their bytes keys the cache correctly (paths alone would
        // collide across runs that reuse the same workDir).
        const outputPath = join(outDir, outputFile);
        const key = renderCache.keyFor([
          'CarouselVideoSlide', artZone,
          renderCache.hashFile(cutoutPath),
          renderCache.hashFile(videoLocalPath),
        ]);
        const { cached } = await renderCache.run({
          cacheDir: join(__dirname, 'public', 'render-cache'), key, ext: 'mp4', outputPath,
          render: async (target) => {
            const propsObj = {
              slidePath: `comp-work/${name}/${slideFile}`,
              videoPath: `comp-work/${name}/${videoFile}`,
              artZone,
            };
            const propsFile = join(workDir, `props_${slideIdx}.json`);
            await writeFile(propsFile, JSON.stringify(propsObj));
            console.log(`  Rendering composite ${slideIdx}...`);
            await withRemotionBrowserRetry(() => new Promise((resolve, reject) => {
              execFile('npx', [
                'remotion', 'render', 'src/remotion/index.jsx', 'CarouselVideoSlide',
                '--output', target,
                '--props', propsFile,
              ], { cwd: __dirname, timeout: 120000, shell: true }, (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve(stdout);
              });
            }), 'carousel-video-slide');
          },
        });

        results.push({ index: slideIdx, status: 'done', url: `/renders/${name}/${outputFile}`, cached });
        console.log(`  Composite ${slideIdx} ${cached ? 'cache hit' : 'done'}: ${outputFile}`);
      } catch (err) {
        console.error(`  Composite ${slideIdx} failed:`, err.message);
        results.push({ index: slideIdx, status: 'error', error: err.message });
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Terminal slide animator — Stage 3 of the terminal carousel trio ──
//
// Takes a static terminal_body slide PNG + the terminal zone (from zones.json)
// + the terminal content config + a palette, and renders a typing-animation
// mp4 via the TerminalCarouselSlide Remotion composition. Output is a single
// mp4 per slide that can be posted as Reels.
app.post('/api/remotion/animate-terminal', notViaTunnel, localBrowserOnly, async (req, res) => {
  const { slidePath, terminalZone, terminal, palette, name, slideIdx, templateId } = req.body;
  if (!slidePath || !terminalZone || !terminal || !name) {
    return res.status(400).json({ error: 'slidePath, terminalZone, terminal, and name required' });
  }
  // Resolve palette from templateId if not passed explicitly
  let resolvedPalette = palette;
  if (!resolvedPalette && templateId) {
    try {
      const tplPath = join(__dirname, 'carousels', 'templates', `${templateId}.json`);
      const tpl = JSON.parse(await readFile(tplPath, 'utf-8'));
      const colors = tpl.colors?.dark || tpl.colors?.light || {};
      resolvedPalette = {
        bg: colors.bg, text: colors.text, muted: colors.text_muted,
        accent: colors.accent, border: colors.border,
      };
    } catch {}
  }
  const idx = slideIdx || 1;
  const workDir = join(__dirname, 'public', 'comp-work', name);
  const outDir = join(__dirname, 'renders', name);
  try {
    await mkdir(workDir, { recursive: true });
    await mkdir(outDir, { recursive: true });

    // slidePath can be: absolute, '/carousels/<name>/slide_N.png', or just 'slide_N.png' relative to a workspace
    const sourceSlide = slidePath.startsWith('/') || /^[A-Z]:/.test(slidePath)
      ? slidePath.replace(/^\/carousels\//, join(__dirname, 'carousels', 'workspace') + '/')
      : join(__dirname, 'carousels', 'workspace', name, slidePath);
    const slideFile = `terminal_slide_${idx}.png`;
    const stagedSlide = join(workDir, slideFile);
    await copyFile(sourceSlide, stagedSlide);

    // Duration from content (chars/40 per second + 0.3s pause/line + 1.5s tail).
    // Mirrors the timing in TerminalCarouselSlide.jsx. With chrome baked into
    // the static slide (terminal_msg / win95_msg zones), only message lines type.
    const fps = 30;
    const charsPerSec = 40;
    const linePause = 0.3;
    const tail = 1.5;
    const messageOnly = terminalZone.aspect === 'terminal_msg' || terminalZone.aspect === 'win95_msg';
    let dur = 0;
    const add = (text) => { if (text) dur += Math.max(0.15, text.length / charsPerSec) + linePause; };
    if (!messageOnly) {
      add(terminal.header);
      add(terminal.subtitle);
      add(terminal.cwd);
      if (terminal.prompt) add(`> ${terminal.prompt}`);
    }
    for (const line of (terminal.lines || [])) add(line.text || '');
    dur += tail;
    const durationFrames = Math.max(60, Math.ceil(dur * fps));

    const propsObj = {
      slidePath: `comp-work/${name}/${slideFile}`,
      terminalZone,
      terminal,
      palette: resolvedPalette || { bg: '#0a0a0f', text: '#e8e8e8', muted: '#777799', accent: '#5588ff', border: '#2a2a44' },
    };
    const propsFile = join(workDir, `props_terminal_${idx}.json`);
    await writeFile(propsFile, JSON.stringify(propsObj));

    const outputFile = `terminal_${idx}.mp4`;
    const outputPath = join(outDir, outputFile);
    console.log(`[animate-terminal] rendering ${name}/${outputFile} (${durationFrames} frames, ${dur.toFixed(1)}s)...`);

    await withRemotionBrowserRetry(() => new Promise((resolve, reject) => {
      execFile('npx', [
        'remotion', 'render', 'src/remotion/index.jsx', 'TerminalCarouselSlide',
        '--output', outputPath,
        '--props', propsFile,
        '--frames', `0-${durationFrames - 1}`,
      ], { cwd: __dirname, timeout: 600000, shell: true }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    }), 'animate-terminal');

    console.log(`[animate-terminal] done: ${outputFile}`);
    res.json({ success: true, url: `/renders/${name}/${outputFile}`, durationFrames, durationSec: dur });
  } catch (err) {
    console.error('[animate-terminal] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Skyframe single-effect renderer — Block 1 of the endgame build plan ──
//
// Renders ONE Skyframe component (RayBanIntro / KaraokeCard / CompactCard /
// Win95Terminal / OpusGlisten / AsciiPlanet) at full-frame transparent for
// `durationSec` seconds. Output is a VP9 yuva420p .webm so alpha survives
// (per the SKILL.md gotcha — mp4 silently drops alpha even when ffprobe
// claims yuv420p). The Cartesian Composer's `hyperframes` asset type
// consumes these URLs unchanged via its content-pool handle.
//
// Cached by sha1(component + JSON.stringify(props) + durationSec) so the
// SkyframePickerNode's "Render all" is instant on unchanged slots.
const SKYFRAME_ALLOWED_COMPONENTS = new Set([
  'RayBanIntro', 'KaraokeCard', 'CompactCard',
  'Win95Terminal', 'OpusGlisten', 'AsciiPlanet',
]);

app.post('/api/remotion/skyframe-effect', async (req, res) => {
  const { component, props = {}, durationSec } = req.body || {};
  if (!component || !SKYFRAME_ALLOWED_COMPONENTS.has(component)) {
    return res.status(400).json({
      error: `component must be one of: ${[...SKYFRAME_ALLOWED_COMPONENTS].join(', ')}`,
    });
  }
  const dur = Number(durationSec);
  if (!Number.isFinite(dur) || dur < 0.5 || dur > 30) {
    return res.status(400).json({ error: 'durationSec must be a number between 0.5 and 30' });
  }

  const fps = 30;
  const durationFrames = Math.max(15, Math.round(dur * fps));

  const outDir = join(__dirname, 'public', 'skyframe');
  const key = renderCache.keyFor(['SkyframeSingleEffect', component, props, dur]);
  const outputFile = `${key}.webm`;
  const publicUrl = `/skyframe/${outputFile}`;

  try {
    // No outputPath → the cache file IS the served output (parity with the old
    // inline cache). The browser cache-busts via the unique key filename.
    const { cached } = await renderCache.run({
      cacheDir: outDir, key, ext: 'webm',
      render: async (target) => {
        const propsObj = {
          effectType: component,
          props,
          durationInFrames: durationFrames,   // consumed by calculateMetadata in Root.jsx
        };
        const propsFile = join(outDir, `${key}.props.json`);
        await writeFile(propsFile, JSON.stringify(propsObj));
        console.log(`[skyframe-effect] rendering ${component} (${durationFrames} frames, ${dur.toFixed(1)}s) → ${outputFile}`);
        await withRemotionBrowserRetry(() => new Promise((resolve, reject) => {
          execFile('npx', [
            'remotion', 'render', 'src/remotion/index.jsx', 'SkyframeSingleEffect',
            '--output', target,
            '--props', propsFile,
            '--frames', `0-${durationFrames - 1}`,
            '--codec', 'vp9',
            '--pixel-format', 'yuva420p',
            '--image-format', 'png',     // required pair with yuva420p — jpeg can't carry alpha
          ], { cwd: __dirname, timeout: 300000, shell: true }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout);
          });
        }), 'skyframe-effect');
        unlink(propsFile).catch(() => {});
      },
    });

    console.log(`[skyframe-effect] ${cached ? 'cache hit' : 'done'}: ${outputFile}`);
    res.json({
      success: true,
      url: publicUrl,
      cacheKey: key,
      cached,
      durationFrames,
      durationSec: dur,
    });
  } catch (err) {
    console.error('[skyframe-effect] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Chroma Composite Motion — Tier 2 (animated character over slide via Remotion) ──

app.post('/api/remotion/chroma-motion', async (req, res) => {
  const { backgroundUrl, characterUrl, motion, shadow, durationSec, name } = req.body;
  if (!backgroundUrl || !characterUrl || !name) {
    return res.status(400).json({ error: 'backgroundUrl, characterUrl, and name required' });
  }

  const workDir = join(__dirname, 'public', 'chroma-motion', name);
  const outDir = join(__dirname, 'renders', 'chroma-motion');

  try {
    await mkdir(workDir, { recursive: true });
    await mkdir(outDir, { recursive: true });

    // Download or copy assets into public/chroma-motion/<name>/
    const downloadTo = async (url, filename) => {
      const localPath = join(workDir, filename);
      // If url is a local /renders/... path, resolve to filesystem
      if (url.startsWith('/')) {
        const srcAbs = join(__dirname, url.replace(/^\//, ''));
        const buf = await readFile(srcAbs);
        await writeFile(localPath, buf);
      } else {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Download failed (${r.status}): ${url.slice(0, 80)}`);
        const buf = Buffer.from(await r.arrayBuffer());
        await writeFile(localPath, buf);
      }
      return localPath;
    };

    await downloadTo(backgroundUrl, 'background.png');
    await downloadTo(characterUrl, 'character.png');

    const fps = 30;
    const totalSec = typeof durationSec === 'number' && durationSec > 0 ? Math.min(30, Math.max(3, durationSec)) : 8;
    const durationInFrames = Math.round(totalSec * fps);

    const propsObj = {
      backgroundPath: `chroma-motion/${name}/background.png`,
      characterPath: `chroma-motion/${name}/character.png`,
      motion: motion || { entry: 'slide-right', exit: 'slide-left', entryDurationS: 0.8, exitDurationS: 0.8, holdScale: 1.0, holdX: 0, holdY: 0 },
      shadow: shadow || { enabled: true, blur: 30, offsetY: 20, opacity: 0.5 },
    };
    const propsFile = join(workDir, 'props.json');
    await writeFile(propsFile, JSON.stringify(propsObj));

    const outputFile = `${name}.mp4`;
    const outputPath = join(outDir, outputFile);

    console.log(`  Chroma motion rendering (${totalSec}s @ ${fps}fps = ${durationInFrames} frames)...`);
    await withRemotionBrowserRetry(() => new Promise((resolve, reject) => {
      execFile('npx', [
        'remotion', 'render', 'src/remotion/index.jsx', 'ChromaCompositeMotion',
        '--output', outputPath,
        '--props', propsFile,
        '--frames', `0-${durationInFrames - 1}`,
      ], { cwd: __dirname, timeout: 240000, shell: true }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    }), 'chroma-motion');

    res.json({ success: true, url: `/renders/chroma-motion/${outputFile}`, durationSec: totalSec });
  } catch (err) {
    console.error('chroma-motion render failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Cartesian Composer — timed overlays at exact pixel coordinates over a base video ──
//
// Stages the base video into public/cartesian-composite/<name>/base.mp4 so
// Remotion can read it via staticFile(). Zone content URLs (image/video/
// hyperframes) pass through unchanged — Chromium fetches them at render time.
// Output dimensions follow the base video; ffprobe sets width/height/duration
// unless the caller overrides them.
app.post('/api/remotion/cartesian-composite', async (req, res) => {
  const { videoUrl, zones, name, fps: bodyFps, durationSec: bodyDur, width: bodyW, height: bodyH, baseLoop } = req.body;
  if (!videoUrl || !name) {
    return res.status(400).json({ error: 'videoUrl and name required' });
  }
  if (!Array.isArray(zones)) {
    return res.status(400).json({ error: 'zones must be an array' });
  }
  // Server-version marker — bump if you change the staging logic so it's
  // obvious from the console which build is loaded after a server restart.
  console.log(`[cartesian-composite] request received: ${zones.length} zones, base=${videoUrl.slice(0, 60)} (server v2026-04-30b: server-relative URL fix)`);

  const safeName = String(name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  const workDir = join(__dirname, 'public', 'cartesian-composite', safeName);
  const outDir = join(__dirname, 'renders', 'cartesian-composite');

  try {
    await mkdir(workDir, { recursive: true });
    await mkdir(outDir, { recursive: true });

    // Stage the base video — download if HTTP(s), copy if local path.
    const baseLocal = join(workDir, 'base.mp4');
    if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
      const r = await fetch(videoUrl);
      if (!r.ok) throw new Error(`Base video fetch failed (${r.status}): ${videoUrl.slice(0, 100)}`);
      const buf = Buffer.from(await r.arrayBuffer());
      await writeFile(baseLocal, buf);
    } else {
      const srcAbs = videoUrl.startsWith('/') && !/^[A-Z]:/.test(videoUrl)
        ? join(__dirname, videoUrl.replace(/^\//, ''))
        : videoUrl;
      if (!existsSync(srcAbs)) throw new Error(`Base video not found: ${srcAbs}`);
      await copyFile(srcAbs, baseLocal);
    }

    // ffprobe — JSON output is far more reliable than CSV. We pull
    //   - stream width/height/duration (codec-level)
    //   - format duration (container-level)
    // and use the SMALLER of the two durations when both exist. That guards
    // against the "container claims 14s but frames stop at 8s" failure mode
    // that produces a frozen tail in OffthreadVideo.
    let probeDur = 0, probeW = 0, probeH = 0, isImage = false;
    try {
      const out = await new Promise((resolve, reject) => {
        execFile('ffprobe', [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height,duration,codec_name,codec_type:format=duration,format_name',
          '-of', 'json',
          baseLocal,
        ], (err, stdout) => err ? reject(err) : resolve(stdout.trim()));
      });
      const probe = JSON.parse(out);
      const stream = (probe.streams || [])[0] || {};
      probeW = Number(stream.width) || 0;
      probeH = Number(stream.height) || 0;
      const streamDur = parseFloat(stream.duration);
      const formatDur = parseFloat((probe.format || {}).duration);
      const durs = [streamDur, formatDur].filter(d => Number.isFinite(d) && d > 0);
      probeDur = durs.length ? Math.min(...durs) : 0;
      // Treat as image if codec is one of the still-image codecs OR the
      // container is image2/png/mjpeg/etc OR there's no measurable duration.
      const codec = String(stream.codec_name || '').toLowerCase();
      const fmt = String((probe.format || {}).format_name || '').toLowerCase();
      const imageCodecs = ['mjpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif'];
      if (imageCodecs.includes(codec) || fmt.includes('image2') || fmt.includes('png_pipe') || fmt.includes('jpeg_pipe')) {
        isImage = true;
      }
      // Also catch by extension on the original videoUrl, in case probe codec
      // was indeterminate. Still .gif / animated webp will be flagged and
      // rendered via <Img> — they animate naturally inside Remotion's <Img>
      // when the runtime supports it (otherwise show frame 0).
      const extMatch = String(videoUrl).match(/\.(jpg|jpeg|png|webp|gif|bmp|tiff?|avif)(\?|#|$)/i);
      if (extMatch) isImage = true;
    } catch (probeErr) {
      console.warn('[cartesian-composite] ffprobe failed:', probeErr.message);
    }

    const fps = Number(bodyFps) || 30;
    const width = Number(bodyW) || probeW || 1920;
    const height = Number(bodyH) || probeH || 1080;
    // Trust ffprobe's measured duration over the upstream caller's claim —
    // the canvas often reports 0 (VideoSourceNode never probes) or stale
    // values, while ffprobe reads the actual file. Caller can still force
    // an explicit duration via bodyDur.
    let durationSec;
    if (Number(bodyDur) > 0 && probeDur > 0) {
      // Both present — cap at the file's real duration to prevent freeze tail.
      durationSec = Math.min(Number(bodyDur), probeDur);
    } else {
      durationSec = probeDur || Number(bodyDur) || 10;
    }
    // Image base has no real duration — fall back to caller's claim or default.
    if (isImage) durationSec = Number(bodyDur) > 0 ? Number(bodyDur) : (Number(bodyDur) || 10);
    const durationFrames = Math.max(1, Math.ceil(durationSec * fps));

    // Stage every non-HTTP zone content into public/ so Remotion's
    // staticFile() can resolve it. Without this, an absolute Windows path
    // ("E:\renders\foo.png") or a project-relative path ("renders/foo.png")
    // would crash staticFile() inside the Remotion bundle. HTTP URLs pass
    // through — Chromium fetches them at render time.
    const stagedZones = await Promise.all(zones.map(async (zone, zi) => {
      const isMedia = zone.type === 'image' || zone.type === 'video' || zone.type === 'hyperframes';
      if (!isMedia || !zone.contentUrl) return zone;
      const u = String(zone.contentUrl).trim();
      if (u.startsWith('http://') || u.startsWith('https://')) return zone;
      // Path resolution priority:
      //   1. Server-relative URL ("/renders/...", "/public/...", "/carousels/...")
      //      — produced by Motion Bake, B-Roll render, Carousel render. The leading
      //      slash is an HTTP route prefix, NOT a filesystem path. Strip it and
      //      resolve against __dirname. Without this special-case, isUnixAbs below
      //      catches the path on Windows and treats it as an absolute fs path that
      //      doesn't exist — silently dropping the asset and breaking the render.
      //   2. Absolute Windows path ("E:\...", "C:/...") — drag-dropped local file.
      //   3. Absolute Unix path ("/Users/...") — Mac local file.
      //   4. Project-relative path ("renders/foo.png") — older callers.
      const isServerRelative = /^\/(renders|public|carousels)\//.test(u);
      const isWinAbs = /^[A-Za-z]:[\\/]/.test(u);
      const isUnixAbs = !isServerRelative && u.startsWith('/');
      let srcAbs;
      if (isServerRelative) {
        srcAbs = join(__dirname, u.replace(/^\//, ''));
      } else if (isWinAbs || isUnixAbs) {
        srcAbs = u;
      } else {
        srcAbs = join(__dirname, u);
      }
      if (!existsSync(srcAbs)) {
        console.warn(`[cartesian-composite] zone ${zi} content NOT FOUND: ${srcAbs} (input was "${u}") — leaving as-is, Remotion will fail this zone`);
        return zone;
      }
      const ext = (srcAbs.match(/\.([a-zA-Z0-9]{1,6})$/) || ['', 'bin'])[1].toLowerCase();
      const stagedName = `asset_${zi}.${ext}`;
      const stagedPath = join(workDir, stagedName);
      await copyFile(srcAbs, stagedPath);
      console.log(`[cartesian-composite] staged zone ${zi}: ${u} -> public/cartesian-composite/${safeName}/${stagedName}`);
      return { ...zone, contentUrl: `cartesian-composite/${safeName}/${stagedName}` };
    }));

    // Probe the inner duration of each video/hyperframes zone so the
    // renderer can use Remotion's <Loop durationInFrames> for deterministic
    // looping. OffthreadVideo's bare `loop` prop is unreliable for short
    // clips inside longer windows — Remotion can't always infer the file's
    // duration ahead of render. Failure → no innerDurationSec → renderer
    // falls back to the bare loop prop. ffprobe handles HTTP URLs natively
    // so the same code path covers staged + remote zones.
    const probedZones = await Promise.all(stagedZones.map(async (zone) => {
      if (zone.type !== 'video' && zone.type !== 'hyperframes') return zone;
      if (!zone.contentUrl) return zone;
      const u = String(zone.contentUrl).trim();
      const probeTarget = (u.startsWith('http://') || u.startsWith('https://'))
        ? u
        : join(__dirname, 'public', u);
      try {
        const probePromise = new Promise((resolve, reject) => {
          execFile('ffprobe', [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=duration:format=duration',
            '-of', 'json',
            probeTarget,
          ], (err, stdout) => err ? reject(err) : resolve(stdout));
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('zone probe timeout')), 8000));
        const out = await Promise.race([probePromise, timeoutPromise]);
        const probe = JSON.parse(out);
        const fmtDur = parseFloat((probe.format || {}).duration);
        const streamDur = parseFloat(((probe.streams || [])[0] || {}).duration);
        const durs = [fmtDur, streamDur].filter(d => Number.isFinite(d) && d > 0);
        const innerDurationSec = durs.length ? Math.min(...durs) : 0;
        if (innerDurationSec > 0) {
          return { ...zone, innerDurationSec };
        }
      } catch (err) {
        console.warn(`[cartesian-composite] zone ${zone.id || ''} probe failed: ${err.message}`);
      }
      return zone;
    }));

    // Props drive the composition's duration + dimensions via calculateMetadata
    // in Root.jsx — no CLI --frames / --width / --height needed once the comp
    // sizes itself from props.
    const propsObj = {
      baseVideoPath: `cartesian-composite/${safeName}/base.mp4`,
      durationSec, width, height, fps,
      isImage,
      baseLoop: !!baseLoop,
      zones: probedZones,
    };
    const propsFile = join(workDir, 'props.json');
    await writeFile(propsFile, JSON.stringify(propsObj));

    const outputFile = `${safeName}.mp4`;
    const outputPath = join(outDir, outputFile);
    console.log(`[cartesian-composite] rendering ${outputFile} (${width}x${height} @ ${fps}fps, ${durationFrames} frames, ${zones.length} zones, base=${isImage ? 'image' : 'video'}, baseLoop=${!!baseLoop})...`);

    await withRemotionBrowserRetry(() => new Promise((resolve, reject) => {
      execFile('npx', [
        'remotion', 'render', 'src/remotion/index.jsx', 'CartesianComposer',
        '--output', outputPath,
        '--props', propsFile,
      ], { cwd: __dirname, timeout: 30 * 60 * 1000, shell: true }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    }), 'cartesian-composite');

    console.log(`[cartesian-composite] done: ${outputFile}`);
    res.json({
      success: true,
      url: `/renders/cartesian-composite/${outputFile}`,
      width, height, fps, durationSec, durationFrames,
      isImage,
      probedDurationSec: probeDur,
      probedWidth: probeW,
      probedHeight: probeH,
      zoneCount: zones.length,
    });
  } catch (err) {
    console.error('[cartesian-composite] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Concept Composer ─────────────────────────────────────────────────────────
// Accepts raw webm/mp4 blob via POST, writes to public/concept-recordings/,
// returns the public URL.

const CONCEPT_RECORDINGS_DIR = join(__dirname, 'public', 'concept-recordings');

app.post(
  '/api/concept-composer/save',
  // 200MB ceiling: covers 5-min hard cap at 8 Mbps (~300MB worst case if VBR
  // overshoots, but realistic 30 FPS webm/vp9 + 60s soft cap = ~60MB).
  express.raw({ type: ['video/webm', 'video/mp4', 'application/octet-stream'], limit: '200mb' }),
  async (req, res) => {
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ error: 'empty body' });
    }
    const ext = (req.headers['content-type'] || '').includes('mp4') ? 'mp4' : 'webm';
    const propName = (req.query.prop || 'preview').replace(/[^a-zA-Z0-9-]/g, '');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${ts}_${propName}.${ext}`;
    const fullPath = join(CONCEPT_RECORDINGS_DIR, filename);

    if (!existsSync(CONCEPT_RECORDINGS_DIR)) {
      await mkdir(CONCEPT_RECORDINGS_DIR, { recursive: true });
    }

    writeFileSync(fullPath, req.body);
    const url = `/concept-recordings/${filename}`;
    console.log(`[concept-composer] saved ${req.body.length} bytes → ${url}`);
    res.json({ url, filename, size: req.body.length });
  }
);

app.get('/api/concept-composer/list', async (req, res) => {
  if (!existsSync(CONCEPT_RECORDINGS_DIR)) return res.json({ files: [] });
  const entries = await readdir(CONCEPT_RECORDINGS_DIR);
  const files = await Promise.all(
    entries
      .filter((f) => f.endsWith('.webm') || f.endsWith('.mp4'))
      .map(async (f) => {
        const s = await stat(join(CONCEPT_RECORDINGS_DIR, f));
        return { name: f, url: `/concept-recordings/${f}`, size: s.size, mtime: s.mtime };
      })
  );
  files.sort((a, b) => b.mtime - a.mtime);
  res.json({ files: files.slice(0, 50) });
});

// ── Hyperframes overlay render — HTML-authored caption/hook overlays burned over clips ──

function hfEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hyperframesCaptionHtml({ videoRelPath, caption, width, height, duration, position, accentColor }) {
  const isBottom = position !== 'top';
  const fontSize = Math.round(Math.min(width, height) / 17);
  const blockY = isBottom ? `bottom: ${Math.round(height * 0.09)}px;` : `top: ${Math.round(height * 0.09)}px;`;
  const markerY = isBottom ? `bottom: ${Math.round(height * 0.07)}px;` : `top: ${Math.round(height * 0.07)}px;`;
  const safeCaption = hfEscape(caption);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        margin: 0; width: ${width}px; height: ${height}px;
        overflow: hidden; background: #000;
        font-family: 'Arial Black', 'Impact', system-ui, sans-serif;
      }
      .clip-video {
        position: absolute; top: 0; left: 0;
        width: ${width}px; height: ${height}px;
        object-fit: cover;
      }
      .hook {
        position: absolute;
        left: 6%; right: 6%;
        ${blockY}
        text-align: center;
        color: #ffffff;
        font-size: ${fontSize}px;
        line-height: 1.06;
        font-weight: 900;
        letter-spacing: 0.01em;
        text-shadow: 0 4px 18px rgba(0,0,0,0.85);
      }
      .hook-inner {
        display: inline-block;
        background: linear-gradient(180deg, rgba(0,0,0,0.20), rgba(0,0,0,0.60));
        padding: 16px 24px;
        border-radius: 14px;
        border: 2px solid ${accentColor};
        box-shadow: 0 8px 32px rgba(0,0,0,0.50);
      }
      .marker {
        position: absolute;
        left: 15%;
        ${markerY}
        width: 70%;
        height: 6px;
        background: ${accentColor};
        border-radius: 3px;
        box-shadow: 0 0 12px ${accentColor};
        transform-origin: left center;
        transform: scaleX(0);
      }
    </style>
  </head>
  <body>
    <div id="root"
         data-composition-id="main"
         data-start="0"
         data-duration="${duration}"
         data-width="${width}"
         data-height="${height}">

      <video class="clip-video clip" id="hf-video-0" muted
             data-start="0"
             data-duration="${duration}"
             data-track-index="0"
             src="${videoRelPath}"></video>

      <div class="hook clip"
           id="hook-text"
           data-start="0.3"
           data-duration="${(duration - 0.3).toFixed(2)}"
           data-track-index="1">
        <span class="hook-inner">${safeCaption}</span>
      </div>

      <div class="marker clip"
           id="marker"
           data-start="0.5"
           data-duration="${(duration - 0.5).toFixed(2)}"
           data-track-index="2"></div>
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.from("#hook-text", { opacity: 0, y: 40, duration: 0.4, ease: "power2.out" }, 0);
      tl.to("#marker", { scaleX: 1, duration: 0.6, ease: "power3.out" }, 0.2);
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;
}

// ── Title Card: full-screen title + subtitle with accent underline ──
function hyperframesTitleCardHtml({ videoRelPath, title, subtitle, width, height, duration, accentColor }) {
  const titleSize = Math.round(Math.min(width, height) / 11);
  const subSize = Math.round(Math.min(width, height) / 22);
  const safeTitle = hfEscape(title);
  const safeSub = hfEscape(subtitle);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #000; font-family: 'Arial Black','Impact',system-ui,sans-serif; }
      .clip-video { position: absolute; top: 0; left: 0; width: ${width}px; height: ${height}px; object-fit: cover; }
      .veil { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.65) 100%); }
      .card { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 0 6%; color: #fff; text-align: center; }
      .title { font-size: ${titleSize}px; line-height: 1; font-weight: 900; letter-spacing: 0.02em; text-shadow: 0 6px 28px rgba(0,0,0,0.85); }
      .underline { margin: ${Math.round(titleSize * 0.35)}px 0; width: 40%; height: 5px; background: ${accentColor}; border-radius: 3px; box-shadow: 0 0 16px ${accentColor}; transform-origin: left center; transform: scaleX(0); }
      .subtitle { font-size: ${subSize}px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #e8e8e8; text-shadow: 0 3px 12px rgba(0,0,0,0.8); }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
      <video class="clip-video clip" id="hf-video-0" muted data-start="0" data-duration="${duration}" data-track-index="0" src="${videoRelPath}"></video>
      <div class="veil clip" data-start="0" data-duration="${duration}" data-track-index="1"></div>
      <div class="card clip" data-start="0" data-duration="${duration}" data-track-index="2">
        <div class="title" id="tc-title">${safeTitle}</div>
        <div class="underline" id="tc-underline"></div>
        <div class="subtitle" id="tc-subtitle">${safeSub}</div>
      </div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.from("#tc-title", { opacity: 0, y: 60, duration: 0.5, ease: "power3.out" }, 0.2);
      tl.to("#tc-underline", { scaleX: 1, duration: 0.5, ease: "power2.out" }, 0.6);
      tl.from("#tc-subtitle", { opacity: 0, y: 30, duration: 0.4, ease: "power2.out" }, 0.9);
      tl.to(".card", { opacity: 0, duration: 0.4, ease: "power2.in" }, ${(duration - 0.4).toFixed(2)});
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;
}

// ── Lower Third: slide-in name badge at bottom-left or bottom-right ──
function hyperframesLowerThirdHtml({ videoRelPath, name, role, side, width, height, duration, accentColor }) {
  const isLeft = side !== 'right';
  const nameSize = Math.round(Math.min(width, height) / 22);
  const roleSize = Math.round(Math.min(width, height) / 36);
  const xAnchor = isLeft ? `left: 4%;` : `right: 4%;`;
  const fromX = isLeft ? -320 : 320;
  const borderSide = isLeft ? 'border-left' : 'border-right';
  const safeName = hfEscape(name);
  const safeRole = hfEscape(role);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #000; font-family: 'Arial Black','Impact',system-ui,sans-serif; }
      .clip-video { position: absolute; top: 0; left: 0; width: ${width}px; height: ${height}px; object-fit: cover; }
      .l3 { position: absolute; ${xAnchor} bottom: 8%; padding: 14px 22px; background: rgba(10,10,15,0.78); ${borderSide}: 5px solid ${accentColor}; border-radius: 6px; color: #fff; box-shadow: 0 10px 32px rgba(0,0,0,0.6); }
      .l3-name { font-size: ${nameSize}px; font-weight: 900; letter-spacing: 0.02em; line-height: 1; }
      .l3-role { margin-top: 6px; font-size: ${roleSize}px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${accentColor}; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
      <video class="clip-video clip" id="hf-video-0" muted data-start="0" data-duration="${duration}" data-track-index="0" src="${videoRelPath}"></video>
      <div class="l3 clip" id="l3-box" data-start="0.3" data-duration="${(duration - 0.3).toFixed(2)}" data-track-index="1">
        <div class="l3-name">${safeName}</div>
        <div class="l3-role">${safeRole}</div>
      </div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.from("#l3-box", { x: ${fromX}, opacity: 0, duration: 0.5, ease: "power3.out" }, 0);
      tl.to("#l3-box", { x: ${fromX}, opacity: 0, duration: 0.4, ease: "power2.in" }, ${(duration - 0.7).toFixed(2)});
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;
}

// ── Highlight Sweep: caption with an animated accent bar sweeping under one target word ──
function hyperframesHighlightSweepHtml({ videoRelPath, caption, targetWord, direction, width, height, duration, position, accentColor }) {
  const isBottom = position !== 'top';
  const fontSize = Math.round(Math.min(width, height) / 17);
  const blockY = isBottom ? `bottom: ${Math.round(height * 0.09)}px;` : `top: ${Math.round(height * 0.09)}px;`;
  const fromXForm = direction === 'rtl' ? 'right center' : 'left center';
  const safeCaption = String(caption ?? '');
  // Split caption so the target word gets a span we can decorate.
  const target = String(targetWord ?? '').trim();
  let htmlized;
  if (target && safeCaption.toLowerCase().includes(target.toLowerCase())) {
    const regex = new RegExp(`(${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i');
    htmlized = safeCaption.split(regex).map((part, i) => {
      if (i % 2 === 1) return `<span class="hl-word"><span class="hl-sweep" id="hl-sweep"></span><span class="hl-text">${hfEscape(part)}</span></span>`;
      return hfEscape(part);
    }).join('');
  } else {
    // No match — treat the whole caption as the highlight target.
    htmlized = `<span class="hl-word"><span class="hl-sweep" id="hl-sweep"></span><span class="hl-text">${hfEscape(safeCaption)}</span></span>`;
  }
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #000; font-family: 'Arial Black','Impact',system-ui,sans-serif; }
      .clip-video { position: absolute; top: 0; left: 0; width: ${width}px; height: ${height}px; object-fit: cover; }
      .hook { position: absolute; left: 6%; right: 6%; ${blockY} text-align: center; color: #fff; font-size: ${fontSize}px; line-height: 1.08; font-weight: 900; letter-spacing: 0.01em; text-shadow: 0 4px 18px rgba(0,0,0,0.85); }
      .hl-word { position: relative; display: inline-block; padding: 2px 8px; }
      .hl-sweep { position: absolute; inset: 0; background: ${accentColor}; border-radius: 4px; transform-origin: ${fromXForm}; transform: scaleX(0); z-index: 0; }
      .hl-text { position: relative; z-index: 1; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
      <video class="clip-video clip" id="hf-video-0" muted data-start="0" data-duration="${duration}" data-track-index="0" src="${videoRelPath}"></video>
      <div class="hook clip" id="hl-caption" data-start="0.2" data-duration="${(duration - 0.2).toFixed(2)}" data-track-index="1">${htmlized}</div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.from("#hl-caption", { opacity: 0, y: 30, duration: 0.4, ease: "power2.out" }, 0);
      tl.to("#hl-sweep", { scaleX: 1, duration: 0.45, ease: "power3.out" }, 0.8);
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;
}

// ── Burst Lines: radial emphasis burst at a configurable timestamp ──
function hyperframesBurstLinesHtml({ videoRelPath, timestamp, density, width, height, duration, accentColor }) {
  const ts = Math.max(0, Math.min(parseFloat(timestamp) || 0.5, Math.max(duration - 0.1, 0.1)));
  const lineCount = density === 'high' ? 18 : density === 'low' ? 6 : 12;
  const radius = Math.round(Math.min(width, height) * 0.35);
  const lines = Array.from({ length: lineCount }, (_, i) => {
    const angle = (360 / lineCount) * i;
    return `<div class="burst-line" style="transform: rotate(${angle}deg); transform-origin: 0 50%;"></div>`;
  }).join('');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
      .clip-video { position: absolute; top: 0; left: 0; width: ${width}px; height: ${height}px; object-fit: cover; }
      .burst-wrap { position: absolute; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none; }
      .burst-line { position: absolute; left: 0; top: -3px; width: ${radius}px; height: 6px; background: ${accentColor}; border-radius: 3px; box-shadow: 0 0 16px ${accentColor}; opacity: 0; transform-origin: 0 50%; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
      <video class="clip-video clip" id="hf-video-0" muted data-start="0" data-duration="${duration}" data-track-index="0" src="${videoRelPath}"></video>
      <div class="burst-wrap clip" id="burst-wrap" data-start="${ts.toFixed(2)}" data-duration="${Math.min(1.0, duration - ts).toFixed(2)}" data-track-index="1">
        ${lines}
      </div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.fromTo(".burst-line", { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.35, ease: "power3.out", stagger: { each: 0.01, from: "random" } }, ${ts.toFixed(2)});
      tl.to(".burst-line", { opacity: 0, duration: 0.3, ease: "power2.in" }, ${(ts + 0.5).toFixed(2)});
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;
}

// Dispatch HTML generation by effect. Returns the composition HTML string.
function buildHyperframesHtml({ effect, videoRelPath, width, height, duration, accentColor, ...params }) {
  const common = { videoRelPath, width, height, duration, accentColor: accentColor || '#C9A227' };
  switch (effect) {
    case 'title-card':
      return hyperframesTitleCardHtml({ ...common, title: params.title || '', subtitle: params.subtitle || '' });
    case 'lower-third':
      return hyperframesLowerThirdHtml({ ...common, name: params.lowerName ?? params.name ?? '', role: params.role || '', side: params.side || 'left' });
    case 'highlight-sweep':
      return hyperframesHighlightSweepHtml({ ...common, caption: params.caption || '', targetWord: params.targetWord || '', direction: params.direction || 'ltr', position: params.position || 'bottom' });
    case 'burst-lines':
      return hyperframesBurstLinesHtml({ ...common, timestamp: params.timestamp, density: params.density || 'medium' });
    case 'hook-caption':
    default:
      return hyperframesCaptionHtml({ ...common, caption: params.caption || '', position: params.position || 'bottom' });
  }
}


app.post('/api/hyperframes/overlay-caption', async (req, res) => {
  const { videoUrl, name, quality } = req.body;
  const effect = req.body.effect || 'hook-caption';
  const accentColor = req.body.accentColor || '#C9A227';

  if (!videoUrl || !name) {
    return res.status(400).json({ error: 'videoUrl and name required' });
  }
  const validationError = validateHyperframesRequest(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const projectDir = join(__dirname, 'hyperframes', 'overlay-lab');
  const assetsDir = join(projectDir, 'assets');
  const outDir = join(__dirname, 'renders', 'hyperframes');
  const outputPath = join(outDir, `${name}.mp4`);
  const clipFilename = `${name}.mp4`;
  const clipPath = join(assetsDir, clipFilename);

  try {
    await mkdir(assetsDir, { recursive: true });
    await mkdir(outDir, { recursive: true });

    // Resolve input video — local path (served under /renders/... etc.) OR remote URL
    if (videoUrl.startsWith('/')) {
      const abs = join(__dirname, videoUrl.replace(/^\//, ''));
      await writeFile(clipPath, await readFile(abs));
    } else if (videoUrl.startsWith('http')) {
      const r = await fetch(videoUrl);
      if (!r.ok) throw new Error(`Video fetch failed ${r.status}`);
      await writeFile(clipPath, Buffer.from(await r.arrayBuffer()));
    } else {
      await writeFile(clipPath, await readFile(videoUrl));
    }

    // Probe dimensions + duration
    const probeRaw = await new Promise((resolve, reject) => {
      execFile('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', '-select_streams', 'v:0', clipPath],
        { timeout: 15000 }, (err, stdout) => err ? reject(err) : resolve(stdout));
    });
    const probe = JSON.parse(probeRaw);
    const stream = probe.streams?.[0] || {};
    const width = stream.width || 1080;
    const height = stream.height || 1920;
    const duration = parseFloat(probe.format?.duration || '10');

    // Auto-transcode check — Hyperframes/Puppeteer needs dense keyframes to seek
    // frame-accurately. Ray-Ban Meta, phones, and most real-world exports use
    // sparse GOPs (often every 40-60s). We detect and re-encode silently so
    // operators don't hit the "run this ffmpeg command yourself" wall.
    const keyframeTimes = await new Promise((resolve) => {
      execFile('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-skip_frame', 'nokey',
        '-show_entries', 'frame=pts_time',
        '-of', 'csv=p=0',
        clipPath,
      ], { timeout: 60000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
        if (err) { resolve([]); return; }
        const times = String(stdout || '').trim().split('\n').map(parseFloat).filter(t => !isNaN(t));
        resolve(times);
      });
    });
    let maxKeyframeInterval = 0;
    for (let i = 1; i < keyframeTimes.length; i++) {
      const gap = keyframeTimes[i] - keyframeTimes[i - 1];
      if (gap > maxKeyframeInterval) maxKeyframeInterval = gap;
    }
    const KEYFRAME_THRESHOLD = 5.0; // Hyperframes recommends <2s; 5s is the practical break-point
    if (keyframeTimes.length >= 2 && maxKeyframeInterval > KEYFRAME_THRESHOLD) {
      console.log(`[hyperframes] auto-transcoding: max keyframe interval ${maxKeyframeInterval.toFixed(1)}s exceeds ${KEYFRAME_THRESHOLD}s threshold (${keyframeTimes.length} keyframes in ${duration.toFixed(1)}s)`);
      const transcodedPath = join(assetsDir, `_transcoded_${clipFilename}`);
      await new Promise((resolve, reject) => {
        execFile('ffmpeg', [
          '-y', '-i', clipPath,
          '-c:v', 'libx264', '-r', '30', '-g', '30', '-keyint_min', '30',
          '-movflags', '+faststart',
          '-c:a', 'copy',
          transcodedPath,
        ], { timeout: 600000 }, (err, stdout, stderr) => {
          if (err) reject(new Error(`auto-transcode failed: ${(stderr || err.message || '').toString().slice(-400)}`));
          else resolve(stdout);
        });
      });
      // Replace original with transcoded version so the composition references the good file
      await writeFile(clipPath, await readFile(transcodedPath));
      await unlink(transcodedPath).catch(() => {});
      console.log(`[hyperframes] auto-transcode complete`);
    }

    const html = buildHyperframesHtml({
      effect,
      videoRelPath: `./assets/${clipFilename}`,
      width,
      height,
      duration,
      accentColor,
      ...req.body,
    });
    await writeFile(join(projectDir, 'index.html'), html);

    const label = effect === 'hook-caption' ? `caption="${String(req.body.caption || '').slice(0, 40)}"`
      : effect === 'title-card' ? `title="${String(req.body.title || '').slice(0, 30)}"`
      : effect === 'lower-third' ? `name="${String(req.body.name || '').slice(0, 30)}"`
      : effect === 'highlight-sweep' ? `sweep="${String(req.body.targetWord || '').slice(0, 20)}"`
      : effect === 'burst-lines' ? `@${req.body.timestamp || 0.5}s` : '';
    console.log(`  Hyperframes [${effect}] rendering (${width}x${height}, ${duration.toFixed(1)}s, ${label})...`);
    // Hyperframes prints progress + lint warnings to stdout, not stderr — capture
    // both and surface the last few KB so operators can self-diagnose. Timeout
    // bumped to 20 min so longer clips (up to ~3 min source) finish at standard quality.
    await new Promise((resolve, reject) => {
      execFile('npx', [
        'hyperframes', 'render',
        '--quality', quality || 'standard',
        '--output', outputPath,
      ], { cwd: projectDir, timeout: 1200000, shell: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          const tail = (s) => String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(-1200).trim();
          const out = tail(stdout);
          const errOut = tail(stderr);
          const detail = [errOut && `[stderr] ${errOut}`, out && `[stdout] ${out}`].filter(Boolean).join('\n\n') || err.message;
          reject(new Error(detail));
        } else {
          resolve(stdout);
        }
      });
    });

    res.json({ success: true, url: `/renders/hyperframes/${name}.mp4`, effect, width, height, duration });
  } catch (err) {
    console.error(`hyperframes [${effect}] render failed:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Motion Bake — script → per-beat motion graphics → asset-sequence payload ──
//
// Pipeline: Niche Script Gen → Motion Bake → Cartesian Composer. Outputs the
// same `{ type: 'asset-sequence', assets: [...] }` shape that the manual Asset
// Sequence node emits, so Cartesian's content-pool handle picks it up unchanged.
//
// Three endpoints, two-phase by design — planning is cheap (one Claude call,
// ~5s); rendering is expensive (~20-40s × N beats via the Hyperframes CLI).
// Splitting them lets the canvas show the plan for review/edit before the
// user commits to the bake.
//
//   GET  /api/motion-bake/templates  — catalog for the canvas dropdown
//   POST /api/motion-bake/plan       — script in, beats out (Claude split)
//   POST /api/motion-bake/render     — beats in, mp4 assets out (HF render)

app.get('/api/motion-bake/templates', (_req, res) => {
  res.json({ templates: MOTION_BAKE_CATALOG });
});

app.post('/api/motion-bake/plan', async (req, res) => {
  const { script, accentColor, apiKey: bodyKey } = req.body || {};
  if (!script || !String(script).trim()) return res.status(400).json({ error: 'script required' });
  const apiKey = bodyKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'ANTHROPIC_API_KEY not set' });

  // Compact catalog text for the prompt — full schema would inflate token use
  // for every plan call. Claude only needs id + description + field shape.
  const catalogText = MOTION_BAKE_CATALOG.map(t =>
    `- ${t.id}: ${t.label} — ${t.description}\n  fields: ${JSON.stringify(t.fields)}`
  ).join('\n');

  const system = `You're a motion-graphics editor splitting a script into beats. Each beat becomes one short motion-graphic OVERLAY shown on top of talking-head footage (the talking head keeps playing underneath; the overlay sits on top).

Templates available:
${catalogText}

RULES:
- Pick 3-7 high-impact moments from the script. Not every sentence needs a beat — overlay clutter kills retention.
- For each moment, pick the template that BEST fits the content and fill its required fields.
- Beat duration: 4-6 seconds typical. 3s minimum, 8s maximum.
- Keep template content punchy. Lower-thirds: 2-4 word names. Callouts: 3-8 word phrases. Stat slams: short labels (under 8 words).
- For terminal / code-reveal: use realistic monospace content (real commands, real snippets) — don't paraphrase the script into pseudo-code.
- The "label" field is for the operator to recognize the asset in the canvas — keep it 1-3 words.
- Reply with JSON ONLY, no prose, no markdown fences:
{ "beats": [ { "scriptText": "<segment from script>", "templateId": "<id>", "fields": { ... }, "durationSec": <number>, "label": "<1-3 word label>" } ] }`;

  const user = `SCRIPT:
${script}

Pick the beats. JSON only.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    const data = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const text = data.content?.[0]?.text || '';
    // Strip code-fence wrappers if Claude added them despite the JSON-only rule.
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
    let plan;
    try { plan = JSON.parse(cleaned); }
    catch (err) {
      return res.status(500).json({ error: `Could not parse plan JSON: ${err.message}`, raw: text });
    }

    // Validate every templateId exists; trim invalid beats rather than 500ing
    // the whole response (so a single bad pick doesn't kill the plan).
    plan.beats = (plan.beats || []).flatMap((beat, i) => {
      const tpl = MOTION_BAKE_TEMPLATES[beat.templateId];
      if (!tpl) {
        console.warn(`[motion-bake/plan] dropped beat ${i}: unknown template "${beat.templateId}"`);
        return [];
      }
      const dur = Math.min(Math.max(Number(beat.durationSec) || tpl.defaults.durationSec, 3), 8);
      return [{
        scriptText: beat.scriptText || '',
        templateId: beat.templateId,
        fields: beat.fields || {},
        durationSec: dur,
        label: beat.label || `Beat ${i + 1}`,
      }];
    });
    res.json({ success: true, plan, accentColor: accentColor || '#C9A227' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/motion-bake/render', async (req, res) => {
  const { name, beats, accentColor } = req.body || {};
  if (!name || !Array.isArray(beats) || beats.length === 0) {
    return res.status(400).json({ error: 'name + non-empty beats array required' });
  }

  const safeName = String(name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  const projectDir = join(__dirname, 'hyperframes', 'motion-bake');
  const outDir = join(__dirname, 'renders', 'motion-bake', safeName);
  const accent = accentColor || '#C9A227';

  try {
    await mkdir(outDir, { recursive: true });

    // Bakes are sequential — concurrent overwrite of the project's index.html
    // would race. For one job at a time this is fine; the canvas surfaces
    // per-beat status to the operator so they can see progress.
    const assets = [];
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const tpl = MOTION_BAKE_TEMPLATES[beat.templateId];
      if (!tpl) {
        console.warn(`[motion-bake/render] beat ${i}: unknown template "${beat.templateId}", skipping`);
        continue;
      }

      const html = tpl.render({
        ...beat.fields,
        width: tpl.defaults.width,
        height: tpl.defaults.height,
        durationSec: beat.durationSec || tpl.defaults.durationSec,
        accentColor: accent,
      });
      await writeFile(join(projectDir, 'index.html'), html);

      const outputFile = `beat_${String(i + 1).padStart(2, '0')}.mp4`;
      const outputPath = join(outDir, outputFile);

      console.log(`  Motion Bake [${beat.templateId}] beat ${i + 1}/${beats.length}: ${beat.label || ''}`);

      try {
        await new Promise((resolve, reject) => {
          execFile('npx', [
            'hyperframes', 'render',
            '--quality', 'standard',
            '--output', outputPath,
          ], { cwd: projectDir, timeout: 600000, shell: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
              const tail = (s) => String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(-800).trim();
              const detail = [tail(stderr) && `[stderr] ${tail(stderr)}`, tail(stdout) && `[stdout] ${tail(stdout)}`]
                .filter(Boolean).join('\n\n') || err.message;
              reject(new Error(detail));
            } else {
              resolve(stdout);
            }
          });
        });
      } catch (err) {
        console.error(`[motion-bake/render] beat ${i + 1} failed: ${err.message}`);
        // Push an error marker so the canvas can show which beat failed
        // without losing the successful ones above it in the list.
        assets.push({
          id: `mb_${safeName}_${i + 1}`,
          label: beat.label || `Beat ${i + 1}`,
          type: 'hyperframes',
          url: '',
          width: tpl.defaults.width,
          height: tpl.defaults.height,
          duration: beat.durationSec || tpl.defaults.durationSec,
          error: err.message,
        });
        continue;
      }

      // Probe for actual dims/duration so downstream Cartesian gets accurate
      // metadata for lock-aspect drag + Loop wrapper. Failure falls back to
      // the template defaults.
      let probedW = tpl.defaults.width, probedH = tpl.defaults.height;
      let probedDur = beat.durationSec || tpl.defaults.durationSec;
      try {
        const probe = await new Promise((resolve, reject) => {
          execFile('ffprobe', [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height,duration:format=duration',
            '-of', 'json',
            outputPath,
          ], (err, stdout) => err ? reject(err) : resolve(stdout));
        });
        const j = JSON.parse(probe);
        const s = (j.streams || [])[0] || {};
        if (s.width)  probedW = Number(s.width);
        if (s.height) probedH = Number(s.height);
        const fmtDur = parseFloat((j.format || {}).duration);
        if (Number.isFinite(fmtDur) && fmtDur > 0) probedDur = fmtDur;
      } catch (err) {
        console.warn(`[motion-bake/render] beat ${i + 1} probe failed: ${err.message}`);
      }

      assets.push({
        id: `mb_${safeName}_${i + 1}`,
        label: beat.label || `Beat ${i + 1}`,
        type: 'hyperframes',
        url: `/renders/motion-bake/${safeName}/${outputFile}`,
        width: probedW,
        height: probedH,
        duration: probedDur,
      });
    }

    res.json({ success: true, assets, beatCount: beats.length });
  } catch (err) {
    console.error('[motion-bake/render] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Cloudflare Tunnel — makes local images publicly accessible for external APIs ──
// Three modes:
//   1. external  — cloudflared runs as a Windows service (dashboard-managed tunnel).
//                  Set CLOUDFLARE_TUNNEL_HOSTNAME only. Server just trusts it.
//   2. named     — CLI-managed named tunnel spawned by us.
//                  Set CLOUDFLARE_TUNNEL_NAME + CLOUDFLARE_TUNNEL_HOSTNAME.
//   3. anonymous — on-demand trycloudflare.com URL, spawned via `cloudflared tunnel --url`.

let tunnelProcess = null;
let tunnelUrl = '';

// Detect externally-managed tunnel (service/dashboard). Hostname set without name.
const externalTunnelUrl = (() => {
  const host = process.env.CLOUDFLARE_TUNNEL_HOSTNAME;
  const name = process.env.CLOUDFLARE_TUNNEL_NAME;
  if (host && !name) return host.startsWith('http') ? host : `https://${host}`;
  return '';
})();
if (externalTunnelUrl) {
  tunnelUrl = externalTunnelUrl;
  console.log(`[tunnel] External-managed tunnel detected → ${tunnelUrl}`);
}

// Resolve cloudflared binary — check PATH, then common install locations
function findCloudflared() {
  const candidates = [
    'cloudflared',
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
    join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
  ];
  for (const c of candidates) {
    if (c === 'cloudflared') continue; // check PATH last via exec
    if (existsSync(c)) return c;
  }
  return 'cloudflared'; // hope it's on PATH
}

// Named tunnel config — set both in .env to enable stable subdomain.
// CLOUDFLARE_TUNNEL_NAME     = named tunnel created via `cloudflared tunnel create <name>`
// CLOUDFLARE_TUNNEL_HOSTNAME = full URL (with or without scheme), e.g. breadstick.example.com
function namedTunnelConfig() {
  const name = process.env.CLOUDFLARE_TUNNEL_NAME;
  const host = process.env.CLOUDFLARE_TUNNEL_HOSTNAME;
  if (!name || !host) return null;
  const url = host.startsWith('http') ? host : `https://${host}`;
  return { name, url };
}

app.post('/api/tunnel/start', async (req, res) => {
  // External-managed (cloudflared service) — always up, nothing to spawn
  if (externalTunnelUrl) {
    return res.json({
      active: true, url: externalTunnelUrl, mode: 'external',
      message: 'Tunnel is managed by the Cloudflare connector service. No spawn needed.',
    });
  }
  if (tunnelProcess) {
    const named = namedTunnelConfig();
    return res.json({
      active: true, url: tunnelUrl,
      mode: named ? 'named' : 'anonymous',
      message: 'Tunnel already running',
    });
  }

  const cfBin = findCloudflared();

  // Check if cloudflared is available
  try {
    await new Promise((resolve, reject) => {
      exec(`"${cfBin}" --version`, { timeout: 5000 }, (err) => err ? reject(err) : resolve());
    });
  } catch {
    return res.status(400).json({
      error: 'cloudflared not found. Run: winget install Cloudflare.cloudflared — then restart the server.',
    });
  }

  const named = namedTunnelConfig();
  const args = named
    ? ['tunnel', 'run', named.name]
    : ['tunnel', '--url', `http://localhost:${PORT}`];

  try {
    tunnelUrl = '';
    tunnelProcess = spawn(cfBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    tunnelProcess.on('exit', (code) => {
      console.log(`[tunnel] Process exited with code ${code}`);
      tunnelProcess = null;
      tunnelUrl = '';
    });

    // Resolve the public URL. For named tunnels, the hostname is known up-front —
    // we just wait for the first "Registered tunnel connection" log so we know it's live.
    // For anonymous, we parse stderr for the trycloudflare URL.
    const urlPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tunnel startup timeout (30s)')), 30000);
      const onData = (data) => {
        const text = data.toString();
        console.log('[tunnel]', text.trim());
        if (named) {
          if (/Registered tunnel connection|connection registered/i.test(text)) {
            clearTimeout(timeout);
            tunnelUrl = named.url;
            resolve(tunnelUrl);
          }
          return;
        }
        const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) {
          clearTimeout(timeout);
          tunnelUrl = match[0];
          resolve(tunnelUrl);
        }
      };
      tunnelProcess.stderr.on('data', onData);
      tunnelProcess.stdout.on('data', onData);
    });

    const url = await urlPromise;
    console.log(`[tunnel] Public URL: ${url} (${named ? 'named' : 'anonymous'})`);
    res.json({ active: true, url, mode: named ? 'named' : 'anonymous' });
  } catch (err) {
    if (tunnelProcess) { tunnelProcess.kill(); tunnelProcess = null; }
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tunnel/status', (req, res) => {
  if (externalTunnelUrl) {
    return res.json({ active: true, url: externalTunnelUrl, mode: 'external' });
  }
  const named = namedTunnelConfig();
  res.json({ active: !!tunnelProcess, url: tunnelUrl, mode: tunnelProcess && named ? 'named' : tunnelProcess ? 'anonymous' : null });
});

app.post('/api/tunnel/stop', (req, res) => {
  if (externalTunnelUrl) {
    return res.json({
      active: true, url: externalTunnelUrl, mode: 'external',
      message: 'Externally managed — stop via Windows Services or the Cloudflare dashboard.',
    });
  }
  if (tunnelProcess) {
    tunnelProcess.kill();
    tunnelProcess = null;
    tunnelUrl = '';
  }
  res.json({ active: false });
});

// Resolve a local image path to a public URL (tunnel or upload fallback)
app.post('/api/resolve-public-url', notViaTunnel, localBrowserOnly, async (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path required' });

  // If tunnel is active, serve via tunnel — instant, no upload needed
  if (tunnelUrl) {
    const publicUrl = `${tunnelUrl}/api/local-image?path=${encodeURIComponent(filePath)}`;
    return res.json({ url: publicUrl, method: 'tunnel' });
  }

  // Fallback: upload to external host (existing catbox/tmpfiles/0x0 chain)
  if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  try {
    const { readFile: rf } = await import('fs/promises');
    const fileBuffer = await rf(filePath);
    const fileName = filePath.split(/[\\/]/).pop();

    try {
      const form1 = new FormData();
      form1.append('reqtype', 'fileupload');
      form1.append('fileToUpload', new Blob([fileBuffer]), fileName);
      const r1 = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form1 });
      if (r1.ok) {
        const url = (await r1.text()).trim();
        if (url.startsWith('http')) return res.json({ url, method: 'catbox' });
      }
    } catch {}

    try {
      const form2 = new FormData();
      form2.append('file', new Blob([fileBuffer]), fileName);
      const r2 = await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: form2 });
      if (r2.ok) {
        const data = await r2.json();
        if (data.data?.url) {
          const url = data.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
          return res.json({ url, method: 'tmpfiles' });
        }
      }
    } catch {}

    const form3 = new FormData();
    form3.append('file', new Blob([fileBuffer]), fileName);
    const r3 = await fetch('https://0x0.st', { method: 'POST', body: form3 });
    if (!r3.ok) throw new Error('All upload services failed');
    const url = (await r3.text()).trim();
    res.json({ url, method: '0x0' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WhatsApp Cloud API — glasses → Breadstick → reply loop ────────────────

const GRAPH_API_VERSION = 'v21.0';

// Comma-separated E.164 numbers (no '+'). Empty = allow any sender.
const WHATSAPP_ALLOWED_NUMBERS = (process.env.WHATSAPP_ALLOWED_NUMBERS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Drive /Short form IN/ — mirrored from shortform-cli.js DRIVE_FOLDERS.shortformIn
const SHORTFORM_IN_FOLDER_ID = process.env.DRIVE_SHORTFORM_IN_FOLDER || '';

const SHORTFORM_CLI_PATH = join(__dirname, 'shortform-cli.js');
const PIPELINE_CLI_PATH = join(__dirname, 'pipeline-cli.js');
const WHATSAPP_INBOX = join(__dirname, 'pipeline', 'inbox');

// Transcribe an audio file via ElevenLabs Scribe v1 (same vendor as our TTS so
// we don't pull in another key). Returns plain text (no audio-event tags).
async function transcribeWithScribe(filePath, mimeType = 'audio/ogg') {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');
  const buf = await readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mimeType }), 'audio');
  form.append('model_id', 'scribe_v1');
  form.append('language_code', 'eng');
  form.append('tag_audio_events', 'false');
  const resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Scribe ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data.text || '').trim();
}

// Upload media to WhatsApp Cloud API → returns media id usable in send calls.
async function whatsappUploadMedia(filePath, mimeType) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error('WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set');
  const buf = await readFile(filePath);
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buf], { type: mimeType }), 'reply.mp3');
  const resp = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneId}/media`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form,
  });
  const data = await resp.json();
  if (!resp.ok || !data.id) {
    throw new Error(`WA media upload ${resp.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.id;
}

// Send an audio WhatsApp message by media id (uploaded via whatsappUploadMedia).
async function whatsappSendAudio(to, mediaId) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error('WHATSAPP env vars not set');
  const resp = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'audio',
      audio: { id: mediaId },
    }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`WA send audio ${resp.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.messages?.[0]?.id;
}

async function whatsappSend(to, text) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    console.error('[whatsapp] WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set');
    return { error: 'env vars missing' };
  }
  try {
    const resp = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text.slice(0, 4096) },
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error('[whatsapp] send failed:', data);
      return { error: data.error?.message || `HTTP ${resp.status}` };
    }
    return { id: data.messages?.[0]?.id };
  } catch (err) {
    console.error('[whatsapp] send error:', err);
    return { error: err.message };
  }
}

async function askClaudeForWhatsapp(userText) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return 'Anthropic key not set.';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: 'You are Breadstick — a personal AI agent the operator talks to through Meta Ray-Ban glasses via WhatsApp. Your reply is read aloud by Meta, so respond in under 220 characters. Be direct, useful, voice-friendly. No emoji. No markdown. No numbered lists. Natural spoken English.',
        messages: [{ role: 'user', content: userText }],
      }),
    });
    const data = await resp.json();
    if (data.error) return `Error: ${data.error.message || 'unknown'}`.slice(0, 220);
    return (data.content?.[0]?.text || 'No reply').slice(0, 1024);
  } catch (err) {
    return `Error: ${err.message}`.slice(0, 220);
  }
}

// ── Command router helpers ────────────────────────────────────────────────

// Kill a child process AND its descendants. Windows has no process groups, so
// child.kill() orphans grandchildren (ffmpeg/remotion/gws); taskkill /T tears
// down the whole tree. POSIX falls back to SIGKILL on the immediate child.
function treeKill(child) {
  if (!child || child.pid == null) return;
  if (process.platform === 'win32') {
    try {
      const tk = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      tk.on('error', () => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
      return;
    } catch { /* fall through to SIGKILL */ }
  }
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}

// Run a Node CLI (shortform-cli.js or pipeline-cli.js) and capture output.
// Optional { signal }: aborting it tree-kills the child mid-run (job cancel).
function runCli(scriptPath, args, timeoutMs = 1200000, { signal } = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', [scriptPath, ...args], {
      cwd: __dirname,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    const timer = setTimeout(() => { treeKill(child); }, timeoutMs);
    const onAbort = () => treeKill(child);
    if (signal) {
      if (signal.aborted) treeKill(child);
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const cleanup = () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); };
    child.on('exit', (code) => { cleanup(); resolve({ stdout, stderr, exitCode: code }); });
    child.on('error', (err) => { cleanup(); resolve({ stdout, stderr: err.message, exitCode: 1 }); });
  });
}

// Run the gws CLI (Google Workspace) and capture output.
function runGws(args, timeoutMs = 300000) {
  return new Promise((resolve) => {
    const child = spawn('gws', args, {
      cwd: __dirname, env: process.env, shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code }); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ stdout, stderr: err.message, exitCode: 1 }); });
  });
}

// Find the newest video in a Drive folder.
async function driveListNewestVideo(folderId) {
  const q = `'${folderId}' in parents and trashed = false`;
  const params = JSON.stringify({ q, fields: 'files(id,name,mimeType,createdTime)' });
  const r = await runGws(['drive', 'files', 'list', '--params', `"${params.replace(/"/g, '\\"')}"`], 30000);
  if (r.exitCode !== 0) return null;
  try {
    const parsed = JSON.parse(r.stdout);
    const videos = (parsed.files || []).filter(f =>
      f.mimeType?.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/i.test(f.name || '')
    );
    if (videos.length === 0) return null;
    videos.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
    return videos[0];
  } catch { return null; }
}

// Download a WhatsApp media attachment via Graph API (two-step).
async function downloadWhatsAppMedia(mediaId, outPath) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error('WHATSAPP_ACCESS_TOKEN not set');
  const metaResp = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const meta = await metaResp.json();
  if (!meta.url) throw new Error(`Media lookup failed: ${JSON.stringify(meta).slice(0, 200)}`);
  const fileResp = await fetch(meta.url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!fileResp.ok) throw new Error(`Media download failed: HTTP ${fileResp.status}`);
  const buf = Buffer.from(await fileResp.arrayBuffer());
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buf);
  return { size: buf.length, mimeType: meta.mime_type };
}

// quicktake prints the script between two 60-char ─ separator lines (shortform-cli.js:527).
function extractScriptFromStdout(stdout) {
  const sep = '─'.repeat(60);
  const parts = stdout.split(sep);
  return parts.length >= 3 ? parts[1].trim() : null;
}

function extractNotionUrl(stdout) {
  const m = stdout.match(/Notion:\s*(https:\/\/[^\s]+)/);
  return m ? m[1] : null;
}

function extractDriveFileUrl(stdout) {
  // shortform-cli.js logs "Drive: name (fileId)" after uploads
  const m = stdout.match(/Drive:[^(\n]*\(([A-Za-z0-9_-]{20,})\)/);
  return m ? `https://drive.google.com/file/d/${m[1]}/view` : null;
}

// Shared agent-router context. WhatsApp + Slack both pass this to
// routeAgentCommand so handlers stay surface-agnostic. Helpers + paths live
// here in server.js (where they have access to env / cwd); the dispatcher
// lives in server/agentRouter.js.
const AGENT_CTX = {
  runCli,
  runGws,
  driveListNewestVideo,
  paths: {
    SHORTFORM_CLI: SHORTFORM_CLI_PATH,
    PIPELINE_CLI: PIPELINE_CLI_PATH,
    SHORTFORM_IN_FOLDER_ID,
  },
  extract: {
    script: extractScriptFromStdout,
    notion: extractNotionUrl,
    drive: extractDriveFileUrl,
  },
  lifejournalSeries: () => Object.keys(loadLifejournalConfig().series || {}),
};

// ── ship-template lane adapters (voice-to-deploy; docs/superpowers/plans/2026-06-15-ship-template-lane.md) ──
const SHIP_CLAUDE_TIMEOUT_MS = 10 * 60 * 1000;
const SHIP_GATE_TIMEOUT_MS = 10 * 60 * 1000;
const SHIP_PREVIEW_TIMEOUT_MS = 8 * 60 * 1000;
const SHIP_GIT_TIMEOUT_MS = 2 * 60 * 1000; // git ops must fail fast, never hang the single-worker queue (live-fire: GitHub transport stalled)
const SHIP_REPO = process.env.SHIP_TEMPLATE_REPO_PATH;
const SHIP_GH_TOKEN = process.env.SHIP_TEMPLATE_GITHUB_TOKEN;
const SHIP_VERCEL_TOKEN = process.env.SHIP_TEMPLATE_VERCEL_TOKEN;
const SHIP_VERCEL_PROJECT = process.env.SHIP_TEMPLATE_VERCEL_PROJECT_ID;
const SHIP_VERCEL_TEAM = process.env.SHIP_TEMPLATE_VERCEL_TEAM_ID || '';
const SHIP_REMOTE = process.env.SHIP_TEMPLATE_REMOTE || '';
const SHIP_CLAUDE_BIN = process.env.SHIP_TEMPLATE_CLAUDE_BIN || (process.platform === 'win32' ? 'claude.exe' : 'claude');
// STRICT ALLOWLIST (Phase-2) for the claude subprocess env — only OS/runtime vars claude needs to
// run + OAuth-auth (creds under USERPROFILE/APPDATA). Excludes ALL .env secrets, now and future. Extend via SHIP_TEMPLATE_CLAUDE_ENV_EXTRA.
const SHIP_CLAUDE_ENV_ALLOW = new Set([...['PATH','PATHEXT','SystemRoot','windir','ComSpec','SystemDrive','TEMP','TMP','TMPDIR','USERPROFILE','HOMEDRIVE','HOMEPATH','HOME','APPDATA','LOCALAPPDATA','ProgramData','ProgramFiles','ProgramFiles(x86)','CommonProgramFiles','CommonProgramFiles(x86)','PUBLIC','ALLUSERSPROFILE','PROCESSOR_ARCHITECTURE','PROCESSOR_IDENTIFIER','NUMBER_OF_PROCESSORS','OS','USERNAME','USERDOMAIN','COMPUTERNAME','SESSIONNAME','LANG','LC_ALL','TZ','TERM','SHELL','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','CLAUDE_CONFIG_DIR','NVM_DIR','FNM_DIR'], ...String(process.env.SHIP_TEMPLATE_CLAUDE_ENV_EXTRA||'').split(',')].map(s=>String(s).trim().toLowerCase()).filter(Boolean));

// Spawn an arbitrary command (NOT node — runCli is node-only) with abort+timeout+treeKill.
function spawnKillable(command, args, { cwd, env, timeoutMs, signal, shell = false } = {}) {
  return new Promise((res) => {
    const child = spawn(command, args, { cwd, env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'], shell });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => treeKill(child), timeoutMs);
    const onAbort = () => treeKill(child);
    if (signal) { if (signal.aborted) treeKill(child); else signal.addEventListener('abort', onAbort, { once: true }); }
    const cleanup = () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); };
    child.on('exit', (code) => { cleanup(); res({ ok: code === 0, exitCode: code, stdout, stderr }); });
    child.on('error', (err) => { cleanup(); res({ ok: false, exitCode: 1, stdout, stderr: err.message }); });
  });
}

// claude: untrusted instruction → temp FILE; argv carries only a fixed prompt + controlled path.
async function shipRunClaude(instruction, { cwd, signal } = {}) {
  const promptFile = join(tmpdir(), `ship-${Date.now()}-${Math.floor(Math.random() * 1e6)}.md`);
  writeFileSync(promptFile, instruction, 'utf8');
  const fixedPrompt = `Read the file ${promptFile}. It contains a change request for this web app. Apply that change to the code in the current repository only. Do not start a dev server, do not run git, do not touch files outside this repo. When the edit is complete, stop.`;
  // Minimal env: strip secrets (skip-perms agent on untrusted text); dropping ANTHROPIC_API_KEY
  // also forces logged-in subscription (OAuth) over per-token API billing.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => SHIP_CLAUDE_ENV_ALLOW.has(k.toLowerCase())));
  try {
    // claude is a real .exe → spawn directly (NO shell) so the multi-word prompt stays ONE argv element.
    // Scoped tools (Phase-2): file ops only, NO Bash. -p mode auto-denies anything else (no hang).
    return await spawnKillable(SHIP_CLAUDE_BIN, ['-p', fixedPrompt, '--allowedTools', 'Edit Write MultiEdit Read Glob Grep LS'], {
      cwd, env, timeoutMs: SHIP_CLAUDE_TIMEOUT_MS, signal, shell: false,
    });
  } finally {
    try { rmSync(promptFile, { force: true }); } catch { /* best effort */ }
  }
}

// gate: npm install --ignore-scripts (picks up deps claude added; neutralizes malicious postinstall) then npm run build.
async function shipRunGate({ cwd, signal } = {}) {
  const install = await spawnKillable('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd, timeoutMs: SHIP_GATE_TIMEOUT_MS, signal, shell: true });
  if (!install.ok) return { ok: false, stage: 'install', log: (install.stderr || install.stdout || '').slice(-1000) };
  const build = await spawnKillable('npm', ['run', 'build'], { cwd, timeoutMs: SHIP_GATE_TIMEOUT_MS, signal, shell: true });
  if (!build.ok) return { ok: false, stage: 'build', log: (build.stderr || build.stdout || '').slice(-1000) };
  return { ok: true, stage: 'build', log: 'built' };
}

// git: execFile with built-in {signal}; push over HTTPS with the embedded token (scrubbed on error).
const shipGit = {
  _git(args, cwd, signal) {
    return new Promise((res, rej) => {
      execFile('git', ['-c', 'credential.helper=', ...args], { cwd, signal, timeout: SHIP_GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          const scrubbed = String(stderr || err.message).split(SHIP_GH_TOKEN || '\0nope\0').join('***');
          return rej(new Error(scrubbed.slice(-400)));
        }
        res(stdout);
      });
    });
  },
  async prepareBranch({ branch, cwd, signal }) {
    await this._git(['fetch', `https://x-access-token:${SHIP_GH_TOKEN}@${SHIP_REMOTE}`, 'main'], cwd, signal);
    await this._git(['reset', '--hard', 'FETCH_HEAD'], cwd, signal);
    await this._git(['clean', '-fd'], cwd, signal);
    await this._git(['checkout', '-B', branch, 'FETCH_HEAD'], cwd, signal);
  },
  async commitAll({ message, cwd, signal }) {
    await this._git(['add', '-A'], cwd, signal);
    // Commit with the repo's CONFIGURED identity (the repo's GitHub-associated email). Vercel BLOCKS
    // deployments whose committer can't be matched to a GitHub user, so never a synthetic identity.
    await this._git(['commit', '-m', message], cwd, signal);
  },
  async headSha({ cwd }) { return (await this._git(['rev-parse', 'HEAD'], cwd)).trim(); },
  async push({ branch, cwd, signal }) {
    const url = `https://x-access-token:${SHIP_GH_TOKEN}@${SHIP_REMOTE}`;
    await this._git(['push', url, `${branch}:${branch}`], cwd, signal);
  },
};

// vercel: poll the deployments list by commit SHA until READY.
const shipVercel = {
  async waitForPreview({ sha, signal }) {
    const q = new URLSearchParams({ projectId: SHIP_VERCEL_PROJECT || '', target: 'preview', sha: sha || '', 'meta-githubCommitSha': sha || '', limit: '20' });
    if (SHIP_VERCEL_TEAM) q.set('teamId', SHIP_VERCEL_TEAM);
    const url = `https://api.vercel.com/v6/deployments?${q.toString()}`;
    const deadline = Date.now() + SHIP_PREVIEW_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal && signal.aborted) throw new Error('cancelled');
      const r = await fetch(url, { headers: { Authorization: `Bearer ${SHIP_VERCEL_TOKEN}` } });
      if (r.ok) {
        const data = await r.json();
        // SHA-pinned: require the EXACT commit. No `|| list[0]` fallback — a missing match means
        // "not registered yet", so we keep polling rather than report another commit's preview URL.
        const match = (data.deployments || []).find((d) => d.meta && d.meta.githubCommitSha === sha);
        if (match) {
          const state = match.readyState || match.state;
          if (state === 'READY' && match.url) return { url: `https://${match.url}` };
          if (['ERROR', 'CANCELED', 'BLOCKED', 'DELETED'].includes(state)) throw new Error(`deployment ${state}`);
        }
      }
      await new Promise((s) => setTimeout(s, 3000));
    }
    throw new Error('preview not READY before timeout');
  },
};

// ── Job queue (footage-first edit lanes; docs/superpowers/plans/2026-06-13-footage-job-queue.md) ──
const shipTemplate = createShipTemplate({
  runClaude: shipRunClaude, git: shipGit, runGate: shipRunGate, vercel: shipVercel,
  now: () => Date.now(), repoPath: SHIP_REPO, breadstickRoot: __dirname, githubToken: SHIP_GH_TOKEN,
  branchPrefix: process.env.SHIP_TEMPLATE_BRANCH_PREFIX || 'ship',
});
const LJ_DEFAULTS = { targetSec: 75, beats: 6, windowSec: 12, canvas: { w: 1920, h: 1080, fps: 30 },
  lut: 'default.cube', logDefault: true, nonLogLanes: [], nonLogRels: [],
  muteOriginal: true, outDir: 'renders/lifejournal', dailyTtsCharCap: 4000, cron: '0 9 * * 0' };
function loadLifejournalConfig() {
  const p = join(__dirname, 'data', 'lifejournal', 'config.json');
  let cfg;
  try { cfg = JSON.parse(readFileSync(p, 'utf8')); }
  catch { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(LJ_DEFAULTS, null, 2)); cfg = { ...LJ_DEFAULTS }; }
  cfg.voiceId = process.env.LIFEJOURNAL_VOICE_ID || null;
  cfg.outDir = join(__dirname, cfg.outDir);
  return resolveSeriesConfig(cfg);
}

// Phase-2 only (thought → script). Mirrors server.js's existing /v1/messages calls.
async function shapeDiaryScript(thought) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1024,
      system: 'Turn a spoken thought into a short, first-person reflective diary voiceover, 60-90 spoken seconds. Output only the spoken words - no stage directions. Honest, unhurried.',
      messages: [{ role: 'user', content: thought }] }),
  });
  const data = await resp.json();
  return (data.content?.[0]?.text || '').trim();
}

const lifejournalTtsBudget = createTtsBudget({
  usagePath: join(__dirname, 'data', 'lifejournal', 'tts-usage.jsonl'),
  cap: loadLifejournalConfig().dailyTtsCharCap,
});
async function uploadDiaryToDrive(outPath) {
  // Reuse the gws CLI like pipeline_cron.uploadToDrive; shell:true so PATH resolves on Windows.
  const r = await spawnKillable('gws', ['drive', '+upload', outPath, '--name', basename(outPath)], { timeoutMs: 120000, shell: true });
  if (!r.ok) throw new Error(`gws upload exit ${r.exitCode}: ${(r.stderr || '').slice(-200)}`);
  const m = (r.stdout || '').match(/"id":\s*"([a-zA-Z0-9_-]+)"/);
  if (!m) {
    console.warn(`[lifejournal] gws upload for ${basename(outPath)} exited ok but no file id parsed from output`);
    return null;
  }
  return `https://drive.google.com/file/d/${m[1]}/view`;
}
const lifejournalDiary = createDiary({
  indexPath: join(__dirname, 'data', 'lifejournal', 'footage-index.json'),
  ledgerPath: join(__dirname, 'data', 'lifejournal', 'used-clips.jsonl'),
  lutDir: join(__dirname, 'pipeline', 'luts'),
  config: loadLifejournalConfig(),
  tts: ({ text, voiceId, outPath }) => elevenLabsTTS({ text, voiceId, outPath }),
  probeDuration: (p) => probeDurationSec(p),
  shapeScript: shapeDiaryScript,
  runCmd: async ({ bin, args, signal }) => {
    const r = await spawnKillable(bin, args, { timeoutMs: 3600000, signal, shell: false });
    if (!r.ok) throw new Error(`ffmpeg exit ${r.exitCode}: ${(r.stderr || '').slice(-300)}`);
    return r;
  },
  ttsBudget: lifejournalTtsBudget,
  deliver: ({ outPath }) => uploadDiaryToDrive(outPath),
});

const jobTypes = createJobTypes({
  runCli,
  paths: { SHORTFORM_CLI: SHORTFORM_CLI_PATH },
  extract: { drive: extractDriveFileUrl },
  shipTemplate,
  lifejournal: lifejournalDiary,
});
const jobQueue = createJobQueue({
  dataDir: join(__dirname, 'data', 'jobs'),
  now: () => Date.now(),
  runner: jobTypes.run,
  formatMessage: (job) => (
    job.status === 'done' ? jobTypes.formatDone(job.type, job.result)
    : job.status === 'cancelled' ? `Cancelled job ${job.id}.`
    : jobTypes.formatError(job.type, job.error)),
  notifier: async (descriptor, text) => {
    if (!descriptor || !text) return;
    if (descriptor.surface === 'whatsapp') return whatsappSend(descriptor.to, text);
    if (descriptor.surface === 'slack') return slackPostMessage({ channel: descriptor.channel, thread_ts: descriptor.thread_ts, text });
    console.log('[jobQueue] unhandled notify surface:', descriptor.surface);
  },
});
AGENT_CTX.enqueueJob = (spec) => jobQueue.enqueue(spec);
AGENT_CTX.cancelJob = (id) => jobQueue.cancel(id);
AGENT_CTX.listJobs = (opts) => jobQueue.list(opts);
const jobRecovery = jobQueue.recoverOnBoot();
console.log(`[jobQueue] boot recovery: re-queued ${jobRecovery.recovered}, failed ${jobRecovery.failed} interrupted`);

// ── Render cache (memoize Remotion renders by input hash) ──
const renderCache = createRenderCache({});
const RENDER_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
for (const cacheDir of [join(__dirname, 'public', 'render-cache'), join(__dirname, 'public', 'skyframe')]) {
  const { pruned } = renderCache.prune({ cacheDir, maxAgeMs: RENDER_CACHE_MAX_AGE_MS });
  if (pruned) console.log(`[renderCache] pruned ${pruned} stale entries from ${cacheDir}`);
}

// Job queue API. POST enqueues (returns a ticket immediately); GET reads.
app.post('/api/jobs', (req, res) => {
  const { type, input, notify } = req.body || {};
  if (!type || typeof type !== 'string') return res.status(400).json({ error: 'type required' });
  if (!jobTypes.has(type)) return res.status(400).json({ error: `unknown job type: ${type}` });
  const job = jobQueue.enqueue({ type, input: input || {}, notify: notify || null });
  res.status(201).json({ id: job.id, status: job.status });
});
app.get('/api/jobs', (req, res) => {
  res.json({ jobs: jobQueue.list({ status: req.query.status }) });
});
app.get('/api/jobs/:id', (req, res) => {
  const job = jobQueue.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json({ job });
});
app.post('/api/jobs/:id/cancel', (req, res) => {
  const r = jobQueue.cancel(req.params.id);
  if (!r.ok && r.reason === 'not_found') return res.status(404).json({ error: 'not found' });
  if (!r.ok) return res.status(409).json({ error: r.reason });
  res.json({ job: r.job });
});

// LifeJournal: dry-run a diary pull (proposed chunks + script) for the human gate.
// The heavy render goes through the generic POST /api/jobs { type: 'lifejournal-diary' }.
app.post('/api/lifejournal/draft', async (req, res) => {
  try { res.json(await lifejournalDiary.draft(req.body || {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/lifejournal/propose', async (req, res) => {
  try { await proposeWeeklyDiary(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Active-persona lock — written by proactive cron, read by inbound WhatsApp.
// Lets a scheduled persona (e.g. grandpa-riddle) hold the conversation for N
// hours after the proactive ping, instead of dumping replies onto philosopher
// Maestro. Map: { [phoneE164]: { persona, session, expires_at, set_at, set_by } }
const ACTIVE_PERSONA_PATH = join(__dirname, 'pipeline', 'maestro', 'active-persona.json');
const MAESTRO_WA_FALLBACK = false; // Mayordomo/Maestro WhatsApp fallback OFF by default; flip to true to re-enable

function readActivePersonaMap() {
  try {
    if (!existsSync(ACTIVE_PERSONA_PATH)) return {};
    return JSON.parse(readFileSync(ACTIVE_PERSONA_PATH, 'utf8'));
  } catch (err) {
    console.error('[active-persona] failed to read map:', err.message);
    return {};
  }
}

function writeActivePersona(phone, entry) {
  const map = readActivePersonaMap();
  map[phone] = entry;
  writeFileSync(ACTIVE_PERSONA_PATH, JSON.stringify(map, null, 2));
}

function lookupActivePersona(phone) {
  const map = readActivePersonaMap();
  const entry = map[phone];
  if (!entry) return null;
  if (entry.expires_at && new Date(entry.expires_at).getTime() < Date.now()) {
    delete map[phone];
    try { writeFileSync(ACTIVE_PERSONA_PATH, JSON.stringify(map, null, 2)); } catch {}
    return null;
  }
  return entry;
}

// WhatsApp transport — what routeAgentCommand calls to talk back to the user.
// Mirrors the pre-extraction behavior: text replies via whatsappSend, no image
// upload yet (16gami / image2 results post local path; Slack will handle image
// upload natively via files.uploadV2).
function whatsappTransport(from) {
  return {
    notify: { surface: 'whatsapp', to: from },
    send: (text) => whatsappSend(from, text),
    sendStarting: (text) => whatsappSend(from, text),
    // No native image upload on WhatsApp side yet — fall back to text with path.
    sendImage: async (filePath, caption) => {
      const msg = caption ? `${caption}\nLocal: ${filePath}` : `Image ready: ${filePath}`;
      return whatsappSend(from, msg);
    },
  };
}

async function handleWhatsappCommand(from, cmd) {
  return routeAgentCommand({ cmd, transport: whatsappTransport(from), ctx: AGENT_CTX });
}

async function handleWhatsappVideo(from, msg) {
  const mediaId = msg.video?.id;
  if (!mediaId) return whatsappSend(from, 'Video missing media ID.');
  const tmpPath = join(WHATSAPP_INBOX, `whatsapp_${Date.now()}.mp4`);
  await whatsappSend(from, 'Got your video. Downloading...');
  try {
    await downloadWhatsAppMedia(mediaId, tmpPath);
  } catch (err) {
    return whatsappSend(from, `Download failed: ${(err.message || '').slice(0, 200)}`);
  }
  await whatsappSend(from, 'Uploading to /Short form IN/, then queuing...');
  const up = await runGws(['drive', '+upload', tmpPath, '--parent', SHORTFORM_IN_FOLDER_ID], 300000);
  if (up.exitCode !== 0) {
    return whatsappSend(from, `Drive upload failed.\n${(up.stderr || '').slice(0, 300)}`);
  }
  const job = jobQueue.enqueue({ type: 'shortform-process', input: { pack: 'default' }, notify: { surface: 'whatsapp', to: from } });
  await whatsappSend(from, `Uploaded. Queued job ${job.id} — I'll ping you when it's processed.`);
}

// Voice note → Scribe transcript → keyword command (if matched) OR Maestro turn
// keyed by sender phone → Brian-voice audio reply (text fallback if upload fails).
const MAESTRO_CLI_PATH = join(__dirname, 'maestro-cli.js');

async function handleWhatsappVoice(from, msg) {
  const audioObj = msg.audio || msg.voice;
  if (!audioObj?.id) {
    return whatsappSend(from, 'Got an audio message but no media id.');
  }

  const voiceDir = join(WHATSAPP_INBOX, 'voice');
  await mkdir(voiceDir, { recursive: true });
  const ts = Date.now();
  const inPath = join(voiceDir, `${from}_${ts}.ogg`);

  console.log(`[whatsapp] voice ← downloading ${audioObj.id}`);
  let dl;
  try {
    dl = await downloadWhatsAppMedia(audioObj.id, inPath);
  } catch (err) {
    return whatsappSend(from, `Voice download failed: ${(err.message || 'unknown').slice(0, 200)}`);
  }
  console.log(`[whatsapp] voice ← downloaded (${dl.size}B, ${dl.mimeType})`);

  let transcript;
  try {
    transcript = await transcribeWithScribe(inPath, dl.mimeType || 'audio/ogg');
  } catch (err) {
    console.error('[whatsapp] scribe error:', err);
    return whatsappSend(from, `Could not transcribe voice: ${(err.message || 'unknown').slice(0, 200)}`);
  }
  console.log(`[whatsapp] voice transcript: "${transcript}"`);

  if (!transcript) {
    return whatsappSend(from, 'I heard silence. Try again.');
  }

  // Voice can drive any existing keyword command — same router as text.
  const cmd = parseAgentCommand(transcript);
  if (cmd) {
    console.log(`[whatsapp] voice → command: ${cmd.cmd}${cmd.topic ? ` "${cmd.topic}"` : ''}`);
    await whatsappSend(from, `Heard: "${transcript}"\nRunning ${cmd.cmd}...`);
    return handleWhatsappCommand(from, cmd);
  }

  // Otherwise — Maestro turn keyed by phone (last 4 digits keep filenames sane).
  // If a persona lock is active for this phone (e.g. grandpa-riddle from a recent
  // cron ping), route to that persona's session instead of philosopher Maestro.
  if (!MAESTRO_WA_FALLBACK) return whatsappSend(from, "I didn't catch a command. To build, say: build <what to change>. Or say: help.");
  const lock = lookupActivePersona(from);
  const session = lock?.session || `whatsapp_${from.slice(-4)}`;
  if (lock) console.log(`[whatsapp] active persona lock: ${lock.persona} (session ${lock.session}, set by ${lock.set_by}, expires ${lock.expires_at})`);
  const replyAudioPath = join(voiceDir, `${from}_${ts}_reply.mp3`);
  const turnArgs = ['turn', '--session', session, '--input', transcript, '--tts-out', replyAudioPath];
  if (lock?.persona) turnArgs.push('--persona', lock.persona);

  const result = await runCli(MAESTRO_CLI_PATH, turnArgs, 60000);
  if (result.exitCode !== 0) {
    console.error('[whatsapp] maestro turn failed:', result.stderr);
    return whatsappSend(from, `Maestro stumbled: ${(result.stderr || 'unknown').slice(0, 200)}`);
  }

  const replyText = result.stdout.trim();
  console.log(`[whatsapp] maestro reply: "${replyText.slice(0, 120)}${replyText.length > 120 ? '...' : ''}"`);

  // Prefer Brian audio, fall back to text if upload fails (Meta will read text aloud).
  if (existsSync(replyAudioPath)) {
    try {
      const mediaId = await whatsappUploadMedia(replyAudioPath, 'audio/mpeg');
      await whatsappSendAudio(from, mediaId);
      return;
    } catch (err) {
      console.error('[whatsapp] audio reply failed, falling back to text:', err);
    }
  }
  await whatsappSend(from, replyText);
}

// GET — Meta webhook verification handshake
app.get('/api/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[whatsapp] webhook verified');
    return res.status(200).send(challenge);
  }
  console.log('[whatsapp] webhook verification FAILED', { mode, tokenMatch: token === process.env.WHATSAPP_VERIFY_TOKEN });
  return res.sendStatus(403);
});

// POST — Incoming messages. Meta requires 200 within 5s, so we ACK fast and process async.
app.post('/api/whatsapp/webhook', (req, res) => {
  res.sendStatus(200);
  setImmediate(() => handleWhatsappPayload(req.body).catch(err => console.error('[whatsapp] handler error:', err)));
});

async function handleWhatsappPayload(payload) {
  const entries = payload?.entry || [];
  for (const entry of entries) {
    for (const change of (entry.changes || [])) {
      const value = change.value || {};
      const messages = value.messages || [];
      const contacts = value.contacts || [];
      const senderName = contacts[0]?.profile?.name || 'unknown';

      for (const msg of messages) {
        const from = msg.from;
        console.log(`[whatsapp] <- ${senderName} (${from}) type=${msg.type}`);

        if (WHATSAPP_ALLOWED_NUMBERS.length > 0 && !WHATSAPP_ALLOWED_NUMBERS.includes(from)) {
          console.log(`[whatsapp] not allowlisted: ${from} (skip silently)`);
          continue;
        }

        if (msg.type === 'text') {
          const text = msg.text?.body || '';
          console.log(`[whatsapp] text: "${text}"`);
          const cmd = parseAgentCommand(text);
          if (cmd) {
            console.log(`[whatsapp] → command: ${cmd.cmd}${cmd.topic ? ` "${cmd.topic}"` : ''}`);
            try {
              await handleWhatsappCommand(from, cmd);
            } catch (err) {
              console.error('[whatsapp] command error:', err);
              await whatsappSend(from, `Command failed: ${(err.message || 'unknown').slice(0, 200)}`);
            }
          } else {
            const reply = await askClaudeForWhatsapp(text);
            console.log(`[whatsapp] -> ${from}: "${reply.slice(0, 80)}${reply.length > 80 ? '...' : ''}"`);
            await whatsappSend(from, reply);
          }
        } else if (msg.type === 'video') {
          try {
            await handleWhatsappVideo(from, msg);
          } catch (err) {
            console.error('[whatsapp] video handler error:', err);
            await whatsappSend(from, `Video handling failed: ${(err.message || 'unknown').slice(0, 200)}`);
          }
        } else if (msg.type === 'audio' || msg.type === 'voice') {
          try {
            await handleWhatsappVoice(from, msg);
          } catch (err) {
            console.error('[whatsapp] voice handler error:', err);
            await whatsappSend(from, `Voice handling failed: ${(err.message || 'unknown').slice(0, 200)}`);
          }
        } else {
          console.log(`[whatsapp] unsupported type: ${msg.type} (logged, no handler yet)`);
          await whatsappSend(from, `Got your ${msg.type}. Breadstick handles text, voice, and video.`);
        }
      }

      // Status callbacks (delivery/read receipts) — silent log
      const statuses = value.statuses || [];
      for (const s of statuses) {
        console.log(`[whatsapp] status: ${s.status} for msg ${s.id}`);
      }
    }
  }
}

// ── Slack — second inbound command surface (mirror of WhatsApp router) ───
//
// Shipped 2026-05-03 per docs/PRD_slack_integration_2026_05_02.md. Handles
// app_mention events in channels and direct messages in DMs. Same verb router
// as WhatsApp via server/agentRouter.js.

const SLACK_API_BASE = 'https://slack.com/api';
// Comma-separated Slack user IDs (e.g. U01ABCDEF). Empty = allow any sender.
const SLACK_ALLOWED_USERS = (process.env.SLACK_ALLOWED_USERS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Track recent event IDs so Slack retries (X-Slack-Retry-Num) don't duplicate work.
const SLACK_RECENT_EVENTS = new Map();
const SLACK_DEDUPE_TTL_MS = 5 * 60 * 1000;

function slackRememberEvent(eventId) {
  const now = Date.now();
  // Drop expired
  for (const [id, ts] of SLACK_RECENT_EVENTS) {
    if (now - ts > SLACK_DEDUPE_TTL_MS) SLACK_RECENT_EVENTS.delete(id);
  }
  if (SLACK_RECENT_EVENTS.has(eventId)) return false;
  SLACK_RECENT_EVENTS.set(eventId, now);
  return true;
}

// Verify Slack request signature per https://api.slack.com/authentication/verifying-requests-from-slack
function slackVerifySignature(req) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return { ok: false, reason: 'SLACK_SIGNING_SECRET not set' };
  const ts = req.headers['x-slack-request-timestamp'];
  const sig = req.headers['x-slack-signature'];
  if (!ts || !sig) return { ok: false, reason: 'missing signature headers' };
  // Reject anything more than 5 min off the wall clock — replay defense.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return { ok: false, reason: 'stale timestamp' };
  const raw = req.rawBody?.toString('utf8') ?? '';
  const base = `v0:${ts}:${raw}`;
  const computed = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');
  try {
    const ok = crypto.timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(sig, 'utf8'));
    return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' };
  } catch {
    return { ok: false, reason: 'signature length mismatch' };
  }
}

async function slackPostMessage({ channel, thread_ts, text }) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error('[slack] SLACK_BOT_TOKEN not set');
    return { ok: false, error: 'missing token' };
  }
  try {
    const resp = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        channel,
        thread_ts: thread_ts || undefined,
        text: typeof text === 'string' ? text.slice(0, 38000) : '(empty)',
      }),
    });
    const data = await resp.json();
    if (!data.ok) console.error('[slack] postMessage failed:', data.error || data);
    return data;
  } catch (err) {
    console.error('[slack] postMessage error:', err.message);
    return { ok: false, error: err.message };
  }
}

// Upload a local file to Slack via the V2 (3-step) flow:
//   1. files.getUploadURLExternal → returns upload_url + file_id
//   2. POST raw file bytes to upload_url
//   3. files.completeUploadExternal → finalizes, posts to channel/thread
async function slackUploadFile({ channel, thread_ts, filePath, title, initialComment }) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, error: 'SLACK_BOT_TOKEN not set' };
  if (!existsSync(filePath)) return { ok: false, error: `file not found: ${filePath}` };

  try {
    const buf = await readFile(filePath);
    const filename = filePath.split(/[\\/]/).pop();

    const u = new URL(`${SLACK_API_BASE}/files.getUploadURLExternal`);
    u.searchParams.set('filename', filename);
    u.searchParams.set('length', String(buf.length));
    const step1 = await fetch(u, { headers: { 'Authorization': `Bearer ${token}` } });
    const step1Data = await step1.json();
    if (!step1Data.ok) return { ok: false, error: `getUploadURL: ${step1Data.error || 'unknown'}` };

    const uploadResp = await fetch(step1Data.upload_url, {
      method: 'POST',
      body: buf,
    });
    if (!uploadResp.ok) return { ok: false, error: `upload POST HTTP ${uploadResp.status}` };

    const finalizeBody = {
      files: [{ id: step1Data.file_id, title: title || filename }],
      channel_id: channel,
    };
    if (thread_ts) finalizeBody.thread_ts = thread_ts;
    if (initialComment) finalizeBody.initial_comment = initialComment;

    const step3 = await fetch(`${SLACK_API_BASE}/files.completeUploadExternal`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(finalizeBody),
    });
    const step3Data = await step3.json();
    if (!step3Data.ok) return { ok: false, error: `complete: ${step3Data.error || 'unknown'}` };
    return { ok: true, file: step3Data.files?.[0] };
  } catch (err) {
    console.error('[slack] uploadFile error:', err.message);
    return { ok: false, error: err.message };
  }
}

function slackTransport({ channel, thread_ts }) {
  return {
    notify: { surface: 'slack', channel, thread_ts },
    send: (text) => slackPostMessage({ channel, thread_ts, text }),
    sendStarting: (text) => slackPostMessage({ channel, thread_ts, text }),
    sendImage: async (filePath, caption) => {
      const r = await slackUploadFile({ channel, thread_ts, filePath, title: caption, initialComment: caption });
      if (!r.ok) {
        // Fall back to a text reply so the operator still sees the local path.
        await slackPostMessage({
          channel, thread_ts,
          text: `Image uploaded locally but Slack upload failed: ${r.error}\nLocal: ${filePath}`,
        });
      }
      return r;
    },
  };
}

// Strip the leading <@BOTID> mention from app_mention text before parsing.
function stripSlackMention(text) {
  return (text || '').replace(/^\s*<@[UW][A-Z0-9]+>\s*/i, '').trim();
}

async function askClaudeForSlack(userText) {
  // Slack can render longer replies than WhatsApp voice — give Claude more rope.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return 'Anthropic key not set.';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: 'You are Breadstick — a personal AI agent in Slack. Reply concisely (under 600 chars). Use plain text or simple Slack mrkdwn (*bold*, _italic_, `code`). No emoji unless asked. No markdown headers.',
        messages: [{ role: 'user', content: userText }],
      }),
    });
    const data = await resp.json();
    if (data.error) return `Error: ${data.error.message || 'unknown'}`.slice(0, 800);
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return text || 'No reply.';
  } catch (err) {
    return `Error: ${err.message}`.slice(0, 400);
  }
}

async function handleSlackEvent(event) {
  const type = event.type;
  const channel = event.channel;
  const user = event.user;
  // Reply in-thread when the trigger was already in a thread; otherwise start a thread on the trigger ts.
  const thread_ts = event.thread_ts || event.ts;

  if (!user) {
    console.log('[slack] event missing user, skipping');
    return;
  }
  if (event.bot_id) {
    // Ignore our own messages and other bots — prevents loops.
    return;
  }
  if (SLACK_ALLOWED_USERS.length > 0 && !SLACK_ALLOWED_USERS.includes(user)) {
    console.log(`[slack] not allowlisted: ${user} (skip silently)`);
    return;
  }

  let text;
  if (type === 'app_mention') {
    text = stripSlackMention(event.text || '');
  } else if (type === 'message' && event.channel_type === 'im' && !event.subtype) {
    text = (event.text || '').trim();
  } else {
    return; // not a routable event
  }

  if (!text) {
    await slackPostMessage({ channel, thread_ts, text: AGENT_HELP_TEXT });
    return;
  }

  console.log(`[slack] <- ${user} (${channel}) "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`);

  const cmd = parseAgentCommand(text);
  const transport = slackTransport({ channel, thread_ts });

  if (cmd) {
    console.log(`[slack] → command: ${cmd.cmd}${cmd.topic ? ` "${cmd.topic}"` : (cmd.theme ? ` "${cmd.theme}"` : '')}`);
    try {
      await routeAgentCommand({ cmd, transport, ctx: AGENT_CTX });
    } catch (err) {
      console.error('[slack] command error:', err);
      await slackPostMessage({ channel, thread_ts, text: `Command failed: ${(err.message || 'unknown').slice(0, 400)}` });
    }
  } else {
    const reply = await askClaudeForSlack(text);
    console.log(`[slack] -> ${user}: "${reply.slice(0, 80)}${reply.length > 80 ? '...' : ''}"`);
    await slackPostMessage({ channel, thread_ts, text: reply });
  }
}

// POST — Slack Events API webhook. Must respond 200 within 3 seconds.
app.post('/api/slack/webhook', (req, res) => {
  // url_verification handshake — answered immediately, no signature check (Slack
  // sends this BEFORE the secret is "live" on their end during URL setup).
  if (req.body?.type === 'url_verification') {
    return res.json({ challenge: req.body.challenge });
  }

  const verdict = slackVerifySignature(req);
  if (!verdict.ok) {
    console.warn(`[slack] signature verification failed: ${verdict.reason}`);
    return res.sendStatus(401);
  }

  // Retries with X-Slack-Retry-Num indicate Slack thinks we didn't ack —
  // dedupe so we don't re-run pipelines.
  const eventId = req.body?.event_id;
  if (eventId && !slackRememberEvent(eventId)) {
    console.log(`[slack] duplicate event ${eventId} (retry ${req.headers['x-slack-retry-num']}), skipping`);
    return res.sendStatus(200);
  }

  res.sendStatus(200);
  setImmediate(() => {
    try {
      const payload = req.body || {};
      if (payload.type === 'event_callback' && payload.event) {
        handleSlackEvent(payload.event).catch(err => console.error('[slack] handler error:', err));
      } else {
        console.log(`[slack] unhandled payload type=${payload.type}`);
      }
    } catch (err) {
      console.error('[slack] dispatch error:', err);
    }
  });
});

// ── Proactive Maestro Loop ─────────────────────────────────────────────────
//
// Reads pipeline/maestro/proactive.json on startup. Each schedule entry has a
// cron expression and a trigger string. When fired, server spawns
// `maestro-cli.js turn --proactive` with the trigger, captures Maestro's
// reply + Brian audio, and sends it to the configured `to` phone via WhatsApp.
//
// The trigger is NOT logged as the operator's input — only the assistant's reply is persisted
// (with proactive:true), so future sessions read as Maestro initiating threads.

function loadProactiveConfig() {
  const cfgPath = join(__dirname, 'pipeline', 'maestro', 'proactive.json');
  if (!existsSync(cfgPath)) return null;
  try {
    return JSON.parse(readFileSync(cfgPath, 'utf8'));
  } catch (err) {
    console.error('[proactive] failed to parse proactive.json:', err.message);
    return null;
  }
}

// Post a proactive reply to a Discord channel via incoming webhook (opt-in per schedule).
async function postDiscord(webhookUrl, content, username) {
  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: (content || '').slice(0, 1900), username: username || 'Mayordomo' }),
  });
  if (!resp.ok) throw new Error(`Discord ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
}

async function sendProactiveMaestro(schedule, cfg) {
  const session = schedule.session || cfg.session || `whatsapp_${cfg.to.slice(-4)}`;
  const ts = Date.now();
  const audioPath = join(WHATSAPP_INBOX, 'voice', `proactive_${schedule.name}_${ts}.mp3`);
  await mkdir(dirname(audioPath), { recursive: true });

  // If schedule has a persona + lockHours, set the active-persona lock so the operator's
  // reply through the WhatsApp inbound handler routes to the same persona/session.
  if (schedule.persona && Number.isFinite(schedule.lockHours) && schedule.lockHours > 0) {
    try {
      writeActivePersona(cfg.to, {
        persona: schedule.persona,
        session,
        expires_at: new Date(Date.now() + schedule.lockHours * 3600 * 1000).toISOString(),
        set_at: new Date().toISOString(),
        set_by: schedule.name,
      });
    } catch (err) {
      console.error(`[proactive ${schedule.name}] failed to write active-persona lock:`, err.message);
    }
  }

  const args = [
    'turn',
    '--session', session,
    '--input', schedule.trigger,
    '--tts-out', audioPath,
    '--proactive',
  ];
  if (schedule.persona) args.push('--persona', schedule.persona);

  const result = await runCli(MAESTRO_CLI_PATH, args, 60000);
  if (result.exitCode !== 0) {
    console.error(`[proactive ${schedule.name}] maestro turn failed:`, (result.stderr || '').slice(0, 300));
    return;
  }

  const replyText = result.stdout.trim();
  console.log(`[proactive ${schedule.name}] reply: "${replyText.slice(0, 100)}${replyText.length > 100 ? '...' : ''}"`);

  // Optional Discord delivery (opt-in via schedule.discord + DISCORD_WEBHOOK_URL).
  if (schedule.discord && process.env.DISCORD_WEBHOOK_URL) {
    try {
      await postDiscord(process.env.DISCORD_WEBHOOK_URL, replyText, schedule.discordUsername);
      console.log(`[proactive ${schedule.name}] posted to Discord`);
    } catch (err) {
      console.error(`[proactive ${schedule.name}] Discord post failed:`, err.message);
    }
  }

  if (existsSync(audioPath)) {
    try {
      const mediaId = await whatsappUploadMedia(audioPath, 'audio/mpeg');
      await whatsappSendAudio(cfg.to, mediaId);
      console.log(`[proactive ${schedule.name}] sent audio to ${cfg.to}`);
      return;
    } catch (err) {
      console.error(`[proactive ${schedule.name}] audio send failed, falling back to text:`, err.message);
    }
  }
  await whatsappSend(cfg.to, replyText);
  console.log(`[proactive ${schedule.name}] sent text to ${cfg.to}`);
}

function registerProactiveSchedules() {
  const cfg = loadProactiveConfig();
  if (!cfg) {
    console.log('[proactive] no proactive.json found at pipeline/maestro/ — copy proactive.example.json to enable');
    return;
  }
  if (cfg.enabled === false) {
    console.log('[proactive] disabled in config (enabled: false)');
    return;
  }
  if (!cfg.to) {
    console.error('[proactive] missing `to` phone in proactive.json — skipping all schedules');
    return;
  }
  const schedules = cfg.schedules || [];
  if (schedules.length === 0) {
    console.log('[proactive] no schedules in config');
    return;
  }
  let registered = 0;
  for (const sched of schedules) {
    if (!sched.cron || !cron.validate(sched.cron)) {
      console.error(`[proactive] skipping "${sched.name || '(unnamed)'}" — invalid cron: ${sched.cron}`);
      continue;
    }
    if (!sched.trigger) {
      console.error(`[proactive] skipping "${sched.name || '(unnamed)'}" — missing trigger`);
      continue;
    }
    cron.schedule(sched.cron, () => {
      console.log(`[proactive ${sched.name}] firing (${new Date().toISOString()})`);
      sendProactiveMaestro(sched, cfg).catch(err => {
        console.error(`[proactive ${sched.name}] handler error:`, err.message);
      });
    });
    console.log(`[proactive] registered "${sched.name}" → ${sched.cron}`);
    registered++;
  }
  console.log(`[proactive] ${registered} schedule(s) active`);
}

// === Scoreboard schedules ================================================
//
// Two fixed jobs, both deterministic by doctrine (no LLM in the decision
// path — an LLM may narrate a verdict later, it may not pick the winner):
//
//   nightly 03:15  pull Postiz state for every post id the activity ledger
//                  knows about (last 30 days) into data/perf/
//   Sunday 21:00   the A/B verdict — joins ledger posts with perf metrics
//                  per lane, runs rotateAngles(), WhatsApps the digest.
//                  GATED on pipeline/angles.json approved:true so nothing
//                  fires until the operator has edited the DRAFT angle bank.

function loadAngleBank() {
  try {
    return JSON.parse(readFileSync(join(__dirname, 'pipeline', 'angles.json'), 'utf8'));
  } catch (err) {
    console.warn('[scoreboard] pipeline/angles.json unreadable:', err.message);
    return null;
  }
}

async function runWeeklyVerdict() {
  const bank = loadAngleBank();
  if (!bank) return;
  if (bank.approved !== true) {
    console.log('[scoreboard] verdict skipped — angle bank not approved yet (edit pipeline/angles.json, set approved:true)');
    return;
  }
  const to = new Date();
  const from = new Date(to.getTime() - 14 * 24 * 3600 * 1000);
  const posts = readWindow(from.toISOString(), to.toISOString()).filter((ev) => ev.type === 'post');
  const perf = readPerfWindow(from.toISOString(), to.toISOString());
  // Latest snapshot per postId wins (snapshots are append-only).
  const latestByPost = {};
  for (const snap of perf) latestByPost[snap.postId] = snap;

  const lines = [`Breadstick scoreboard — week of ${to.toISOString().slice(0, 10)}`];
  for (const [laneId, laneCfg] of Object.entries(bank.lanes || {})) {
    const lanePosts = [];
    for (const ev of posts) {
      if ((ev.meta?.lane || ev.lane) !== laneId) continue;
      for (const postId of ev.meta?.postizPostIds || []) {
        const snap = latestByPost[postId];
        const metricValue = snap?.metrics?.[laneCfg.metric];
        lanePosts.push({ angle: ev.meta?.angle || 'untagged', metricValue });
      }
    }
    const verdict = rotateAngles({
      angles: laneCfg.angles || [],
      posts: lanePosts,
      minPostsPerAngle: bank.rotation?.minPostsPerAngle ?? 3,
      leaderShare: bank.rotation?.leaderShare ?? 0.6,
    });
    const shares = Object.entries(verdict.shares).map(([id, w]) => `${id} ${Math.round(w * 100)}%`).join(', ');
    lines.push(`\n${laneId} (${laneCfg.metric}): ${verdict.decided ? 'VERDICT' : 'exploring'} — ${verdict.reason}`);
    lines.push(`next week's slots: ${shares || 'n/a'}`);
  }
  const digest = lines.join('\n');
  console.log('[scoreboard] verdict:\n' + digest);
  logEvent({ type: 'verdict', lane: 'scoreboard', meta: { digest } });
  const cfg = loadProactiveConfig();
  if (cfg?.to) {
    try {
      await whatsappSend(cfg.to, digest);
      console.log(`[scoreboard] digest sent to ${cfg.to}`);
    } catch (err) {
      console.error('[scoreboard] WhatsApp digest failed:', err.message);
    }
  } else {
    console.log('[scoreboard] no proactive.json `to` phone — digest logged only');
  }
}

function registerScoreboardSchedules() {
  cron.schedule('15 3 * * *', () => {
    pullPostizPerformance().catch((err) => console.error('[scoreboard] perf pull error:', err.message));
  });
  cron.schedule('0 21 * * 0', () => {
    runWeeklyVerdict().catch((err) => console.error('[scoreboard] verdict error:', err.message));
  });
  const bank = loadAngleBank();
  console.log(`[scoreboard] schedules active — nightly perf pull 03:15, Sunday verdict 21:00 (${bank?.approved === true ? 'ARMED' : 'gated: angle bank not approved'})`);
}

async function proposeWeeklyDiary() {
  const pcfg = loadProactiveConfig();
  if (!pcfg?.to) { console.log('[lifejournal] no proactive.json `to` phone — skipping ticket'); return; }
  const draft = await lifejournalDiary.draft({});
  await whatsappSend(pcfg.to, formatDiaryTicket(draft, new Date()));
  console.log(`[lifejournal] weekly diary ticket sent to ${pcfg.to}`);
}
function registerLifejournalSchedules() {
  const expr = loadLifejournalConfig().cron || '0 9 * * 0';
  if (!cron.validate(expr)) { console.error(`[lifejournal] invalid cron: ${expr}`); return; }
  cron.schedule(expr, () => {
    proposeWeeklyDiary().catch((err) => console.error('[lifejournal] propose error:', err.message));
  });
  console.log(`[lifejournal] weekly diary proposal scheduled → ${expr}`);
}

// Manually fire a named proactive schedule on demand. node-cron has no
// missed-fire catch-up (see proactive.json _NOTES) — if the server was offline
// at the scheduled minute, that day's ping is simply lost. This endpoint reuses
// the exact cron firing path (sendProactiveMaestro: active-persona lock →
// maestro turn → Brian audio → WhatsApp, plus opt-in Discord), so a manual
// catch-up is byte-identical to a real fire. Delivery detail lands in the
// server log; the JSON here only confirms the fire was dispatched.
app.post('/api/proactive/fire', async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required (schedule name from proactive.json)' });
  const cfg = loadProactiveConfig();
  if (!cfg) return res.status(404).json({ error: 'no proactive.json found at pipeline/maestro/' });
  if (!cfg.to) return res.status(400).json({ error: 'proactive.json missing `to` phone' });
  const sched = (cfg.schedules || []).find(s => s.name === name);
  if (!sched) {
    const names = (cfg.schedules || []).map(s => s.name).filter(Boolean);
    return res.status(404).json({ error: `no schedule named "${name}"`, available: names });
  }
  if (!sched.trigger) return res.status(400).json({ error: `schedule "${name}" has no trigger` });
  console.log(`[proactive ${name}] manual fire via /api/proactive/fire (${new Date().toISOString()})`);
  try {
    await sendProactiveMaestro(sched, cfg);
    res.json({ ok: true, fired: name, note: 'dispatched — see server log for delivery (audio/text/Discord) result' });
  } catch (err) {
    console.error(`[proactive ${name}] manual fire error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── B-Roll suggestions + render+splice ────────────────────────────────────
//
// Two endpoints. /suggest reads the transcript + the catalog and asks Claude
// to propose 2-3 full-frame B-roll cuts. /render kicks off Remotion render of
// the selected comps from external/remotion and FFmpeg-splices them into the
// source video at the chosen timestamps with the original audio passing
// through.
//
// Catalog lives at pipeline/broll-catalog.json — regenerate via
// `node tools/build_broll_catalog.js` after adding new comps in C:\Remotion.

async function loadBrollCatalog() {
  try {
    const raw = await readFile(join(__dirname, 'pipeline', 'broll-catalog.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { comps: [] };
  }
}

app.post('/api/broll/suggest', async (req, res) => {
  const { transcript, videoDurationSec, maxCuts = 3, apiKey: bodyKey } = req.body || {};
  if (!transcript) return res.status(400).json({ error: 'transcript required' });
  const apiKey = bodyKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'ANTHROPIC_API_KEY not set' });

  const catalog = await loadBrollCatalog();
  if (!catalog.comps?.length) {
    return res.status(500).json({ error: 'broll catalog empty — run tools/build_broll_catalog.js' });
  }

  const compList = catalog.comps
    .map(c => `  ${c.id} (${c.slug}, native: ${c.durationSec.toFixed(1)}s)`)
    .join('\n');
  const system = `You're a video editor picking B-roll cuts for a creator's talking-head video.

You'll get a transcript and a list of available B-roll motion graphics. Pick 2-${maxCuts} cuts. Each cut replaces the talking head with a full-frame motion graphic; the original audio plays through underneath.

RULES:
- Pick cuts where the visual concretely illustrates what the speaker is saying. If no comp matches a passage, skip it — don't force a bad pairing.
- **Cut duration: 8-15 seconds.** Most comps are designed to play 9-15s natively; honor the comp's native pacing rather than chopping it short.
- **Cap each cut at the comp's native duration.** If a comp is listed as native 9.0s, durationSec must be ≤ 9. If native is 18s, durationSec can go up to 15s (our preferred max). Never request a longer cut than the comp can supply.
- Pick comps with native ≥ 8s when possible — they're built for sustained screen time.
- Spread cuts across the video. Don't cluster them in the first 30s.
- Don't cut during the hook (first 5s) or the CTA (last 10s).
- Reply with JSON ONLY, no prose, no markdown:
{ "cuts": [ { "atSec": <number>, "durationSec": <number>, "compId": "<exact id from catalog>", "reason": "<one sentence>" } ] }`;

  const user = `Video duration: ${videoDurationSec || 'unknown'} seconds.

TRANSCRIPT:
${transcript}

AVAILABLE B-ROLL COMPS (id, slug, duration):
${compList}

Pick the cuts. JSON only.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    const data = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const text = data.content?.[0]?.text || '';
    // Strip code-fence wrappers if Claude added them despite the JSON-only rule
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
    let plan;
    try { plan = JSON.parse(cleaned); }
    catch (err) {
      return res.status(500).json({ error: `Could not parse plan JSON: ${err.message}`, raw: text });
    }

    // Validate every compId exists; cap durations at each comp's native length
    // (and at 15s overall) so we never request frames the comp can't supply.
    const compById = new Map(catalog.comps.map(c => [c.id, c]));
    plan.cuts = (plan.cuts || []).flatMap(cut => {
      const comp = compById.get(cut.compId);
      if (!comp) {
        console.warn(`[broll/suggest] dropped unknown compId: ${cut.compId}`);
        return [];
      }
      const cappedDur = Math.min(cut.durationSec, comp.durationSec, 15);
      if (cappedDur !== cut.durationSec) {
        console.log(`[broll/suggest] capped ${cut.compId} from ${cut.durationSec}s to ${cappedDur}s (native ${comp.durationSec}s)`);
      }
      return [{ ...cut, durationSec: cappedDur }];
    });
    res.json({ success: true, plan, catalogCount: catalog.comps.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/broll/render', notViaTunnel, localBrowserOnly, async (req, res) => {
  const { videoPath, plan, name } = req.body || {};
  if (!videoPath || !plan?.cuts) return res.status(400).json({ error: 'videoPath and plan.cuts required' });
  if (plan.cuts.length === 0) return res.status(400).json({ error: 'plan has no cuts' });

  const runName = name || `broll_${Date.now()}`;
  const workDir = join(__dirname, 'renders', 'broll', runName);
  await mkdir(workDir, { recursive: true });

  const remotionRoot = join(__dirname, 'external', 'remotion');
  const catalog = await loadBrollCatalog();
  const compById = new Map(catalog.comps.map(c => [c.id, c]));

  // Resolve source video path (accept absolute or /renders/...)
  const srcVideo = videoPath.startsWith('/') && !videoPath.match(/^[A-Z]:/)
    ? join(__dirname, videoPath.replace(/^\//, ''))
    : videoPath;

  try {
    // 1. Render every comp in the plan to its cut duration
    const rendered = [];
    for (let i = 0; i < plan.cuts.length; i++) {
      const cut = plan.cuts[i];
      const comp = compById.get(cut.compId);
      if (!comp) {
        rendered.push({ ...cut, error: `comp not in catalog: ${cut.compId}` });
        continue;
      }
      const fps = comp.fps || 30;
      const cutFrames = Math.min(comp.durationFrames, Math.ceil(cut.durationSec * fps));
      const outFile = join(workDir, `broll_${i + 1}.mp4`);
      console.log(`[broll/render] ${i + 1}/${plan.cuts.length}: ${comp.id} (${cutFrames} frames)`);

      await withRemotionBrowserRetry(() => new Promise((resolve, reject) => {
        execFile('npx', [
          'remotion', 'render', 'src/index.ts', comp.id,
          outFile, '--frames', `0-${cutFrames - 1}`,
        ], { cwd: remotionRoot, timeout: 600000, shell: true }, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout);
        });
      }), 'broll-render');
      rendered.push({ ...cut, file: outFile });
    }

    // 2. FFmpeg splice — overlay each B-roll clip on top of the talking head
    //    at its atSec timestamp, original audio plays through underneath.
    const okCuts = rendered.filter(c => c.file);
    if (okCuts.length === 0) {
      return res.status(500).json({ error: 'no B-roll clips rendered successfully', rendered });
    }

    // Probe source dimensions so we can scale each comp to fill the frame.
    // POV/glasses footage is portrait (1216x1616); the comps are landscape
    // (1920x1080). Without this, the overlay covers only the top of the
    // frame and leaves the bottom strip showing the talking head.
    const probeOut = await new Promise((resolve, reject) => {
      execFile('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'csv=p=0',
        srcVideo,
      ], (err, stdout) => err ? reject(err) : resolve(stdout.trim()));
    });
    const [srcW, srcH] = probeOut.split(',').map(n => parseInt(n, 10));
    if (!srcW || !srcH) throw new Error(`ffprobe failed to read source dims (${probeOut})`);

    const finalOut = join(workDir, 'final.mp4');
    const inputs = ['-i', srcVideo, ...okCuts.flatMap(c => ['-i', c.file])];
    // Build filter_complex: each B-roll input scaled+cropped to fill source
    // (cover-style — preserves comp animation, may crop comp sides), then
    // overlay'd with `enable='between(t,start,end)'` so it only shows during
    // its window. Source video chain starts as [0:v]; each overlay step
    // produces [vN].
    const filterParts = [];
    let chain = '0:v';
    for (let i = 0; i < okCuts.length; i++) {
      const cut = okCuts[i];
      const inIdx = i + 1;            // input index (0 is source)
      const start = cut.atSec;
      const end = cut.atSec + cut.durationSec;
      const scaledTag = `b${i}`;
      const outTag = i === okCuts.length - 1 ? 'vout' : `v${i}`;
      // 1. scale to fill source dims preserving aspect (force_original_aspect_ratio=increase),
      //    then crop to source dims so the overlay exactly matches.
      // 2. setpts shifts the overlay so its frame 0 aligns with `start` in the
      //    main timeline. Without this, FFmpeg plays the overlay during 0..N
      //    of the main video and freezes on the last frame for the rest —
      //    so an overlay enabled at t=42 shows a static "last frame" graphic.
      filterParts.push(`[${inIdx}:v]scale=${srcW}:${srcH}:force_original_aspect_ratio=increase,crop=${srcW}:${srcH},setsar=1,setpts=PTS-STARTPTS+${start}/TB[${scaledTag}]`);
      filterParts.push(`[${chain}][${scaledTag}]overlay=x=0:y=0:enable='between(t,${start},${end})'[${outTag}]`);
      chain = outTag;
    }
    const filterComplex = filterParts.join(';');

    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-y',
        ...inputs,
        '-filter_complex', filterComplex,
        '-map', '[vout]',
        '-map', '0:a?',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
        '-c:a', 'copy',
        finalOut,
      ], { timeout: 60 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.split('\n').slice(-20).join('\n')));
        else resolve(stdout);
      });
    });

    res.json({
      success: true,
      url: `/renders/broll/${runName}/final.mp4`,
      cuts: okCuts.map(c => ({ atSec: c.atSec, durationSec: c.durationSec, compId: c.compId, reason: c.reason })),
      runName,
    });
  } catch (err) {
    console.error('[broll/render] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Command Runner — Block 2 of the endgame build plan ───────────────────
//
// Spawns a shell command and streams stdout/stderr/exit via Server-Sent
// Events. Tier 1 (no PTY); covers ~80% of one-shot use cases (ffmpeg / npm
// / pipeline-cli / git). The CommandRunnerNode is the canvas-side consumer.
//
// SECURITY: arbitrary shell exec from a network endpoint is a huge blast
// radius. Hard-gated to localhost regardless of Express config — never
// reachable via the Cloudflare tunnel that exposes the WhatsApp webhook.
// If you ever proxy this endpoint, you've broken the gate.
//
// Wire pattern (Block 4): a future left-input handle lets upstream nodes
// inject commands via wires. v1 ships with no input wire — operator types
// the command directly into the node.

const execJobs = new Map(); // jobId → { proc, startedAt, cwd, command }

const isLocalhostIp = (ip) =>
  ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

const localhostOnly = (req, res, next) => {
  const ip = req.ip || req.socket?.remoteAddress || '';
  if (!isLocalhostIp(ip)) {
    return res.status(403).json({ error: 'Forbidden — localhost-only endpoint' });
  }
  next();
};

// Windows kills only the cmd.exe shell wrapper when proc.kill() runs against
// a `shell: true` spawn. The actual command (ffmpeg, npm, git) keeps running
// as a child. taskkill /F /T /PID walks the tree and kills children too.
const killProcessTree = (proc) => {
  if (!proc || proc.killed) return;
  if (process.platform === 'win32') {
    try { execFile('taskkill', ['/F', '/T', '/PID', String(proc.pid)], () => {}); }
    catch {
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
    }
  } else {
    try { proc.kill('SIGTERM'); }
    catch {
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
    }
  }
};

// Wire-buffer staging — Block 4 of the endgame build plan. Canvas nodes
// can stage upstream content (script, prompt, transcript) into a known
// per-node file under wire-buffer/, then reference it from the user's
// command. The path is absolute in the response so commands work regardless
// of CWD. Localhost-only because the buffer can hold sensitive content
// (scripts, persona prompts, Mayordomo material).
const WIRE_BUFFER_DIR = join(__dirname, 'wire-buffer');
const wireBufferPath = (nodeId) => join(WIRE_BUFFER_DIR, `${nodeId}.txt`);

const isSafeNodeId = (s) =>
  typeof s === 'string' && s.length > 0 && s.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(s);

app.post('/api/wire-buffer/:nodeId', localhostOnly, async (req, res) => {
  const { nodeId } = req.params;
  if (!isSafeNodeId(nodeId)) return res.status(400).json({ error: 'invalid nodeId' });
  const { content } = req.body || {};
  if (typeof content !== 'string') return res.status(400).json({ error: 'content (string) required' });
  try {
    await mkdir(WIRE_BUFFER_DIR, { recursive: true });
    const fullPath = wireBufferPath(nodeId);
    await writeFile(fullPath, content, 'utf8');
    res.json({
      path: fullPath,
      relPath: `wire-buffer/${nodeId}.txt`,   // useful when CWD = repo
      bytes: Buffer.byteLength(content, 'utf8'),
    });
  } catch (err) {
    console.error(`[wire-buffer ${nodeId}] write failed:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/wire-buffer/:nodeId', localhostOnly, async (req, res) => {
  const { nodeId } = req.params;
  if (!isSafeNodeId(nodeId)) return res.status(400).json({ error: 'invalid nodeId' });
  try {
    await unlink(wireBufferPath(nodeId));
    res.json({ success: true });
  } catch (err) {
    // Missing file is fine — DELETE is idempotent.
    if (err.code === 'ENOENT') return res.json({ success: true, missing: true });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/exec', localhostOnly, async (req, res) => {
  const { command, cwd, env, stdinPayload, preamble, stageWireBuffer, inheritSecrets } = req.body || {};
  if (typeof command !== 'string' || !command.trim()) {
    return res.status(400).json({ error: 'command (non-empty string) required' });
  }
  const jobId = `exec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const workDir = (typeof cwd === 'string' && cwd.trim()) ? cwd.trim() : __dirname;

  // SSE headers — disable any intermediate buffering so output streams in
  // real time. flushHeaders kicks Express into streaming mode immediately
  // instead of waiting for the first body chunk.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send('start', { jobId, command, cwd: workDir });

  // The server process holds the full keyring (.env backfill at startup), but
  // user-typed commands must not inherit it by default — buildExecEnv strips
  // secret-looking names unless inheritSecrets opts back in (first-party CLIs
  // that genuinely need keys). Request env vars always apply last, unstripped.
  // The 'env' event tells the canvas node what was withheld (names only,
  // NEVER values) so a command missing a key is explainable, not mysterious.
  const inherit = inheritSecrets === true;
  const { env: execEnv, strippedKeys } = buildExecEnv(process.env, env || {}, {
    inheritSecrets: inherit,
  });
  send('env', { inheritSecrets: inherit, strippedCount: strippedKeys.length, strippedKeys });

  // Auto-create the CWD if missing — operators sometimes type a path that
  // doesn't exist yet (scaffolding a new project, etc). Recursive mkdir is
  // a no-op if it exists, so always-on is safe.
  try {
    await mkdir(workDir, { recursive: true });
  } catch (err) {
    send('error', { message: `cwd setup failed: ${err.message}` });
    return res.end();
  }

  // Block 4 inject — preamble (write file BEFORE spawn so the agent reads it
  // as project context). Filename defaults to CLAUDE.md but is overridable
  // (AGENTS.md, .codex.md, etc). Content silently overwrites if the file
  // already exists — that's the point: the wire is the source of truth.
  if (preamble && typeof preamble.content === 'string') {
    const fname = (typeof preamble.filename === 'string' && /^[\w.-]+$/.test(preamble.filename))
      ? preamble.filename
      : 'CLAUDE.md';
    try {
      await writeFile(join(workDir, fname), preamble.content, 'utf8');
      send('preamble', { filename: fname, bytes: Buffer.byteLength(preamble.content, 'utf8') });
    } catch (err) {
      send('error', { message: `preamble write failed: ${err.message}` });
      return res.end();
    }
  }

  // Block 4 inject — wire-buffer staging before spawn. Same path the
  // POST /api/wire-buffer endpoint uses; the spawned command can reference
  // it relative-to-repo or via absolute path.
  if (stageWireBuffer && isSafeNodeId(stageWireBuffer.nodeId) && typeof stageWireBuffer.content === 'string') {
    try {
      await mkdir(WIRE_BUFFER_DIR, { recursive: true });
      const stagedPath = wireBufferPath(stageWireBuffer.nodeId);
      await writeFile(stagedPath, stageWireBuffer.content, 'utf8');
      send('wireBuffer', {
        path: stagedPath,
        relPath: `wire-buffer/${stageWireBuffer.nodeId}.txt`,
        bytes: Buffer.byteLength(stageWireBuffer.content, 'utf8'),
      });
    } catch (err) {
      send('error', { message: `wire-buffer staging failed: ${err.message}` });
      return res.end();
    }
  }

  let proc;
  try {
    proc = spawn(command, [], {
      shell: true,
      cwd: workDir,
      env: execEnv,
    });
  } catch (err) {
    send('error', { message: err.message });
    return res.end();
  }

  // Block 4 inject — stdin payload. Pipe content into the spawned process's
  // stdin and close the stream so the child doesn't hang waiting for more.
  // Useful for `claude < $payload`, `python script.py < $payload`, etc.
  if (typeof stdinPayload === 'string' && stdinPayload.length > 0) {
    try {
      proc.stdin.write(stdinPayload);
      proc.stdin.end();
      send('stdin', { bytes: Buffer.byteLength(stdinPayload, 'utf8') });
    } catch (err) {
      send('error', { message: `stdin write failed: ${err.message}` });
    }
  }

  execJobs.set(jobId, { proc, startedAt: Date.now(), cwd: workDir, command });
  console.log(`[exec ${jobId}] spawn: ${command.slice(0, 80)}${command.length > 80 ? '…' : ''}`);

  proc.stdout.on('data', (chunk) => send('stdout', { text: chunk.toString('utf8') }));
  proc.stderr.on('data', (chunk) => send('stderr', { text: chunk.toString('utf8') }));
  proc.on('close', (code, signal) => {
    send('exit', { code, signal });
    execJobs.delete(jobId);
    console.log(`[exec ${jobId}] exit ${code}${signal ? ` (signal ${signal})` : ''}`);
    res.end();
  });
  proc.on('error', (err) => {
    send('error', { message: err.message });
    execJobs.delete(jobId);
    res.end();
  });

  // Kill on client disconnect — operator closed the node, navigated away,
  // or canvas refreshed. Without this, killed front-end leaves orphan
  // processes (npm install, ffmpeg renders) eating CPU until the OS reaps.
  //
  // proc.exitCode is set by Node the instant the process terminates, BEFORE
  // proc.on('close') fires. We use it (plus proc.killed for signal-kill) to
  // distinguish real client aborts from the race where Node's event loop
  // processes req.on('close') ahead of proc.on('close') for fast commands.
  // Without this guard, every successful run logged a misleading
  // "client disconnected → kill" tail.
  req.on('close', () => {
    const job = execJobs.get(jobId);
    if (!job) return;
    const procExited = proc.exitCode !== null || proc.killed;
    if (procExited) {
      // Natural completion tail — proc.on('close') will clean up; nothing to do.
      return;
    }
    console.log(`[exec ${jobId}] client disconnected → kill`);
    killProcessTree(proc);
    execJobs.delete(jobId);
  });
});

app.post('/api/exec/:jobId/stop', localhostOnly, (req, res) => {
  const { jobId } = req.params;
  const job = execJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'job not found (already finished or never existed)' });
  console.log(`[exec ${jobId}] stop request`);
  killProcessTree(job.proc);
  // SIGKILL fallback after 3s if SIGTERM didn't take — ffmpeg sometimes
  // ignores the first signal mid-encode. The tree-kill above on Windows is
  // already SIGKILL-equivalent (taskkill /F), so this is a unix safety net.
  setTimeout(() => {
    const stillThere = execJobs.get(jobId);
    if (stillThere && process.platform !== 'win32') {
      try { stillThere.proc.kill('SIGKILL'); } catch { /* SIGKILL fallback — already dead */ }
    }
  }, 3000);
  res.json({ success: true, jobId });
});

// ── Real PTY Terminal — Block 3 of the endgame build plan ───────────────
//
// node-pty + ws WebSocket server. Each TerminalNode on the canvas opens
// /ws/terminal/<nodeId> to spawn a fresh shell PTY (cmd.exe on Windows,
// $SHELL on unix). Bidirectional pipe — keystrokes flow client→server, PTY
// output flows server→client, resize messages reshape the PTY.
//
// SECURITY GATE (mandatory per PRD):
//   1. localhost-only bind on the upgrade handler — non-127.0.0.1 connects
//      get a hard 403 before the WebSocket protocol upgrade completes.
//   2. one-shot token issued at startup, fetched via /api/terminal/token
//      (also localhost-only). Required as ?token= on the WS URL. Defends
//      against malicious local apps that bypass the localhost check by
//      definition (they're on the box).
//   3. Cloudflare tunnel must NOT route /ws/* — currently it doesn't, but
//      this is a config-level discipline, not enforced here.

const ptyJobs = new Map();   // nodeId → { pty, ws, startedAt, pid }

// Cryptographic random token for WS handshake. Regenerated each server
// startup — operators get a fresh credential per session, no persistence.
const WS_TOKEN = crypto.randomBytes(24).toString('hex');

app.get('/api/terminal/token', localhostOnly, (_req, res) => {
  res.json({ token: WS_TOKEN });
});

const wss = new WebSocketServer({ noServer: true });

const handleTerminalWS = (ws, nodeId) => {
  // Re-connect cleanup: if a previous PTY exists for this nodeId (canvas
  // refresh, HMR), kill it before spawning a fresh shell.
  const existing = ptyJobs.get(nodeId);
  if (existing) {
    try { existing.pty.kill(); } catch { /* already dead */ }
    if (existing.ws !== ws && existing.ws.readyState === existing.ws.OPEN) {
      try { existing.ws.close(); } catch { /* already closed */ }
    }
  }

  const shellCmd = process.platform === 'win32'
    ? 'cmd.exe'
    : (process.env.SHELL || 'bash');

  let pty;
  try {
    pty = ptySpawn(shellCmd, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: __dirname,
      env: process.env,
    });
  } catch (err) {
    console.error(`[ws/terminal ${nodeId}] PTY spawn failed: ${err.message}`);
    ws.send(JSON.stringify({ type: 'error', message: `PTY spawn failed: ${err.message}` }));
    ws.close();
    return;
  }

  ptyJobs.set(nodeId, { pty, ws, startedAt: Date.now(), pid: pty.pid });
  console.log(`[ws/terminal ${nodeId}] PTY spawned (pid ${pty.pid}, ${shellCmd})`);

  // ─── LivePreview tap state (Block 4.5 — wire-out from Terminal) ────────
  // Three best-effort feeds layered on top of the existing data flow:
  //   1. `plain`   — ANSI-stripped stdout for the log-mode tail
  //   2. `urls`    — auto-detected http/localhost URLs (deduped)
  //   3. `cwd-file`— newest file changed in the pty's initial cwd
  // Tap failures must never break the terminal — every handler is wrapped.
  const URL_REGEX = /\b(?:https?:\/\/[^\s)\]}"']+|(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s)\]}"']*)?)/gi;
  const ANSI_REGEX = /\x1b\[[\d;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_].*?\x1b\\|[\x00-\x08\x0b-\x1f]/g;
  const FILE_IGNORE_RX = /(?:^|[\\/])(?:\.git|\.tmp|\.claude|\.secrets|node_modules|crystals|external|wire-buffer|\.vite|dist|\.next|coverage)(?:[\\/]|$)/;
  const fileKind = (rel) => {
    const ext = (rel.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    if (/^(png|jpg|jpeg|gif|webp|avif|svg|bmp|ico)$/.test(ext)) return 'image';
    if (/^(mp4|mov|webm|mkv|m4v)$/.test(ext)) return 'video';
    if (/^(mp3|wav|ogg|flac|m4a|aac)$/.test(ext)) return 'audio';
    if (/^(html|htm)$/.test(ext)) return 'html';
    if (/^(txt|md|log|json|yaml|yml|csv|js|jsx|ts|tsx|py|sh|css|toml|ini|env)$/.test(ext)) return 'text';
    return 'other';
  };
  const stripAnsi = (s) => s.replace(ANSI_REGEX, '');

  const seenUrls = new Set();
  let urlScanBuf = '';   // tail buffer so URLs split across chunks still match
  let cwdWatcher = null;
  let fileDebounce = null;
  let lastFileEmit = null;

  // File watcher — Windows supports {recursive:true} natively; on Linux it's
  // ignored but per-directory events still work for the top-level repo. Either
  // way, it's best-effort: if the kernel drops events under load, the next
  // write is what re-arms the LivePreview viewer.
  try {
    cwdWatcher = fsWatch(__dirname, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      if (FILE_IGNORE_RX.test(filename)) return;
      if (filename.startsWith('.')) return;
      // Debounce — editors fire bursts of stat/write/close events per save.
      if (fileDebounce) clearTimeout(fileDebounce);
      fileDebounce = setTimeout(async () => {
        fileDebounce = null;
        try {
          const fullPath = join(__dirname, filename);
          if (!existsSync(fullPath)) return;
          const s = await stat(fullPath);
          if (s.isDirectory()) return;
          if (lastFileEmit && lastFileEmit.path === fullPath && lastFileEmit.mtime === s.mtimeMs) return;
          lastFileEmit = { path: fullPath, mtime: s.mtimeMs };
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
              type: 'cwd-file',
              relPath: filename.replace(/\\/g, '/'),
              kind: fileKind(filename),
              mtime: s.mtimeMs,
            }));
          }
        } catch { /* file vanished or stat failed — fine */ }
      }, 200);
    });
  } catch (err) {
    console.warn(`[ws/terminal ${nodeId}] cwd watch unavailable: ${err.message}`);
  }

  // Coalesce PTY output in 8ms windows (~120Hz) before sending. Codex-class
  // TUIs emit hundreds of tiny escape sequences per second; a per-chunk
  // ws.send overwhelms the browser's main thread (xterm parse/render path)
  // and crashes the tab. Batching cuts the message rate by ~10× without
  // hurting interactivity — keystroke-to-screen still feels live.
  let dataBuffer = '';
  let flushTimer = null;
  const FLUSH_MS = 8;
  const flushPtyData = () => {
    flushTimer = null;
    if (!dataBuffer) return;
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data: dataBuffer }));
    }
    dataBuffer = '';
  };

  pty.onData((data) => {
    dataBuffer += data;
    if (!flushTimer) {
      flushTimer = setTimeout(flushPtyData, FLUSH_MS);
    }
    // ─── LivePreview tap ── ANSI-strip → URL scan + plain stdout emit ──
    // Wrapped so any failure here is contained to the wire-out path; the
    // raw `data` event above is the terminal's lifeline.
    try {
      const plain = stripAnsi(data);
      if (!plain) return;
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'plain', text: plain }));
      }
      urlScanBuf += plain;
      const matches = urlScanBuf.match(URL_REGEX) || [];
      const fresh = [];
      for (let u of matches) {
        u = u.replace(/[.,;:!?'"`)\]}]+$/, '');
        if (!u) continue;
        if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
        if (seenUrls.has(u)) continue;
        seenUrls.add(u);
        fresh.push(u);
      }
      if (fresh.length && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'urls', urls: fresh }));
      }
      // Bound the scan buffer so it doesn't grow unbounded over a long session.
      if (urlScanBuf.length > 4096) urlScanBuf = urlScanBuf.slice(-2048);
    } catch { /* tap failure — keep terminal alive */ }
  });

  pty.onExit(({ exitCode, signal }) => {
    // Drain any buffered output before the exit notice — otherwise the
    // shell's final lines get lost when the WS closes.
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushPtyData();
    console.log(`[ws/terminal ${nodeId}] PTY exit ${exitCode}${signal ? ` signal ${signal}` : ''}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code: exitCode, signal }));
      ws.close();
    }
    ptyJobs.delete(nodeId);
  });

  // WS → PTY. Two message types: 'data' (keystrokes) and 'resize' (cols/rows
  // updates from xterm.js's FitAddon). Anything malformed is silently ignored.
  ws.on('message', (msg) => {
    let parsed;
    try { parsed = JSON.parse(msg.toString()); } catch { return; }
    if (parsed.type === 'data' && typeof parsed.data === 'string') {
      try { pty.write(parsed.data); } catch { /* PTY closed mid-message */ }
    } else if (parsed.type === 'resize'
               && Number.isInteger(parsed.cols) && parsed.cols > 0
               && Number.isInteger(parsed.rows) && parsed.rows > 0) {
      try { pty.resize(parsed.cols, parsed.rows); } catch { /* PTY closed */ }
    }
  });

  // WS close → kill PTY tree. node-pty's pty.kill() sends SIGHUP on unix
  // and a Windows job-object terminate on win32 — both reap children.
  ws.on('close', () => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (fileDebounce) { clearTimeout(fileDebounce); fileDebounce = null; }
    if (cwdWatcher) { try { cwdWatcher.close(); } catch { /* already closed */ } cwdWatcher = null; }
    if (ptyJobs.get(nodeId)?.pty === pty) {
      console.log(`[ws/terminal ${nodeId}] WS closed → kill PTY`);
      try { pty.kill(); } catch { /* already dead */ }
      ptyJobs.delete(nodeId);
    }
  });

  ws.on('error', (err) => {
    console.warn(`[ws/terminal ${nodeId}] WS error: ${err.message}`);
  });
};

// ── Mayordomo Live — voice agent surface ───────────────────────────────────
// Mint a short-lived token so the local browser page can join the room.
app.get('/api/livekit/token', async (req, res) => {
  try {
    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: 'operator',
      ttl: '1h',
    });
    at.addGrant({ room: 'mayordomo', roomJoin: true, canPublish: true, canSubscribe: true });
    const token = await at.toJwt();
    res.json({ url: process.env.LIVEKIT_URL, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve the static voice page at http://localhost:3001/voice
app.use('/voice', express.static(join(__dirname, 'voice-agent', 'web')));

// PTT bridge: AHK hits /api/ptt/:state, the page listens on /api/ptt/stream (SSE).
// NOTE: /stream is registered before /:state so it isn't captured as a state value.
const pttClients = new Set();
app.get('/api/ptt/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write(': connected\n\n');
  pttClients.add(res);
  req.on('close', () => pttClients.delete(res));
});
app.get('/api/ptt/:state', (req, res) => {
  const state = req.params.state === 'down' ? 'down' : 'up';
  for (const client of pttClients) client.write(`data: ${state}\n\n`);
  res.sendStatus(200);
});

// Canvas voice dock — own the Python worker process (localhost-only; spawns a process).
const voiceWorker = createVoiceWorker();
app.post('/api/voice/start', localhostOnly, (_req, res) => {
  try { res.json(voiceWorker.start()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/voice/stop', localhostOnly, (_req, res) => {
  res.json(voiceWorker.stop()); // ignores body — safe for navigator.sendBeacon
});
app.get('/api/voice/status', localhostOnly, (_req, res) => {
  res.json(voiceWorker.status());
});

// ── Arecibo Transmission ─────────────────────────────────────────────

function lastCompleteWeekUtc(now = new Date()) {
  // Most recent complete Mon 00:00 → next Mon 00:00 window.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  const thisMonday = new Date(d);
  thisMonday.setUTCDate(d.getUTCDate() - dow);
  const from = new Date(thisMonday);
  from.setUTCDate(thisMonday.getUTCDate() - 7);
  return {from: from.toISOString(), to: thisMonday.toISOString()};
}

function isoWeekInfo(iso) {
  // ISO-8601 week number for the window start.
  const d = new Date(iso);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const ftDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDay + 3);
  const weekNumber = 1 + Math.round((t - firstThursday) / (7 * 24 * 3600 * 1000));
  return {weekNumber, year: t.getUTCFullYear(), weekLabel: `${t.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`};
}

function foldWeekStats(events, fromIso) {
  const counts = {script: 0, image: 0, video: 0, carousel: 0, post: 0};
  const daily = [0, 0, 0, 0, 0, 0, 0];
  for (const ev of events) {
    if (counts[ev.type] !== undefined) {
      counts[ev.type]++;
      daily[(new Date(ev.ts).getUTCDay() + 6) % 7]++;
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {...isoWeekInfo(fromIso), counts, daily, total, highlight: null};
}

async function areciboCaption(stats) {
  const fallback = () => {
    const top = ARECIBO_CATEGORIES.reduce((a, b) => (stats.counts[b] > stats.counts[a] ? b : a), 'script');
    const caption = stats.total === 0 ? 'silence.' : `Week ${stats.weekNumber}: ${stats.total} transmissions. The machine hums.`;
    return {highlight: stats.total === 0 ? null : top, caption, captionSource: 'fallback'};
  };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || stats.total === 0) return fallback();
  try {
    const prompt = `Breadstick weekly recap. Week ${stats.weekLabel}. Counts — script:${stats.counts.script} image:${stats.counts.image} video:${stats.counts.video} carousel:${stats.counts.carousel} post:${stats.counts.post}. Daily Mon..Sun: ${stats.daily.join(',')}.\nPick the single most notable category and write a one-line caption (max 12 words, transmission-log voice, no emoji).\nReply with EXACTLY this JSON and nothing else: {"highlight":"<script|image|video|carousel|post>","caption":"<line>"}`;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
      body: JSON.stringify({model: 'claude-haiku-4-5-20251001', max_tokens: 150, messages: [{role: 'user', content: prompt}]}),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return fallback();
    const data = await r.json();
    const parsed = JSON.parse((data.content?.[0]?.text || '').trim());
    if (!ARECIBO_CATEGORIES.includes(parsed.highlight) || typeof parsed.caption !== 'string' || !parsed.caption) return fallback();
    return {highlight: parsed.highlight, caption: parsed.caption.slice(0, 120), captionSource: 'model'};
  } catch {
    return fallback();
  }
}

app.get('/api/arecibo/recap', localhostOnly, async (req, res) => {
  try {
    const defaults = lastCompleteWeekUtc();
    const from = req.query.from || defaults.from;
    let to = req.query.to || defaults.to;
    if (new Date(to) > new Date()) to = new Date().toISOString();
    if (new Date(from) >= new Date(to)) return res.status(400).json({error: 'from must precede to'});
    const stats = foldWeekStats(readWindow(from, to), from);
    const {highlight, caption, captionSource} = await areciboCaption(stats);
    stats.highlight = highlight;
    const {bits, grid, sections} = encodeWeek(stats);
    res.json({weekLabel: stats.weekLabel, stats, bits, grid, sections, highlight, caption, captionSource, window: {from, to}});
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

app.post('/api/arecibo/render', localhostOnly, async (req, res) => {
  try {
    const {bits, sections, caption = '', weekLabel = 'week', highlight = null} = req.body || {};
    if (!Array.isArray(bits) || bits.length !== 943) return res.status(400).json({error: 'bits must be a 943-length array'});
    const safeLabel = String(weekLabel).replace(/[^\w-]/g, '_');
    const outDir = join(__dirname, 'renders', 'arecibo', safeLabel);
    await mkdir(outDir, {recursive: true});
    const propsPath = join(outDir, 'props.json');
    await writeFile(propsPath, JSON.stringify({bits, sections, caption, weekLabel, highlight}));
    const videoPath = join(outDir, 'transmission.mp4');
    const stillPath = join(outDir, 'cipher.png');

    const runRemotionCmd = (args) => new Promise((resolve, reject) => {
      const proc = spawn('npx', args, {cwd: __dirname, shell: true, timeout: 600000});
      let stderrBuf = '';
      proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });
      proc.on('error', reject);
      const tail = (s) => String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(-800).trim();
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(tail(stderrBuf) || `exit ${code}`))));
    });

    await withRemotionBrowserRetry(
      () => runRemotionCmd(['remotion', 'render', 'src/remotion/index.jsx', 'AreciboTransmission', videoPath, `--props=${propsPath}`, '--log=error']),
      'arecibo-render'
    );
    await withRemotionBrowserRetry(
      () => runRemotionCmd(['remotion', 'still', 'src/remotion/index.jsx', 'AreciboTransmission', stillPath, '--frame=285', `--props=${propsPath}`, '--log=error']),
      'arecibo-still'
    );
    res.json({
      videoPath, stillPath,
      videoUrl: `/renders/arecibo/${safeLabel}/transmission.mp4`,
      stillUrl: `/renders/arecibo/${safeLabel}/cipher.png`,
    });
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

const PORT = Number(process.env.BREADSTICK_PORT || process.env.PORT || 3001);
const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (!url.pathname.startsWith('/ws/terminal/')) {
    socket.destroy();
    return;
  }

  // SECURITY GATE 1: localhost-only. Reject before any protocol upgrade.
  const ip = req.socket?.remoteAddress || '';
  if (!isLocalhostIp(ip)) {
    console.warn(`[ws/terminal] rejected non-localhost connection from ${ip}`);
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  // SECURITY GATE 2: token check. Defends against malicious local apps
  // (which would bypass the localhost check by definition).
  const token = url.searchParams.get('token');
  if (token !== WS_TOKEN) {
    console.warn(`[ws/terminal] rejected — token mismatch`);
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  // Extract + validate nodeId
  const nodeId = url.pathname.slice('/ws/terminal/'.length);
  if (!nodeId || !/^[a-zA-Z0-9_-]+$/.test(nodeId) || nodeId.length > 64) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    handleTerminalWS(ws, nodeId);
  });
});

server.listen(PORT, resolveBindHost(), () => {
  console.log(`Breadstick API proxy running on http://localhost:${PORT}`);
  console.log(`[ws/terminal] auth token issued — fetch via GET /api/terminal/token (localhost-only)`);
  registerProactiveSchedules();
  registerScoreboardSchedules();
  registerLifejournalSchedules();
});

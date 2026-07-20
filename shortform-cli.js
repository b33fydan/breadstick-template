#!/usr/bin/env node
/**
 * Breadstick Shortform CLI — Quick Take Pipeline
 *
 * Two modes:
 *   1. QUICKTAKE — Generate teleprompter script, upload to Drive
 *   2. PROCESS   — Watch for raw video in Drive, edit, grade, upload final
 *
 * Usage:
 *   node shortform-cli.js quicktake "Prompt Injection"
 *   node shortform-cli.js quicktake "Zero Trust" --bullets 7 --duration 60
 *   node shortform-cli.js process                          # poll once
 *   node shortform-cli.js process --watch                  # poll loop
 *
 * Environment:
 *   ANTHROPIC_API_KEY  — for script generation
 *   ELEVENLABS_API_KEY — for video-use transcription
 */

import 'dotenv/config';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { withRemotionBrowserRetry } from './src/lib/remotionRetry.js';
import { slugify, timestamp, callAnthropic, createKieTask, pollKieTask } from './lib/cli-core.js';

// ── Constants ───────────────────────────────────────────────────────────────

const SERVER = 'http://localhost:3001';
const WORK_DIR = join(import.meta.dirname, 'pipeline', 'shortform');
const LUTS_DIR = join(import.meta.dirname, 'pipeline', 'luts');

// Google Drive folder IDs
const DRIVE_FOLDERS = {
  teleprompter: process.env.DRIVE_TELEPROMPTER_FOLDER || '',
  shortformIn:  process.env.DRIVE_SHORTFORM_IN_FOLDER || '',
  shortformOut: process.env.DRIVE_SHORTFORM_OUT_FOLDER || '',
};

// Notion: Teleprompter Scripts database
const NOTION_DB_ID = process.env.NOTION_TELEPROMPTER_DB_ID || '';
const NOTION_API_VERSION = '2022-06-28';

// ── Helpers ─────────────────────────────────────────────────────────────────

function driveUpload(filePath, parentId, name = null) {
  const args = ['gws', 'drive', '+upload', filePath];
  if (parentId) args.push('--parent', parentId);
  if (name) args.push('--name', name);
  // 30 min — bumped from 15 min on 2026-05-10 after a real-world timeout on a
  // ~150 MB composite (residential bandwidth + gws-cli OAuth/keyring overhead).
  // If this trips again, background the upload instead of pushing it higher.
  const result = execSync(args.join(' '), { encoding: 'utf8', timeout: 1800000 });
  try { return JSON.parse(result); } catch { return result; }
}

function driveListFolder(folderId) {
  const q = `'${folderId}' in parents and trashed = false`;
  const params = JSON.stringify({ q, fields: 'files(id,name,mimeType,createdTime)' });
  // Use double-quote wrapping for Windows shell compatibility
  const cmd = `gws drive files list --params "${params.replace(/"/g, '\\"')}"`;
  const result = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
  try { const parsed = JSON.parse(result); return parsed.files || []; } catch { return []; }
}

function driveDownload(fileId, outputPath) {
  const params = JSON.stringify({ fileId, alt: 'media' });
  const cmd = `gws drive files get --params "${params.replace(/"/g, '\\"')}" -o "${outputPath}"`;
  execSync(cmd, { encoding: 'utf8', timeout: 120000 });
}

async function anthropic(systemPrompt, userPrompt) {
  const { text } = await callAnthropic({
    server: SERVER,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  return text;
}

// ── Notion helpers ──────────────────────────────────────────────────────────

function parseInlineRichText(text) {
  // Split on **bold** markers, produce Notion rich_text array with bold annotations preserved
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(s => s.length > 0);
  const out = [];
  for (const p of parts) {
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) {
      out.push({ type: 'text', text: { content: p.slice(2, -2) }, annotations: { bold: true } });
    } else if (p) {
      out.push({ type: 'text', text: { content: p } });
    }
  }
  return out.length ? out : [{ type: 'text', text: { content: text } }];
}

function mdLineToBlock(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed === '---') return { object: 'block', type: 'divider', divider: {} };

  // Markdown-style headings
  if (trimmed.startsWith('### ')) return { object: 'block', type: 'heading_3', heading_3: { rich_text: parseInlineRichText(trimmed.slice(4)) } };
  if (trimmed.startsWith('## '))  return { object: 'block', type: 'heading_2', heading_2: { rich_text: parseInlineRichText(trimmed.slice(3)) } };
  if (trimmed.startsWith('# '))   return { object: 'block', type: 'heading_1', heading_1: { rich_text: parseInlineRichText(trimmed.slice(2)) } };

  // Cue-card section labels → heading_3 so they pop on mobile
  if (/^CUE CARD\b/i.test(trimmed)) return { object: 'block', type: 'heading_2', heading_2: { rich_text: parseInlineRichText(trimmed) } };
  if (/^(OPEN|BEATS|CLOSE|OVERLAY TERMS|Shooting)\b/i.test(trimmed)) {
    return { object: 'block', type: 'heading_3', heading_3: { rich_text: parseInlineRichText(trimmed) } };
  }

  // Lists
  const bulletMatch = trimmed.match(/^[-•]\s+(.+)$/);
  if (bulletMatch) {
    return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: parseInlineRichText(bulletMatch[1]) } };
  }
  const numberedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
  if (numberedMatch) {
    return { object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: parseInlineRichText(numberedMatch[1]) } };
  }

  // Blockquote
  if (trimmed.startsWith('> ')) {
    return { object: 'block', type: 'quote', quote: { rich_text: parseInlineRichText(trimmed.slice(2)) } };
  }

  // Default: paragraph
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: parseInlineRichText(trimmed) } };
}

function buildNotionBlocks(script, format, count, duration, style) {
  const blocks = [];

  // Top callout with metadata
  const countLabel = format === 'beats' ? 'beats' : 'bullets';
  const povNote = format === 'beats' ? '  •  POV glasses' : '';
  const headerText = `${duration}s  •  ${count} ${countLabel}  •  ${style}${povNote}`;
  blocks.push({
    object: 'block',
    type: 'callout',
    callout: {
      icon: { type: 'emoji', emoji: format === 'beats' ? '🎯' : '📹' },
      rich_text: [{ type: 'text', text: { content: headerText }, annotations: { bold: true } }],
      color: format === 'beats' ? 'orange_background' : 'blue_background',
    },
  });

  // Convert script lines
  for (const rawLine of script.split('\n')) {
    const block = mdLineToBlock(rawLine.replace(/\r$/, ''));
    if (block) blocks.push(block);
  }

  // Closing delivery-note callout
  const deliveryNote = format === 'beats'
    ? 'Glance once before recording. Do not read. Just remember the anchors and talk naturally.'
    : 'Read each bullet as one breath. Pause between bullets. Let the hook land before moving on.';
  blocks.push({
    object: 'block',
    type: 'callout',
    callout: {
      icon: { type: 'emoji', emoji: '💡' },
      rich_text: [{ type: 'text', text: { content: deliveryNote }, annotations: { italic: true } }],
      color: 'gray_background',
    },
  });

  return blocks;
}

function extractBoldTerms(script) {
  const matches = script.match(/\*\*([^*\n]+)\*\*/g) || [];
  const terms = matches.map(m => m.replace(/\*\*/g, '').trim()).filter(t => t && t.length < 80);
  return [...new Set(terms)];
}

async function notionCreatePage({ topic, format, script, count, duration, style }) {
  const token = process.env.NOTION_API_KEY;
  if (!token) return { skipped: true, reason: 'NOTION_API_KEY not set in .env' };

  const keyTerms = extractBoldTerms(script);
  const children = buildNotionBlocks(script, format, count, duration, style);

  const body = {
    parent: { database_id: NOTION_DB_ID },
    icon: { type: 'emoji', emoji: format === 'beats' ? '🎯' : '📹' },
    properties: {
      'Topic':     { title: [{ text: { content: topic.slice(0, 2000) } }] },
      'Status':    { select: { name: 'Draft' } },
      'Format':    { select: { name: format === 'beats' ? 'Beats' : 'Teleprompter' } },
      'Platform':  { multi_select: [{ name: 'TikTok' }, { name: 'Reels' }, { name: 'Shorts' }] },
      'Duration':  { number: duration },
      'Style':     { select: { name: style } },
      'Bullets':   { number: count },
      'Key Terms': { multi_select: keyTerms.map(t => ({ name: t })) },
    },
    children,
  };

  try {
    const resp = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return { error: data.message || `HTTP ${resp.status}`, code: data.code };
    }
    return { url: data.url, id: data.id };
  } catch (e) {
    return { error: e.message };
  }
}

// ── Transcript → Key Term matching (alias-aware) ───────────────────────────

// Common ElevenLabs Scribe mis-hearings of brand/tool terms.
// Key is canonical (lowercased). Values are phrase variants that should count as a match.
const TRANSCRIPT_ALIASES = {
  'claude code':    ['cloud code', 'clod code', 'clawed code'],
  'claude.md':      ['cloud md', 'claude md', 'cloud m d', 'claude m d', 'cloudmd', 'claudemd'],
  '/compact':       ['slash compact', 'compact'],
  '/clear':         ['slash clear', 'clear'],
  'subagents':      ['sub agents', 'subagent', 'sub-agents'],
  'mcp':            ['m c p', 'mcp', 'em cee pee'],
  'kie.ai':         ['kie ai', 'kee ai', 'key ai', 'k i ai'],
  'elevenlabs':     ['eleven labs', 'elevenlabs'],
  '16-gami':        ['sixteen gami', 'sixteen gummy', '16 gami'],
  'remotion':       ['remotion', 'ree motion'],
  'blotato':        ['blotato', 'blow tah toe', 'bluh tato'],
  'haiku':          ['haiku', 'hi koo'],
  'opus':           ['opus', 'opis'],
  'context window': ['context window', 'contexts window'],
  'rate limits':    ['rate limits', 'rate limit'],
};

function getTermVariants(canonicalTerm) {
  const lower = canonicalTerm.toLowerCase();
  const aliases = TRANSCRIPT_ALIASES[lower] || [];
  return [...new Set([canonicalTerm, ...aliases])];
}

// Find a phrase (space-separated words) inside a word-timestamped transcript.
// Returns {startIdx, endIdx} (inclusive) for the first match, or null.
//
// Strategy: try exact contiguous match first. If that fails, fall back to
// progressively shorter contiguous SUBSTRINGS of the phrase (drop one word
// from either end, repeat). Last-resort: longest single keyword from the
// phrase. This makes the resolver resilient to small Claude paraphrases
// like "the DDoS attack" vs "this DDoS attack" — the core noun phrase still
// locks even when the surrounding words drift.
function findPhraseInWords(phrase, words, minStartIdx = 0) {
  const phraseWords = phrase.toLowerCase().split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
  if (phraseWords.length === 0) return null;

  const tryExact = (slice) => {
    if (slice.length === 0) return null;
    outer: for (let wi = minStartIdx; wi <= words.length - slice.length; wi++) {
      for (let tw = 0; tw < slice.length; tw++) {
        const txWord = (words[wi + tw].text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (txWord !== slice[tw]) continue outer;
      }
      return { startIdx: wi, endIdx: wi + slice.length - 1 };
    }
    return null;
  };

  // 1. Exact full-phrase match.
  let m = tryExact(phraseWords);
  if (m) return m;

  // 2. Progressive substrings: drop 1 word from start, then end, then both, etc.
  for (let drop = 1; drop < phraseWords.length; drop++) {
    for (let start = 0; start + (phraseWords.length - drop) <= phraseWords.length; start++) {
      const slice = phraseWords.slice(start, start + (phraseWords.length - drop));
      m = tryExact(slice);
      if (m) {
        console.log(`    ~ fuzzy match: "${phrase}" → matched substring "${slice.join(' ')}"`);
        return m;
      }
    }
  }

  // 3. Last resort: the LONGEST single keyword (≥4 chars to skip filler).
  const keywords = [...phraseWords].sort((a, b) => b.length - a.length).filter(w => w.length >= 4);
  for (const kw of keywords) {
    m = tryExact([kw]);
    if (m) {
      console.log(`    ~ keyword fallback: "${phrase}" → matched "${kw}"`);
      return m;
    }
  }

  return null;
}

// ── Skyframe 5-beat overlay helpers ────────────────────────────────────────
//
// Wires `process --overlay skyframe-5beat`: Claude reads the transcript and
// returns a beat plan with anchor PHRASES (not timestamps); we resolve those
// phrases against the word-level transcript so Claude can't misalign timing.

function buildSkyframeBeatsPrompt(transcriptText, durationSec) {
  return `You are planning a 5-beat motion-graphics overlay for a ${durationSec.toFixed(1)}s shortform video.
Pick anchor phrases pulled VERBATIM from the transcript so we can locate them in word-level timestamps.
The CLI resolves anchor phrases → real time. Don't paraphrase. Don't invent words.

CRITICAL ANCHOR RULE: For beats 2, 3, and 4, \`anchorPhrase\` MUST be 4-8 CONSECUTIVE words pulled
verbatim from the transcript. Single-word anchors cause false matches when common words repeat
elsewhere in the script — the overlay then lands at the wrong moment. Choose a phrase distinctive
enough that it appears EXACTLY ONCE in the transcript. The OpusGlisten beat (Beat 5) is the only
exception: its anchor is the single emphasis word being spoken.

The 5-beat structure is fixed. Always return exactly 5 beats, in this order:

Beat 1 — RayBanIntro (HOOK). No anchor — fixed 0-3s.
  Layout reads top-to-bottom as a TITLE CARD with 4 elements, each with a DISTINCT role:
    topWord     — small white EYEBROW tag, sets context (≤8 chars).
                  Examples: "WARNING", "REALITY", "TIP 1", "TRUTH", "STOP".
                  NOT a redundant alarm word if other slots already alarm.
    heroPhrase  — the BIG yellow claim. ONE clear thought from the script (caps, 10-18 chars).
                  This is the load-bearing line. Tight is better — "AI IS EXPOSED" beats
                  "ARTIFICIAL INTELLIGENCE IS EXPOSED". Example: "AI CODE IS EXPOSED".
    pixelPhrase — chunky 8-bit BRAND STAMP word/phrase (caps, 4-10 chars).
                  HARD upper bound: 10 chars. Past that the pixel-block overflows the frame.
                  Must add a NEW angle, NOT restate the heroPhrase.
                  Examples (paired with above hero): "VIBE CODED", "FAKE IMPORTS",
                  "NO AUDIT", "SHIP-FIRST". Specific, punchy, brand-shape.
    subtitle    — muted CLARIFIER tail (≤32 chars). One short factual line that
                  earns the hero claim. Example: "AI ships fast, ships unsafe."

  HARD RULE: heroPhrase and pixelPhrase MUST express different ideas — never
  synonyms. If hero says "exposed", pixel does NOT say "unsecured". They
  complement (different angle on same subject), they do not duplicate.

  props: { topWord, heroPhrase, pixelPhrase, subtitle }

Beat 2 — KaraokeCard (SUBJECT 1, position bottom-left). Anchor required.
  windowSec ~6, leadInSec 1.5
  props: { position: 'bottom-left',
           eyebrow (≤24 chars, e.g. 'Tip 1 · Topic'),
           words: array of 5-7 short words; heroWord MUST appear in this array,
           heroWord (the bolded one) }

Beat 3 — AsciiPlanet (PREFERRED) or KaraokeCard or CompactCard (SUBJECT 2). Anchor required.
  AsciiPlanet (DEFAULT — pick this unless the script LITERALLY invokes a slash command):
    Decorative spinning ASCII disc, no text content. The audio carries the
    explanation; the disc is brand-chrome / a visual breather between text beats.
    props: { position: 'top' } — placed in upper half so it doesn't crowd
                                  bottom-positioned Win95Terminal/KaraokeCard
    windowSec ~5
  CompactCard (ONLY when the spoken transcript literally says "/something" or
    "slash X" as a CLI command — NOT for generic "command" or "/env vars"-style
    aesthetic labels that aren't actually invoked):
    { command (≤14 chars), subtitle (≤30 chars) }, windowSec ~5
  KaraokeCard: like Beat 2 but position 'bottom-right'

Beat 4 — Win95Terminal or KaraokeCard (SUBJECT 3). Anchor required.
  Win95Terminal: { text (≤56 chars), position: 'bottom' }, windowSec ~6
    Retro terminal that types out a single explicative line. Use for
    stating what something IS — a definition, a key insight, a fact.
    Position 'bottom' is the default — sits in the lower zone where viewers
    expect supporting text and stays clear of a top-placed AsciiPlanet.
    The 6s window gives the typed line ~1s extra linger before fading.
    NOT a CTA, NOT persuasive copy, NOT a wipe/reset reveal.
  KaraokeCard: like Beat 2 but position 'top-right'

Beat 5 — OpusGlisten (CTA emphasis word). Anchor required = the SAME word as props.word.
  windowSec ~2.5, leadInSec 0.4
  props: { word: ONE single word — the emphasis (e.g. 'Opus', 'Save', 'Ship', 'follow'),
           speed: 2.2 — ALWAYS include. Faster animation so the chime + sparkle
                        complete before the operator's outro cut. The cut often
                        lands <1s after the spoken word; default 3.5s arc gets clipped.
           yOffset: 96 — ALWAYS include. Pushes the hero word down ~1 inch from
                         frame center to clear the operator's chin/upper-chest. }

Return ONLY this JSON shape, nothing else:

{
  "beats": [
    { "type": "RayBanIntro",
      "props": { "topWord": "...", "heroPhrase": "...", "pixelPhrase": "...", "subtitle": "..." } },
    { "type": "KaraokeCard",
      "anchorPhrase": "exact words from transcript",
      "leadInSec": 1.5, "windowSec": 6.0,
      "props": { "position": "bottom-left", "eyebrow": "...", "words": ["..."], "heroWord": "..." } },
    { "type": "AsciiPlanet",
      "anchorPhrase": "...", "leadInSec": 1.5, "windowSec": 5.0,
      "props": { "position": "top" } },
    { "type": "Win95Terminal",
      "anchorPhrase": "...", "leadInSec": 1.5, "windowSec": 6.0,
      "props": { "text": "...", "position": "bottom" } },
    { "type": "OpusGlisten",
      "anchorPhrase": "follow", "leadInSec": 0.4, "windowSec": 2.5,
      "props": { "word": "follow", "speed": 2.2, "yOffset": 96 } }
  ]
}

TRANSCRIPT:
${transcriptText}`;
}

// ── Skyframe-code pack ─────────────────────────────────────────────────────
//
// Sibling pack to skyframe-5beat. Inherits Beat 1 (RayBanIntro) and Beat 5
// (OpusGlisten) — those still go through the same anchor + resolver path.
// Middle beats are code/data-themed and alternate overlay / base-modifier:
//
//   Beat 2 — AsciiSubjectWave   (base-mod, Python tools/ascii_subject_window.py)
//   Beat 3 — AppleGlassTile     (overlay)
//   Beat 4 — HandLabel          (base-mod, Python tools/hand_label_window.py)
//
// Beats 2 and 4 don't render anything in the Remotion overlay pass — they're
// produced by a Python pre-pass on the graded base video. They still need an
// anchor + window in the plan so the audio cue derivation and base-mod
// subprocess invocation both know WHEN to fire.
//
// `boldHints` is an array of phrases the operator bolded in the source script;
// when present, Claude is told to prefer them as anchor candidates. The
// resolver still validates them against the word-level transcript, so a hint
// that doesn't appear verbatim is gracefully skipped.

function buildSkyframeCodeBeatsPrompt(transcriptText, durationSec, boldHints = []) {
  const hintsBlock = boldHints.length
    ? `
ANCHOR HINTS (from operator-bolded script terms — PREFER these as anchor candidates,
but still pick verbatim phrases from the transcript that are distinctive):
  ${boldHints.map(h => `- ${h}`).join('\n  ')}
`
    : '';

  return `You are planning a 5-beat motion-graphics overlay for a ${durationSec.toFixed(1)}s shortform video
using the SKYFRAME-CODE pack — code/data-themed sibling to skyframe-5beat.

Pick anchor phrases pulled VERBATIM from the transcript so the CLI can locate them in
word-level timestamps. Don't paraphrase. Don't invent words.
${hintsBlock}
CRITICAL ANCHOR RULE: For beats 2, 3, and 4, \`anchorPhrase\` MUST be 4-8 CONSECUTIVE words
pulled verbatim from the transcript. Single-word anchors cause false matches when common
words repeat. Choose a phrase distinctive enough to appear EXACTLY ONCE in the transcript.
Beat 5 (OpusGlisten) is the only exception — its anchor is the single emphasis word.

The 5-beat structure is fixed. Always return exactly 5 beats, in this order:

Beat 1 — RayBanIntro (HOOK). No anchor — fixed 0-3s. Same as skyframe-5beat.
  topWord     — small white EYEBROW tag, sets context (≤8 chars).
  heroPhrase  — BIG yellow claim, ONE clear thought from the script (caps, 10-18 chars).
  pixelPhrase — chunky 8-bit BRAND STAMP word/phrase (caps, 4-10 chars). DIFFERENT angle
                from heroPhrase — never a synonym.
  subtitle    — muted CLARIFIER tail (≤32 chars). One short factual line.
  props: { topWord, heroPhrase, pixelPhrase, subtitle }

Beat 2 — AsciiSubjectWave (BASE-MODIFIER, no overlay content). Anchor required.
  windowSec ~3 (the Python tool wraps the subject in an animated ASCII grid during
  this window; visual carries on the base video itself).
  props: {}  — no Remotion props needed; window timing is the entire payload.

Beat 3 — AppleGlassTile (OVERLAY). Anchor required.
  windowSec ~6.
  3 SINGLE-WORD bullets stacked top-to-bottom inside an Apple-glass tile, each landing
  1s after the previous. Speaker stands beside the tile and POINTS to each word.
  Pick 3 single words that map to the script's core nouns/verbs — these MUST be
  pointable concepts, not filler. If the operator bolded 3 terms in the script,
  USE THOSE 3 (in order) — that's the bold-as-hint contract.
  props: { words: ["w1", "w2", "w3"],   // exactly 3 single words, UPPERCASE
           position: "left" | "right" | "center"   // default "left" }

Beat 4 — HandLabel (BASE-MODIFIER, no overlay content). Anchor required.
  windowSec ~3-4 (the Python tool detects the speaker's hand via MediaPipe and
  draws a labeled rectangle over it during this window — so this MUST land at
  a moment where the speaker is actively gesturing).

  HAND-LABEL BOLD CONTRACT (highest priority):
  If the operator has bolded a MULTI-WORD term starting with a VERB or
  GERUND (-ing) — e.g. "Rotating keys", "Auditing logs", "Replacing creds" —
  USE that as the HandLabel. The anchor is the script line containing that
  bold (find it verbatim in the transcript). The labelText is the first word
  of the bold, UPPERCASE (e.g. "Rotating keys" → labelText "ROTATING").

  Fallback (only when no verb-bold exists):
  Pick the script moment that BEST describes a manual action — where the
  speaker would naturally gesture. PREFER mid-script moments over the open
  or close. Avoid the final 5 seconds (the wrap-up / CTA zone). labelText is
  a SINGLE short verb (1-2 words, ≤14 chars): "AUDIT", "INSPECT", "FILTER",
  "DROP", "TRACE", "SIGN", "REPLACE".

  props: { labelText: "..." }

Beat 5 — OpusGlisten (CTA emphasis word). Anchor required = the SAME word as props.word.
  Same as skyframe-5beat.
  windowSec ~2.5, leadInSec 0.4
  props: { word: ONE single word (the emphasis),
           speed: 2.2 — ALWAYS include,
           yOffset: 96 — ALWAYS include }

Return ONLY this JSON shape, nothing else:

{
  "beats": [
    { "type": "RayBanIntro",
      "props": { "topWord": "...", "heroPhrase": "...", "pixelPhrase": "...", "subtitle": "..." } },
    { "type": "AsciiSubjectWave",
      "anchorPhrase": "exact words from transcript", "leadInSec": 1.0, "windowSec": 3.0,
      "props": {} },
    { "type": "AppleGlassTile",
      "anchorPhrase": "...", "leadInSec": 1.0, "windowSec": 6.0,
      "props": { "words": ["WORD1", "WORD2", "WORD3"], "position": "left" } },
    { "type": "HandLabel",
      "anchorPhrase": "...", "leadInSec": 1.0, "windowSec": 3.5,
      "props": { "labelText": "..." } },
    { "type": "OpusGlisten",
      "anchorPhrase": "follow", "leadInSec": 0.4, "windowSec": 2.5,
      "props": { "word": "follow", "speed": 2.2, "yOffset": 96 } }
  ]
}

TRANSCRIPT:
${transcriptText}`;
}

// ── Skyframe-pov pack ──────────────────────────────────────────────────────
//
// Third pack — for POV recordings (Ray-Ban glasses, no subject body in frame,
// hands gesturing on/over objects). Shares HandLabel with skyframe-code, shares
// Win95Terminal with skyframe-5beat. Only one base-mod beat (HandLabel); the
// rest are pure Remotion overlay components.
//
//   Beat 1 — RayBanIntro    (overlay)        inherited
//   Beat 2 — Win95Terminal  (overlay)        explicative line, position bottom
//   Beat 3 — AppleGlassTile (overlay)        3 single-word bullets
//   Beat 4 — HandLabel      (BASE-MODIFIER)  POV-sized box on the gesturing hand
//   Beat 5 — OpusGlisten    (overlay)        CTA emphasis word

function buildSkyframePovBeatsPrompt(transcriptText, durationSec, boldHints = []) {
  const hintsBlock = boldHints.length
    ? `
ANCHOR HINTS (from operator-bolded script terms — PREFER these as anchor candidates,
but still pick verbatim phrases from the transcript that are distinctive):
  ${boldHints.map(h => `- ${h}`).join('\n  ')}
`
    : '';

  return `You are planning a 5-beat motion-graphics overlay for a ${durationSec.toFixed(1)}s POV shortform
using the SKYFRAME-POV pack — Ray-Ban POV recording, NO subject body in frame, only hands
gesturing on/over objects (keyboard, paper, screen). All visual elements assume the
operator's hands are the foreground subject.

Pick anchor phrases pulled VERBATIM from the transcript. Don't paraphrase.
${hintsBlock}
CRITICAL ANCHOR RULE: For beats 2, 3, and 4, \`anchorPhrase\` MUST be 4-8 CONSECUTIVE words
pulled verbatim from the transcript. Single-word anchors cause false matches. Choose a
phrase distinctive enough to appear EXACTLY ONCE. Beat 5 (OpusGlisten) is the only
exception — its anchor is the single emphasis word.

The 5-beat structure is fixed. Always return exactly 5 beats, in this order:

Beat 1 — RayBanIntro (HOOK). No anchor — fixed 0-3s.
  topWord     — small white EYEBROW tag (≤8 chars).
  heroPhrase  — BIG yellow claim, ONE clear thought (caps, 10-18 chars).
  pixelPhrase — chunky 8-bit BRAND STAMP (caps, 4-10 chars). DIFFERENT angle from heroPhrase.
  subtitle    — muted CLARIFIER tail (≤32 chars).
  props: { topWord, heroPhrase, pixelPhrase, subtitle }

Beat 2 — Win95Terminal (EXPLICATIVE). Anchor required. windowSec ~6.
  Retro Win95 terminal types out a single explicative line — a definition, a key insight,
  a fact, a statement of what something IS. Position bottom (clears the top half of frame
  for upcoming AppleGlassTile + HandLabel beats).
  HARD RULE: NOT a CTA, NOT persuasive copy. Pure declarative. ≤56 chars.
  props: { text: "...", position: "bottom" }

Beat 3 — AppleGlassTile (LIST). Anchor required. windowSec ~6.
  3 SINGLE-WORD bullets stacked top-to-bottom inside an Apple-glass tile.
  If the operator bolded 3 single-word terms in the script, USE THOSE 3 (in order).
  props: { words: ["W1", "W2", "W3"], position: "left" }

Beat 4 — HandLabel (BASE-MODIFIER, no overlay content). Anchor required. windowSec ~3-4.
  Python tool detects the operator's hand via MediaPipe and draws a labeled rectangle
  over it. In POV the hand fills more of the frame than third-person — this is the
  EXPECTED detection scenario for this pack, so this beat should fire reliably.

  HAND-LABEL BOLD CONTRACT (highest priority):
  If the operator has bolded a MULTI-WORD term starting with a VERB or GERUND (-ing) —
  e.g. "Rotating keys", "Auditing logs", "Replacing creds" — USE that as the HandLabel.
  Anchor is the script line containing that bold (find verbatim in transcript).
  labelText is the first word of the bold, UPPERCASE.

  Fallback: PREFER mid-script gestural moments. Avoid final 5 seconds. labelText is a
  single short verb (1-2 words, ≤14 chars): "AUDIT", "INSPECT", "FILTER", "DROP", "TRACE",
  "SIGN", "REPLACE", "ROTATE", "BUILD", "DEPLOY".

  props: { labelText: "..." }

Beat 5 — OpusGlisten (CTA emphasis word). Anchor required = the SAME word as props.word.
  windowSec ~2.5, leadInSec 0.4
  props: { word: ONE single word (the emphasis),
           speed: 2.2 — ALWAYS include,
           yOffset: 96 — ALWAYS include }

Return ONLY this JSON shape, nothing else:

{
  "beats": [
    { "type": "RayBanIntro",
      "props": { "topWord": "...", "heroPhrase": "...", "pixelPhrase": "...", "subtitle": "..." } },
    { "type": "Win95Terminal",
      "anchorPhrase": "...", "leadInSec": 1.5, "windowSec": 6.0,
      "props": { "text": "...", "position": "bottom" } },
    { "type": "AppleGlassTile",
      "anchorPhrase": "...", "leadInSec": 1.0, "windowSec": 6.0,
      "props": { "words": ["WORD1", "WORD2", "WORD3"], "position": "left" } },
    { "type": "HandLabel",
      "anchorPhrase": "...", "leadInSec": 1.0, "windowSec": 3.5,
      "props": { "labelText": "..." } },
    { "type": "OpusGlisten",
      "anchorPhrase": "follow", "leadInSec": 0.4, "windowSec": 2.5,
      "props": { "word": "follow", "speed": 2.2, "yOffset": 96 } }
  ]
}

TRANSCRIPT:
${transcriptText}`;
}

// Audio cues for skyframe-pov: bubbles at non-Opus overlay beat entries
// (RayBanIntro / Win95Terminal / AppleGlassTile), chime at OpusGlisten sparkle
// peak. AppleGlassTile fires its own inline digital-click sequences. No
// digital-data (no AsciiSubjectWave), no chime2 (no AsciiPlanet).
function deriveSkyframePovAudioCues(beats, fps) {
  const bubbles = beats
    .filter(b => b.type !== 'OpusGlisten' && b.type !== 'HandLabel')
    .map(b => Math.round(b.startSec * fps));
  const out = { bubbles, whooshes: [], chime2: [] };
  const opus = beats.find(b => b.type === 'OpusGlisten');
  if (opus) {
    const opusSpeed = Math.max(0.1, Number(opus.props?.speed) || 1.0);
    out.chime = Math.round(opus.startSec * fps) + Math.round(64 / opusSpeed);
  }
  return out;
}

// Resolves Claude's beat plan against word-level transcript timestamps.
// Returns an array of { type, startSec, endSec, props } sorted by startSec.
function resolveAnchorBeats(plan, words) {
  const resolved = [];
  // Order-aware matching: each beat's anchor must appear AT OR AFTER the
  // previous beat's anchor end. Prevents the Win95Terminal-lands-too-early
  // failure mode where a single ambiguous word (e.g. "delimiters") matched
  // an earlier occurrence in the transcript. Falls back to full-transcript
  // search if the ordered match fails, so a single bad anchor doesn't cascade.
  let searchStartIdx = 0;
  for (const beat of plan.beats || []) {
    if (beat.type === 'RayBanIntro') {
      resolved.push({ type: beat.type, startSec: 0, endSec: 3.0, props: beat.props || {} });
      continue;
    }
    if (!beat.anchorPhrase) {
      console.log(`    ✗ ${beat.type} missing anchorPhrase, skipping`);
      continue;
    }
    let match = findPhraseInWords(beat.anchorPhrase, words, searchStartIdx);
    if (!match && searchStartIdx > 0) {
      const widenFromSec = (words[searchStartIdx]?.start ?? 0).toFixed(2);
      console.log(`    ~ ${beat.type} anchor not found after ${widenFromSec}s, widening to full transcript`);
      match = findPhraseInWords(beat.anchorPhrase, words, 0);
    }
    if (!match) {
      // Defensive: OpusGlisten is THE signature beat (`feedback_opus_shine_signature`).
      // If Claude's anchor word didn't survive Whisper transcription, anchor the
      // beat to the end of the spoken transcript so the signature always ships —
      // visual + chime cue (which keys off the beat's existence).
      if (beat.type === 'OpusGlisten' && words.length > 0) {
        const lastWord = words[words.length - 1];
        const lastWordEnd = lastWord.end ?? ((lastWord.start ?? 0) + 0.5);
        const windowSec = Number.isFinite(beat.windowSec) ? beat.windowSec : 3.5;
        const endSec = lastWordEnd + 0.3;
        const startSec = Math.max(0, endSec - windowSec);
        resolved.push({ type: beat.type, startSec, endSec, props: beat.props || {} });
        console.log(`    ⚠ OpusGlisten anchor "${beat.anchorPhrase}" not found — defaulting to end-of-transcript ${startSec.toFixed(2)}–${endSec.toFixed(2)}s (signature beat must ship)`);
        continue;
      }
      console.log(`    ✗ ${beat.type} anchor "${beat.anchorPhrase}" not found in transcript`);
      continue;
    }
    const anchorStart = words[match.startIdx].start;
    const leadIn = Number.isFinite(beat.leadInSec) ? beat.leadInSec : 1.5;
    const window = Number.isFinite(beat.windowSec) ? beat.windowSec : 5.0;
    const startSec = Math.max(0, anchorStart - leadIn);
    resolved.push({
      type: beat.type,
      startSec,
      endSec: startSec + window,
      props: beat.props || {},
    });
    console.log(`    ✓ ${beat.type} → "${beat.anchorPhrase}" @ ${anchorStart.toFixed(2)}s (window ${startSec.toFixed(2)}–${(startSec + window).toFixed(2)}s)`);
    searchStartIdx = match.endIdx + 1;
  }
  resolved.sort((a, b) => a.startSec - b.startSec);
  return resolved;
}

// One bubble per beat-entry, EXACTLY ONE chime at OpusGlisten sparkle peak
// (~64 frames into its window at speed=1.0; scales with the beat's `speed` prop).
// Skyframe discipline: chime is the signature — never more than one.
//
// Whooshes are reserved for ACTUAL transitions between scenes, not mid-beat
// pattern interrupts. We don't model transitions yet, so the array is empty.
// Reintroduce when scene-cuts or hard transition moments are explicitly tagged.
// Pulls operator-bolded terms from the most recent quicktake_/beats_ .md
// file in WORK_DIR. Used by skyframe-code as anchor hints (and retrofit-able
// to skyframe-5beat for the same benefit). Returns [] when no script file
// is available — anchor selection then falls back to Claude's own judgment.
function extractBoldHintsFromQuicktake() {
  try {
    if (!existsSync(WORK_DIR)) return [];
    const qtFiles = readdirSync(WORK_DIR)
      .filter(f => (f.startsWith('quicktake_') || f.startsWith('beats_')) && f.endsWith('.md'))
      .sort((a, b) => {
        const tsA = a.slice(-22, -3);
        const tsB = b.slice(-22, -3);
        return tsA.localeCompare(tsB);
      });
    if (qtFiles.length === 0) return [];
    const chosen = qtFiles[qtFiles.length - 1];
    const qtContent = readFileSync(join(WORK_DIR, chosen), 'utf8');
    const boldMatches = qtContent.match(/\*\*([^*]+)\*\*/g) || [];
    const metaWords = new Set(['target:', 'bullets:', 'style:', 'generated:', 'format:', 'beats:']);
    const hints = boldMatches.map(m => m.replace(/\*\*/g, '').trim())
      .filter(t => t && !metaWords.has(t.toLowerCase()));
    return [...new Set(hints)];
  } catch {
    return [];
  }
}

// Audio cues for skyframe-code. Slimmer than the 5-beat cue set:
//  - No bubbles, no whooshes, no chime2.
//  - chime fires at OpusGlisten sparkle peak (same math as skyframe-5beat).
//  - digital-click sequences are baked INTO AppleGlassTile, so they don't
//    need to be derived here.
//  - digital-data audio for AsciiSubjectWave windows is mixed in at the
//    FFmpeg composite step (AsciiSubjectWave is base-mod, not Remotion).
function deriveSkyframeCodeAudioCues(beats, fps) {
  const out = { bubbles: [], whooshes: [], chime2: [] };
  const opus = beats.find(b => b.type === 'OpusGlisten');
  if (opus) {
    const opusSpeed = Math.max(0.1, Number(opus.props?.speed) || 1.0);
    out.chime = Math.round(opus.startSec * fps) + Math.round(64 / opusSpeed);
  }
  return out;
}

function deriveSkyframeAudioCues(beats, fps) {
  // Bubble per beat-entry, EXCEPT OpusGlisten — the chime IS its audio. A
  // bubble + chime double-fires and dilutes the signature moment.
  const bubbles = beats
    .filter(b => b.type !== 'OpusGlisten')
    .map(b => Math.round(b.startSec * fps));
  const whooshes = [];
  // chime2 fires on each AsciiPlanet beat entry — secondary signature for
  // the decorative beat 3 slot. The audio cue lands as the planet scans in.
  const chime2 = beats
    .filter(b => b.type === 'AsciiPlanet')
    .map(b => Math.round(b.startSec * fps));
  const opus = beats.find(b => b.type === 'OpusGlisten');
  const out = { bubbles, whooshes, chime2 };
  if (opus) {
    // Sparkle peak lands at frame 64 when speed=1.0. When the operator passes
    // speed > 1 (Skyframe-5beat default 2.2 — tightest fit-before-cut), the
    // peak slides earlier — keep the chime locked to the visual peak.
    const opusSpeed = Math.max(0.1, Number(opus.props?.speed) || 1.0);
    out.chime = Math.round(opus.startSec * fps) + Math.round(64 / opusSpeed);
  }
  return out;
}

// ── Notion page-by-ID lookup (for filename suffix convention) ──────────────

// Recognizes `__<32-hex>` or `__<uuid>` suffix before the extension.
// Example: bloated-test__3467e255421c81a5b5bbc42ee813c06c.mp4 → 3467e255...
function extractNotionIdFromFilename(filename) {
  const m = filename.match(/__([a-f0-9]{32}|[a-f0-9-]{36})\.(?:mp4|mov|webm|mkv)$/i);
  return m ? m[1].replace(/-/g, '') : null;
}

async function fetchNotionKeyTerms(pageId) {
  const token = process.env.NOTION_API_KEY;
  if (!token) return { error: 'NOTION_API_KEY not set' };
  try {
    const resp = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_API_VERSION,
      },
    });
    const data = await resp.json();
    if (!resp.ok) return { error: data.message || `HTTP ${resp.status}` };
    const kt = data.properties?.['Key Terms']?.multi_select || [];
    const topic = data.properties?.Topic?.title?.[0]?.plain_text || '';
    return { keyTerms: kt.map(o => o.name), topic };
  } catch (e) {
    return { error: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// MODE 1: QUICKTAKE — Generate teleprompter OR beats cue card, upload to Drive
// ═══════════════════════════════════════════════════════════════════════════

// ── POV Engine: pillar-aware hook tuning for style=pov ────────────────
// A high-save-rate Ray-Ban Meta POV Reel pattern — the "I never hit X with Y"
// pattern-interrupt is the proven winner. Pillars A–D route to different open styles
// so batch recording sessions can produce 5 varied clips without sounding the same.
const PILLARS = {
  A: {
    label: 'Workflow moment',
    opens: ['"watch what happens when I..."', '"here\'s what Claude does when I..."', '"I\'m in the middle of X and..."'],
    note: 'Save-coded reference content — replicable takeaway (a command, a setting, a workflow) the viewer can try tonight.',
  },
  B: {
    label: 'Research reveal',
    opens: ['"just ran a new benchmark and..."', '"something weird in the benchmark..."', '"session [N] just wrapped and..."'],
    note: 'Authority content — narrate a real finding from your own research sessions. Name the phenomenon, show the monitor, skip the setup.',
  },
  C: {
    label: 'Hot take / comparison',
    opens: ['"I never hit X with Y because..."', '"most people don\'t realize you can..."', '"here\'s the thing about X..."'],
    note: 'Pattern-interrupt. THIS is the proven format. Stake a position, then prove it with one concrete reason.',
  },
  D: {
    label: 'Breadstick in action',
    opens: ['"this is my canvas for..."', '"I built this thing that..."', '"watch this pipeline run..."'],
    note: 'Warm the product funnel without pitching. Show the canvas / portal / run, narrate what you\'re seeing. No selling.',
  },
};

function pillarBlock(pillar) {
  if (!pillar || !PILLARS[pillar]) return '';
  const p = PILLARS[pillar];
  return `

PILLAR ${pillar} — ${p.label}:
${p.note}
Preferred opener patterns (pick one, make it your own, don't recite verbatim):
${p.opens.map(o => '  - ' + o).join('\n')}`;
}

function povStyleBlock() {
  return `
- pov: RAY-BAN META POV while working. Mid-thought opener, present-tense, "I'm doing X right now" energy.
  Winning hook patterns (pick or riff): "I never hit X with Y", "watch what happens when I...", "most people don't realize you can...", "here's the thing about X...".
  Banned: "First/Second/Third" scaffolding, "hey guys", any performance language, any exclamation marks.
  Apply the save test: would a dev scrolling at 11pm actually save this? If no, reframe until yes.`;
}

const FORMATS = {
  teleprompter: {
    label: 'QUICKTAKE',
    countLabel: 'Bullets',
    fileSlug: 'quicktake',
    defaultCount: 5,
    defaultDuration: 45,
    deliveryNote: 'Read each bullet as one breath. Pause between bullets. Let the hook land before moving on.',
    buildSystem: ({ count, duration, style, pillar }) => `You are a teleprompter script writer for a developer and cybersecurity content creator who records short-form video (TikTok, Reels, Shorts).

Your job is to produce a teleprompter-ready script that the creator reads while looking at the camera. The script must:

- Be exactly ${count} bullet points
- Target ${duration} seconds of speaking time (roughly ${Math.round(duration * 2.5)} words)
- Use short, punchy sentences. Max 12 words per sentence.
- Write in spoken English — contractions, natural rhythm, conversational
- Each bullet is one complete thought. No half-sentences that bleed into the next bullet.
- First bullet is always the HOOK — grabs attention in 3 seconds
- Last bullet is always the CTA — "follow for part 2" or "save this" energy
- Middle bullets deliver the insight with one clear takeaway each
- Mark KEY TERMS in **bold** so they pop on the teleprompter
- No emojis, no hashtags, no stage directions

Style: ${style}
- confident: direct statements, "here's the thing", authoritative
- conversational: "look, let me tell you something", approachable
- urgent: "you need to know this right now", time-pressure
- analytical: "let's break this down", methodical${style === 'pov' ? povStyleBlock() : ''}${style === 'pov' ? pillarBlock(pillar) : ''}

Output ONLY the numbered bullets. No title, no metadata, no commentary.`,
    buildUser: (topic, { count }) => `Write a ${count}-bullet teleprompter script about: ${topic}`,
  },
  beats: {
    label: 'CUE CARD',
    countLabel: 'Beats',
    fileSlug: 'beats',
    defaultCount: 5,
    defaultDuration: 60,
    deliveryNote: 'Glance once before recording. Do not read. Just remember the anchors and talk naturally.',
    buildSystem: ({ count, duration, style, pillar }) => `You are building a pre-record CUE CARD for the creator to glance at ONCE before recording POV content with Ray-Ban Meta glasses. This is NOT a script to read. It's a mental anchor so he doesn't forget the beats while he talks naturally while working.

Background: the winning content is unscripted POV from the glasses with monitors visible as proof-of-work. The audience treats it as reference, not entertainment. Reading a script kills the vibe. The cue card keeps the creator on track without sounding rehearsed.

The cue card must:
- Contain exactly ${count} beat anchors (keyword-dense phrases, NOT complete sentences)
- Include a natural, low-energy OPEN — conversational, not hook-y (e.g., "I'm on X all day, never hit Y")
- Include a CLOSE direction note — not a scripted CTA, just a vibe direction ("end with natural follow hook", "show the result and cut")
- Mark KEY TERMS in **bold** — these become 16-GAMI overlay cues later in the pipeline
- Include a Shooting note (what should be visible on camera / scene context)
- Beats are 4-10 words, keyword-dense, not complete sentences
- No "First/Second/Third" scaffolding. No exclamation marks. No performance language.
- Total natural speaking time: ~${duration}s
- Apply the save test: would a dev scrolling at 11pm actually save this? If the beats are entertainment-coded, reframe toward reference-coded (a replicable takeaway).

Style: ${style}
- confident: quiet authority, no posturing
- conversational: thinking out loud, genuine curiosity
- urgent: "this just broke", time-sensitive
- analytical: "here's what I'm noticing"${style === 'pov' ? povStyleBlock() : ''}${pillarBlock(pillar)}

Output EXACTLY this structure, no commentary before or after:

CUE CARD — [topic restated concisely]
Shooting: [scene / what's visible on camera]

OPEN (natural, not hook-y)
  [one line, 8-14 words]

BEATS (don't read — remember)
  • [beat 1 — keyword-dense]
  • [beat 2]
  • [... ${count} beats total]

CLOSE (whatever feels right in the moment)
  [one direction note, not a verbatim CTA]

OVERLAY TERMS (bold = auto-overlay cues)
  [term] · [term] · [term]`,
    buildUser: (topic, { count }) => `Generate a cue card with ${count} beats for: ${topic}`,
  },
};

// Generate a Threads caption + 3+ hashtags from the script via a SEPARATE
// Anthropic call so it doesn't perturb the carefully-tuned script prompts.
// Caption + hashtags COMBINED stay under 500 chars (Threads post limit).
// Threads-tone: lowercase casual, hooky scroll-stopper, niche-specific tags.
async function generateThreadsCaption(topic, script, format) {
  const systemPrompt = `You write social captions for a developer + cybersecurity creator who films POV content with Ray-Ban Meta glasses. The audience treats the videos as REFERENCE, not entertainment.

Constraints:
- Caption + hashtags COMBINED must stay under 500 characters (Threads limit)
- The caption is a scroll-stopping HOOK that goes ABOVE the video — it sells the click. It's NOT a recap.
- Write in spoken English, lowercase casual tone, no corporate speak
- No "first/second/third" scaffolding, no exclamation marks, no emojis unless they add real signal
- 3-5 relevant hashtags, niche-specific (#vibecoding #appsec #promptinjection #devsec are good; #tech #content #ai are too generic)
- Treat the hashtag block as part of the message — leave room for it under the 500 char ceiling

Output EXACTLY this structure, nothing else:

<caption>
[the caption text — short, hooky, gives a reason to watch]
</caption>

<hashtags>
#tag1 #tag2 #tag3
</hashtags>`;

  const userPrompt = `Topic: ${topic}
Format: ${format}

Script:
${script}

Write the Threads caption + hashtags for this video.`;

  const raw = await anthropic(systemPrompt, userPrompt);
  const captionMatch = raw.match(/<caption>([\s\S]*?)<\/caption>/i);
  const hashtagsMatch = raw.match(/<hashtags>([\s\S]*?)<\/hashtags>/i);
  return {
    caption: (captionMatch?.[1] || '').trim(),
    hashtags: (hashtagsMatch?.[1] || '').trim(),
    raw,
  };
}

async function quicktake(topic, opts = {}) {
  const format = opts.format || 'teleprompter';
  const config = FORMATS[format];
  if (!config) {
    console.error(`Error: unknown format "${format}". Use: teleprompter | beats`);
    process.exit(1);
  }

  const count = opts.bullets || config.defaultCount;
  const duration = opts.duration || config.defaultDuration;
  const style = opts.style || 'confident';
  const pillar = opts.pillar || null;

  console.log(`\n  ${config.label}: "${topic}"`);
  const pillarLabel = pillar ? ` | Pillar: ${pillar} (${PILLARS[pillar].label})` : '';
  console.log(`  Format: ${format} | ${config.countLabel}: ${count} | Target: ${duration}s | Style: ${style}${pillarLabel}\n`);

  // ── Generate via Anthropic ────────────────────────────────────────────

  const systemPrompt = config.buildSystem({ count, duration, style, pillar });
  const userPrompt = config.buildUser(topic, { count });

  console.log('  Generating...');
  const script = await anthropic(systemPrompt, userPrompt);
  console.log('  Generated.\n');

  // ── Generate Threads caption + hashtags (separate call, non-blocking error) ──
  console.log('  Generating Threads caption...');
  const threads = await generateThreadsCaption(topic, script, format).catch(err => {
    console.log(`  Caption gen failed: ${err.message} (continuing without)`);
    return { caption: '', hashtags: '' };
  });
  const captionLen = threads.caption ? (threads.caption + ' ' + threads.hashtags).trim().length : 0;
  if (threads.caption) {
    console.log(`  Caption ready (${captionLen}/500 chars).\n`);
  }

  // ── Format as markdown ────────────────────────────────────────────────

  const slug = slugify(topic, 40);
  const ts = timestamp();
  const filename = `${config.fileSlug}_${slug}_${ts}.md`;

  const captionBlock = threads.caption ? `

---

## Threads Caption (${captionLen}/500 chars)

${threads.caption}

${threads.hashtags}
` : '';

  const md = `# ${config.label}: ${topic}

**Format:** ${format} | **Target:** ${duration}s | **${config.countLabel}:** ${count} | **Style:** ${style}
**Generated:** ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}

---

${script}

---

*${config.deliveryNote}*${captionBlock}
`;

  // ── Save locally ──────────────────────────────────────────────────────

  mkdirSync(WORK_DIR, { recursive: true });
  const localPath = join(WORK_DIR, filename);
  writeFileSync(localPath, md);
  console.log(`  Saved: ${localPath}`);

  // ── Upload to Google Drive /teleprompter/ (legacy backup) ─────────────

  console.log('  Uploading to Drive /teleprompter/...');
  const uploaded = driveUpload(localPath, DRIVE_FOLDERS.teleprompter, filename);
  console.log(`  Drive: ${uploaded.name || filename} (${uploaded.id})`);

  // ── Post to Notion database (primary) ─────────────────────────────────

  console.log('  Posting to Notion /📹 Teleprompter Scripts/...');
  const notionResult = await notionCreatePage({ topic, format, script, count, duration, style });
  if (notionResult.skipped) {
    console.log(`  Notion: skipped (${notionResult.reason})`);
  } else if (notionResult.error) {
    console.log(`  Notion: error — ${notionResult.error}`);
    if (notionResult.code === 'object_not_found' || /not authorized|not shared/i.test(notionResult.error)) {
      console.log('  → Invite your integration to the database: Notion → Teleprompter Scripts → ••• → Connections → Add');
    }
  } else {
    console.log(`  Notion: ${notionResult.url}`);
  }

  // ── Print the script for immediate use ────────────────────────────────

  console.log('\n' + '─'.repeat(60));
  console.log(script);
  console.log('─'.repeat(60));

  if (threads.caption) {
    console.log(`\n  THREADS CAPTION (${captionLen}/500):`);
    console.log('─'.repeat(60));
    console.log(threads.caption);
    console.log('');
    console.log(threads.hashtags);
    console.log('─'.repeat(60));
  }

  console.log(`\n  Ready. Format: ${config.label}.\n`);

  return { filename, script, caption: threads.caption, hashtags: threads.hashtags, driveId: uploaded.id, notionUrl: notionResult.url, format };
}


// ═══════════════════════════════════════════════════════════════════════════
// MODE 2: PROCESS — Watch /Short form IN/, edit, grade, upload to /Short form OUT/
// ═══════════════════════════════════════════════════════════════════════════

async function process_video(opts = {}) {
  const lut = opts.lut || 'default';
  const lutPath = join(LUTS_DIR, `${lut}.cube`);

  console.log('\n  PROCESS: Checking /Short form IN/ for new videos...\n');

  // ── Check for videos in Drive folder ──────────────────────────────────

  const files = driveListFolder(DRIVE_FOLDERS.shortformIn);
  const videos = files.filter(f =>
    f.mimeType?.startsWith('video/') ||
    f.name?.match(/\.(mp4|mov|webm|mkv)$/i)
  );

  if (videos.length === 0) {
    console.log('  No videos found in /Short form IN/. Upload your recording and run again.');
    return null;
  }

  // Process the most recent video
  const video = videos.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime))[0];
  console.log(`  Found: ${video.name} (${video.id})`);

  // ── Download ──────────────────────────────────────────────────────────

  mkdirSync(WORK_DIR, { recursive: true });
  const ext = video.name.match(/\.(\w+)$/)?.[1] || 'mp4';
  const rawPath = join(WORK_DIR, `raw_${timestamp()}.${ext}`);
  console.log('  Downloading from Drive...');
  driveDownload(video.id, rawPath);
  console.log(`  Downloaded: ${rawPath}`);

  // ── Step 1: video-use — Transcribe + cut filler ───────────────────────

  console.log('\n  Step 1: Transcribing + cutting filler...');
  const editedPath = join(WORK_DIR, `edited_${timestamp()}.mp4`);

  // Run ElevenLabs Scribe transcription
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const transcribeScript = join(homeDir, '.claude', 'skills', 'video-use', 'helpers', 'transcribe.py');
  if (existsSync(transcribeScript)) {
    try {
      const editDir = join(WORK_DIR, 'edit');
      mkdirSync(editDir, { recursive: true });
      execSync(
        `python "${transcribeScript}" "${rawPath}" --edit-dir "${editDir}" --language en --num-speakers 1`,
        { encoding: 'utf8', timeout: 120000 }
      );
      console.log('  Transcription complete.');
    } catch (e) {
      console.log(`  Transcription warning: ${e.message?.slice(0, 100)}`);
      console.log('  Continuing without transcript-based editing...');
    }
  } else {
    console.log('  video-use transcribe.py not found, skipping smart edit.');
  }

  // For now, pass through to grading (video-use full edit will be wired in later)
  const sourceForGrading = existsSync(editedPath) ? editedPath : rawPath;

  // ── Step 2: FFmpeg LUT color grading ──────────────────────────────────

  const gradedPath = join(WORK_DIR, `graded_${timestamp()}.mp4`);

  if (opts.noGrade) {
    console.log('\n  Step 2: Skipping color grade (--no-grade)');
    // Copy source as-is for next step
    writeFileSync(gradedPath, readFileSync(sourceForGrading));
  } else {
    console.log('\n  Step 2: Applying color grade...');
    let ffmpegFilter = '';
    let ffmpegCwd;
    if (existsSync(lutPath)) {
      // Reference LUT by filename only and run ffmpeg from LUTS_DIR — avoids the
      // Windows drive-letter colon ("E:") tripping ffmpeg's filtergraph parser.
      ffmpegFilter = `-vf "lut3d=${lut}.cube"`;
      ffmpegCwd = LUTS_DIR;
      console.log(`  Using LUT: ${lut}.cube`);
    } else {
      ffmpegFilter = '-vf "eq=contrast=1.05:brightness=0.02:saturation=1.1"';
      console.log('  No .cube LUT found, applying default warm grade.');
    }

    try {
      execSync(
        `ffmpeg -y -i "${sourceForGrading}" ${ffmpegFilter} -c:a copy "${gradedPath}"`,
        { encoding: 'utf8', timeout: 300000, stdio: 'pipe', ...(ffmpegCwd ? { cwd: ffmpegCwd } : {}) }
      );
      console.log(`  Graded: ${gradedPath}`);
    } catch (e) {
      console.error(`  FFmpeg error: ${e.message?.slice(0, 200)}`);
      writeFileSync(gradedPath, readFileSync(sourceForGrading));
      console.log('  Grading failed, using source video.');
    }
  }

  // ── Step 3: Remotion overlay ─────────────────────────────────────────
  //
  // Paths:
  //   --overlay skyframe-5beat (default) — Claude-driven 5-beat Skyframe
  //   --overlay skyframe-code           — code/data-themed 5-beat sibling
  //                                       (ASCII wave + AppleGlassTile +
  //                                        HandLabel between the inherited
  //                                        RayBanIntro and OpusGlisten beats)
  //   --overlay skyframe-pov            — POV-only pack for Ray-Ban
  //                                       recordings of hands (no subject body
  //                                       in frame): RayBanIntro / Win95Terminal
  //                                       / AppleGlassTile / HandLabel (POV-sized)
  //                                       / OpusGlisten. Single base-mod beat.
  //   --overlay gami-banner             — 16-GAMI key-terms banner (parked)
  //   --overlay none / --no-overlay     — skip
  //
  // Skyframe packs (skyframe-5beat / -code / -pov) are anchor-driven and render
  // via Remotion. As of 2026-06-02 they HARD-FAIL rather than silently swapping
  // to gami-banner (locked): each render is retried once on the transient
  // ~25s Chrome-launch timeout (withRemotionBrowserRetry), and if the pack still
  // can't be produced the run aborts with a "re-run" message. gami-banner
  // renders ONLY when explicitly requested (--overlay gami-banner).

  let finalVideoPath = gradedPath;
  const overlayMode = opts.overlay || 'skyframe-5beat';
  const overlayDisabled = opts.noOverlay || overlayMode === 'none';

  const transcriptDir = join(WORK_DIR, 'edit', 'transcripts');
  const transcriptFiles = existsSync(transcriptDir)
    ? readdirSync(transcriptDir).filter(f => f.endsWith('.json'))
    : [];

  // ── 3a: skyframe-5beat path (try first if requested) ──────────────────
  let skyframeSucceeded = false;
  if (overlayMode === 'skyframe-5beat' && transcriptFiles.length > 0 && !overlayDisabled) {
    console.log('\n  Step 3a: Rendering Skyframe 5-beat overlay...');

    const txPath = join(transcriptDir, transcriptFiles[transcriptFiles.length - 1]);
    const transcript = JSON.parse(readFileSync(txPath, 'utf8'));
    const words = (transcript.words || []).filter(w => w.type === 'word');

    const probeOut = execSync(
      `ffprobe -v quiet -print_format json -show_format "${gradedPath}"`,
      { encoding: 'utf8', timeout: 10000 }
    );
    const videoDuration = parseFloat(JSON.parse(probeOut).format?.duration || 60);
    const overlayFps = 30;
    const totalFrames = Math.ceil(videoDuration * overlayFps);

    let plan = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        console.log('  Asking Claude for 5-beat plan...');
        const planText = await anthropic(
          'You return ONLY valid JSON. No prose, no markdown fences, no commentary.',
          buildSkyframeBeatsPrompt(transcript.text || '', videoDuration)
        );
        const cleaned = planText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
        plan = JSON.parse(cleaned);
      } catch (e) {
        console.log(`  Claude beat plan failed: ${e.message || e}`);
      }
    } else {
      console.log('  ANTHROPIC_API_KEY not set — cannot plan beats. Aborting — no gami-banner fallback.');
    }

    if (plan?.beats?.length) {
      const resolved = resolveAnchorBeats(plan, words);
      if (resolved.length < 3) {
        console.log(`  Only ${resolved.length}/5 beats resolved (need ≥3). Aborting — no gami-banner fallback.`);
      } else {
        const cues = deriveSkyframeAudioCues(resolved, overlayFps);
        console.log(`  Resolved ${resolved.length} beats. Audio cues: ${cues.bubbles.length} bubbles, ${cues.whooshes.length} whooshes, ${(cues.chime2 || []).length} chime2${cues.chime ? ', 1 chime' : ''}`);

        const propsPath = join(WORK_DIR, 'skyframe_overlay_props.json');
        writeFileSync(propsPath, JSON.stringify({ beats: resolved, audioCues: cues, durationInFrames: totalFrames }));

        const overlayPath = join(WORK_DIR, `skyframe_overlay_${timestamp()}.webm`);
        console.log('  Rendering Remotion overlay (SkyframeOverlay)...');
        try {
          await withRemotionBrowserRetry(() => execSync(
            `npx remotion render src/remotion/index.jsx SkyframeOverlay "${overlayPath}" --codec=vp9 --pixel-format=yuva420p --image-format=png --props "${propsPath}" --frames=0-${totalFrames - 1}`,
            { encoding: 'utf8', timeout: 600000, cwd: import.meta.dirname, stdio: 'pipe' }
          ), { label: overlayMode });
          console.log(`  Overlay rendered: ${overlayPath}`);

          const compositedPath = join(WORK_DIR, `composited_${timestamp()}.mp4`);
          console.log('  Compositing overlay on video (with 0-3s base blur for RayBanIntro)...');
          execSync(
            `ffmpeg -y -i "${gradedPath}" -c:v libvpx-vp9 -i "${overlayPath}" -filter_complex "[0:v]scale=1080:1920,gblur=sigma=22:enable='between(t,0,3)'[base];[base][1:v]overlay=0:0:eof_action=pass[out];[0:a]volume=1.0[a0];[1:a]volume=0.7[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]" -map "[out]" -map "[aout]" -c:v libx264 -preset fast -crf 18 -c:a aac -b:a 256k -ac 2 -movflags +faststart "${compositedPath}"`,
            { encoding: 'utf8', timeout: 300000, stdio: 'pipe' }
          );
          console.log(`  Composited: ${compositedPath}`);
          finalVideoPath = compositedPath;
          skyframeSucceeded = true;
        } catch (e) {
          const stderr = (e.stderr || '').toString();
          const stdout = (e.stdout || '').toString();
          const tail = (s) => s.length > 2000 ? '…' + s.slice(-2000) : s;
          console.log(`  Skyframe overlay error: ${e.message || e}`);
          if (stderr.trim()) console.log(`  stderr:\n${tail(stderr).trim()}`);
          else if (stdout.trim()) console.log(`  stdout:\n${tail(stdout).trim()}`);
          console.log('  Aborting — no gami-banner fallback.');
        }
      }
    } else if (process.env.ANTHROPIC_API_KEY) {
      console.log('  No usable beat plan from Claude. Aborting — no gami-banner fallback.');
    }
  }

  // ── 3a': skyframe-code path (overlay + Python base-mod chain) ──────────
  if (overlayMode === 'skyframe-code' && transcriptFiles.length > 0 && !overlayDisabled && !skyframeSucceeded) {
    console.log('\n  Step 3a: Rendering Skyframe-code overlay (with base-mod chain)...');

    const txPath = join(transcriptDir, transcriptFiles[transcriptFiles.length - 1]);
    const transcript = JSON.parse(readFileSync(txPath, 'utf8'));
    const words = (transcript.words || []).filter(w => w.type === 'word');

    const probeOut = execSync(
      `ffprobe -v quiet -print_format json -show_format "${gradedPath}"`,
      { encoding: 'utf8', timeout: 10000 }
    );
    const videoDuration = parseFloat(JSON.parse(probeOut).format?.duration || 60);
    const overlayFps = 30;
    const totalFrames = Math.ceil(videoDuration * overlayFps);
    const boldHints = extractBoldHintsFromQuicktake();
    if (boldHints.length) {
      console.log(`  Bold-as-hint candidates from script: ${boldHints.join(', ')}`);
    }

    let plan = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        console.log('  Asking Claude for skyframe-code beat plan...');
        const planText = await anthropic(
          'You return ONLY valid JSON. No prose, no markdown fences, no commentary.',
          buildSkyframeCodeBeatsPrompt(transcript.text || '', videoDuration, boldHints)
        );
        const cleaned = planText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
        plan = JSON.parse(cleaned);
      } catch (e) {
        console.log(`  Claude beat plan failed: ${e.message || e}`);
      }
    } else {
      console.log('  ANTHROPIC_API_KEY not set — cannot plan beats. Aborting — no gami-banner fallback.');
    }

    if (plan?.beats?.length) {
      const resolved = resolveAnchorBeats(plan, words);
      if (resolved.length < 3) {
        console.log(`  Only ${resolved.length}/5 beats resolved (need ≥3). Aborting — no gami-banner fallback.`);
      } else {
        const BASE_MOD_TYPES = new Set(['AsciiSubjectWave', 'HandLabel']);
        const overlayBeats = resolved.filter(b => !BASE_MOD_TYPES.has(b.type));
        const baseModBeats = resolved.filter(b => BASE_MOD_TYPES.has(b.type))
          .sort((a, b) => a.startSec - b.startSec);

        console.log(`  Resolved ${resolved.length} beats → ${overlayBeats.length} overlay, ${baseModBeats.length} base-mod.`);

        // ── Base-modifier chain (Python pre-pass on graded video) ──────
        let baseInputPath = gradedPath;
        let baseModSucceeded = true;
        for (const bm of baseModBeats) {
          const winStart = bm.startSec.toFixed(3);
          const winDur = (bm.endSec - bm.startSec).toFixed(3);
          const stem = `basemod_${bm.type}_${timestamp()}`;
          const outPath = join(WORK_DIR, `${stem}.mp4`);
          let cmd;
          if (bm.type === 'AsciiSubjectWave') {
            cmd = `python tools/ascii_subject_window.py --input "${baseInputPath}" --output "${outPath}" --window-start ${winStart} --window-duration ${winDur}`;
          } else if (bm.type === 'HandLabel') {
            const labelText = (bm.props?.labelText || 'AUDIT').replace(/"/g, '\\"');
            // size-lock-samples=2: relaxed from default 5 (and from earlier 3)
            // so short hand-visible windows still render the box even when
            // MediaPipe only catches a handful of frames. Crystal gotcha:
            // higher sample counts cause silent passthrough on jittery
            // detections.
            cmd = `python tools/hand_label_window.py --input "${baseInputPath}" --output "${outPath}" --window-start ${winStart} --window-duration ${winDur} --label-text "${labelText}" --size-lock-samples 2`;
          }
          console.log(`  Base-mod ${bm.type} @ ${winStart}-${(bm.endSec).toFixed(2)}s...`);
          try {
            execSync(cmd, { encoding: 'utf8', timeout: 600000, stdio: 'pipe' });
            baseInputPath = outPath;
          } catch (e) {
            const stderr = (e.stderr || '').toString();
            console.log(`  ${bm.type} base-mod failed: ${e.message || e}`);
            if (stderr.trim()) console.log(`  stderr (tail):\n${stderr.slice(-1500).trim()}`);
            console.log('  Continuing with last successful base. Subsequent base-mods may stack on partial work.');
            baseModSucceeded = false;
            break;
          }
        }

        // ── Remotion overlay (only the overlay-typed beats) ────────────
        const cues = deriveSkyframeCodeAudioCues(overlayBeats, overlayFps);
        const propsPath = join(WORK_DIR, 'skyframe_code_overlay_props.json');
        writeFileSync(propsPath, JSON.stringify({ beats: overlayBeats, audioCues: cues, durationInFrames: totalFrames }));

        const overlayPath = join(WORK_DIR, `skyframe_code_overlay_${timestamp()}.webm`);
        console.log('  Rendering Remotion overlay (SkyframeOverlay)...');
        try {
          await withRemotionBrowserRetry(() => execSync(
            `npx remotion render src/remotion/index.jsx SkyframeOverlay "${overlayPath}" --codec=vp9 --pixel-format=yuva420p --image-format=png --props "${propsPath}" --frames=0-${totalFrames - 1}`,
            { encoding: 'utf8', timeout: 600000, cwd: import.meta.dirname, stdio: 'pipe' }
          ), { label: overlayMode });

          // ── Composite overlay onto (possibly base-modded) base + mix digital-data
          // for each AsciiSubjectWave window at vol 0.8. The chime + digital-click
          // cues are already inside the Remotion overlay audio track.
          const compositedPath = join(WORK_DIR, `composited_${timestamp()}.mp4`);
          const beat2s = baseModBeats.filter(b => b.type === 'AsciiSubjectWave');
          const digitalDataInputs = beat2s.map(() => `-i sounds/digital-data.mp3`).join(' ');
          const ddFilters = beat2s.map((b, i) => `[${2 + i}:a]adelay=${Math.round(b.startSec * 1000)}|${Math.round(b.startSec * 1000)},volume=0.8[dd${i}]`).join(';');
          const ddLabels = beat2s.map((_, i) => `[dd${i}]`).join('');
          const ddMixCount = 2 + beat2s.length; // base + overlay + N digital-data tracks
          const audioFilter = beat2s.length
            ? `[0:a]volume=1.0[a0];[1:a]volume=0.7[a1];${ddFilters};[a0][a1]${ddLabels}amix=inputs=${ddMixCount}:duration=first:dropout_transition=0[aout]`
            : `[0:a]volume=1.0[a0];[1:a]volume=0.7[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]`;
          execSync(
            `ffmpeg -y -i "${baseInputPath}" -c:v libvpx-vp9 -i "${overlayPath}" ${digitalDataInputs} -filter_complex "[0:v]scale=1080:1920,gblur=sigma=22:enable='between(t,0,3)'[base];[base][1:v]overlay=0:0:eof_action=pass[out];${audioFilter}" -map "[out]" -map "[aout]" -c:v libx264 -preset fast -crf 18 -c:a aac -b:a 256k -ac 2 -movflags +faststart "${compositedPath}"`,
            { encoding: 'utf8', timeout: 300000, stdio: 'pipe' }
          );
          console.log(`  Composited: ${compositedPath}`);
          finalVideoPath = compositedPath;
          skyframeSucceeded = true;
          if (!baseModSucceeded) {
            console.log('  Note: at least one base-mod failed earlier — output reflects partial chain.');
          }
        } catch (e) {
          const stderr = (e.stderr || '').toString();
          const tail = (s) => s.length > 2000 ? '…' + s.slice(-2000) : s;
          console.log(`  Skyframe-code overlay error: ${e.message || e}`);
          if (stderr.trim()) console.log(`  stderr:\n${tail(stderr).trim()}`);
          console.log('  Aborting — no gami-banner fallback.');
        }
      }
    } else if (process.env.ANTHROPIC_API_KEY) {
      console.log('  No usable beat plan from Claude. Aborting — no gami-banner fallback.');
    }
  }

  // ── 3a'': skyframe-pov path (overlay + single POV-sized HandLabel base-mod) ─
  if (overlayMode === 'skyframe-pov' && transcriptFiles.length > 0 && !overlayDisabled && !skyframeSucceeded) {
    console.log('\n  Step 3a: Rendering Skyframe-pov overlay...');

    const txPath = join(transcriptDir, transcriptFiles[transcriptFiles.length - 1]);
    const transcript = JSON.parse(readFileSync(txPath, 'utf8'));
    const words = (transcript.words || []).filter(w => w.type === 'word');

    const probeOut = execSync(
      `ffprobe -v quiet -print_format json -show_format "${gradedPath}"`,
      { encoding: 'utf8', timeout: 10000 }
    );
    const videoDuration = parseFloat(JSON.parse(probeOut).format?.duration || 60);
    const overlayFps = 30;
    const totalFrames = Math.ceil(videoDuration * overlayFps);
    const boldHints = extractBoldHintsFromQuicktake();
    if (boldHints.length) {
      console.log(`  Bold-as-hint candidates from script: ${boldHints.join(', ')}`);
    }

    let plan = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        console.log('  Asking Claude for skyframe-pov beat plan...');
        const planText = await anthropic(
          'You return ONLY valid JSON. No prose, no markdown fences, no commentary.',
          buildSkyframePovBeatsPrompt(transcript.text || '', videoDuration, boldHints)
        );
        const cleaned = planText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
        plan = JSON.parse(cleaned);
      } catch (e) {
        console.log(`  Claude beat plan failed: ${e.message || e}`);
      }
    } else {
      console.log('  ANTHROPIC_API_KEY not set — cannot plan beats. Aborting — no gami-banner fallback.');
    }

    if (plan?.beats?.length) {
      const resolved = resolveAnchorBeats(plan, words);
      if (resolved.length < 3) {
        console.log(`  Only ${resolved.length}/5 beats resolved (need ≥3). Aborting — no gami-banner fallback.`);
      } else {
        const POV_BASE_MOD_TYPES = new Set(['HandLabel']);
        const overlayBeats = resolved.filter(b => !POV_BASE_MOD_TYPES.has(b.type));
        const baseModBeats = resolved.filter(b => POV_BASE_MOD_TYPES.has(b.type))
          .sort((a, b) => a.startSec - b.startSec);

        console.log(`  Resolved ${resolved.length} beats → ${overlayBeats.length} overlay, ${baseModBeats.length} base-mod.`);

        // ── Base-modifier chain (Python pre-pass — POV-sized HandLabel) ─
        let baseInputPath = gradedPath;
        let baseModSucceeded = true;
        for (const bm of baseModBeats) {
          const winStart = bm.startSec.toFixed(3);
          const winDur = (bm.endSec - bm.startSec).toFixed(3);
          const stem = `basemod_${bm.type}_${timestamp()}`;
          const outPath = join(WORK_DIR, `${stem}.mp4`);
          let cmd;
          if (bm.type === 'HandLabel') {
            const labelText = (bm.props?.labelText || 'GESTURE').replace(/"/g, '\\"');
            // POV-sized: hands fill 30-50% of frame in close-up Ray-Ban recordings,
            // so the bounding box clamps run higher than skyframe-code's defaults
            // (which assume third-person hand size). min 0.10, max 0.45.
            cmd = `python tools/hand_label_window.py --input "${baseInputPath}" --output "${outPath}" --window-start ${winStart} --window-duration ${winDur} --label-text "${labelText}" --size-lock-samples 2 --square-min-frac 0.10 --square-max-frac 0.45`;
          }
          console.log(`  Base-mod ${bm.type} @ ${winStart}-${(bm.endSec).toFixed(2)}s (POV scale)...`);
          try {
            execSync(cmd, { encoding: 'utf8', timeout: 600000, stdio: 'pipe' });
            baseInputPath = outPath;
          } catch (e) {
            const stderr = (e.stderr || '').toString();
            console.log(`  ${bm.type} base-mod failed: ${e.message || e}`);
            if (stderr.trim()) console.log(`  stderr (tail):\n${stderr.slice(-1500).trim()}`);
            baseModSucceeded = false;
            break;
          }
        }

        // ── Remotion overlay (RayBanIntro + Win95Terminal + AppleGlassTile + OpusGlisten) ─
        const cues = deriveSkyframePovAudioCues(overlayBeats, overlayFps);
        const propsPath = join(WORK_DIR, 'skyframe_pov_overlay_props.json');
        writeFileSync(propsPath, JSON.stringify({ beats: overlayBeats, audioCues: cues, durationInFrames: totalFrames }));

        const overlayPath = join(WORK_DIR, `skyframe_pov_overlay_${timestamp()}.webm`);
        console.log('  Rendering Remotion overlay (SkyframeOverlay)...');
        try {
          await withRemotionBrowserRetry(() => execSync(
            `npx remotion render src/remotion/index.jsx SkyframeOverlay "${overlayPath}" --codec=vp9 --pixel-format=yuva420p --image-format=png --props "${propsPath}" --frames=0-${totalFrames - 1}`,
            { encoding: 'utf8', timeout: 600000, cwd: import.meta.dirname, stdio: 'pipe' }
          ), { label: overlayMode });

          const compositedPath = join(WORK_DIR, `composited_${timestamp()}.mp4`);
          console.log('  Compositing overlay on (POV-modded) base...');
          execSync(
            `ffmpeg -y -i "${baseInputPath}" -c:v libvpx-vp9 -i "${overlayPath}" -filter_complex "[0:v]scale=1080:1920,gblur=sigma=22:enable='between(t,0,3)'[base];[base][1:v]overlay=0:0:eof_action=pass[out];[0:a]volume=1.0[a0];[1:a]volume=0.7[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]" -map "[out]" -map "[aout]" -c:v libx264 -preset fast -crf 18 -c:a aac -b:a 256k -ac 2 -movflags +faststart "${compositedPath}"`,
            { encoding: 'utf8', timeout: 300000, stdio: 'pipe' }
          );
          console.log(`  Composited: ${compositedPath}`);
          finalVideoPath = compositedPath;
          skyframeSucceeded = true;
          if (!baseModSucceeded) {
            console.log('  Note: HandLabel base-mod failed — output reflects overlay-only.');
          }
        } catch (e) {
          const stderr = (e.stderr || '').toString();
          const tail = (s) => s.length > 2000 ? '…' + s.slice(-2000) : s;
          console.log(`  Skyframe-pov overlay error: ${e.message || e}`);
          if (stderr.trim()) console.log(`  stderr:\n${tail(stderr).trim()}`);
          console.log('  Aborting — no gami-banner fallback.');
        }
      }
    } else if (process.env.ANTHROPIC_API_KEY) {
      console.log('  No usable beat plan from Claude. Aborting — no gami-banner fallback.');
    }
  }

  // Hard-fail discipline (locked): a requested skyframe pack is
  // NEVER silently swapped for gami-banner. If it was requested with a transcript
  // present but produced no overlay (render flake, planning miss, too few anchors),
  // abort so the operator knows — the usual cause is the transient Chrome-launch
  // timeout the retry above heals, so a re-run almost always works.
  const SKYFRAME_PACKS = new Set(['skyframe-5beat', 'skyframe-code', 'skyframe-pov']);
  if (SKYFRAME_PACKS.has(overlayMode) && transcriptFiles.length > 0 && !overlayDisabled && !skyframeSucceeded) {
    throw new Error(`${overlayMode} overlay could not be produced (see reason above) — aborting with no gami-banner fallback. If it was a transient render/Chrome-launch timeout, re-run "process --overlay ${overlayMode}".`);
  }

  // ── 3b: gami-banner path — only when explicitly requested (--overlay gami-banner) ─
  if (overlayMode === 'gami-banner' && transcriptFiles.length > 0 && !overlayDisabled) {
    console.log('\n  Step 3: Rendering 16-GAMI overlays...');

    // Load transcript
    const txPath = join(transcriptDir, transcriptFiles[transcriptFiles.length - 1]);
    const transcript = JSON.parse(readFileSync(txPath, 'utf8'));
    const words = (transcript.words || []).filter(w => w.type === 'word');

    // Extract key terms — priority: (1) Notion page by filename suffix, (2) local .md, (3) Claude fallback
    let keyTerms = [];
    let keyTermSource = '';

    const notionPageId = extractNotionIdFromFilename(video.name);
    if (notionPageId) {
      console.log(`  Notion page ID in filename: ${notionPageId}`);
      const ntn = await fetchNotionKeyTerms(notionPageId);
      if (ntn.error) {
        console.log(`  Notion fetch failed: ${ntn.error}. Falling back to local .md scan.`);
      } else {
        keyTerms = ntn.keyTerms;
        keyTermSource = `Notion: "${ntn.topic}"`;
        console.log(`  Key-term source: ${keyTermSource} (${keyTerms.length} terms)`);
      }
    }

    if (keyTerms.length === 0) {
      const qtFiles = existsSync(WORK_DIR)
        ? readdirSync(WORK_DIR).filter(f => (f.startsWith('quicktake_') || f.startsWith('beats_')) && f.endsWith('.md'))
            .sort((a, b) => {
              // Sort by embedded timestamp (last 19 chars before .md): 2026-04-16T21-39-38
              const tsA = a.slice(-22, -3);
              const tsB = b.slice(-22, -3);
              return tsA.localeCompare(tsB);
            })
        : [];
      if (qtFiles.length > 0) {
        const chosen = qtFiles[qtFiles.length - 1];
        const qtContent = readFileSync(join(WORK_DIR, chosen), 'utf8');
        const boldMatches = qtContent.match(/\*\*([^*]+)\*\*/g) || [];
        const metaWords = ['target:', 'bullets:', 'style:', 'generated:', 'format:', 'beats:'];
        keyTerms = boldMatches.map(m => m.replace(/\*\*/g, '').trim())
          .filter(t => t && !metaWords.includes(t.toLowerCase()));
        keyTerms = [...new Set(keyTerms)]; // dedupe
        if (keyTerms.length > 0) {
          keyTermSource = `Local: ${chosen}`;
          console.log(`  Key-term source: ${keyTermSource} (${keyTerms.length} terms)`);
        }
      }
    }

    // If nothing found yet, use Claude to pick key terms from the transcript
    if (keyTerms.length === 0 && process.env.ANTHROPIC_API_KEY) {
      try {
        console.log('  Extracting key terms via Claude...');
        const termResponse = await anthropic(
          'Extract 4-6 key terms from this transcript that would make good on-screen text overlays. Return ONLY the terms, one per line, no numbering, no explanation.',
          transcript.text || ''
        );
        keyTerms = termResponse.split('\n').map(l => l.trim().toLowerCase()).filter(Boolean).slice(0, 6);
      } catch {
        console.log('  Could not extract key terms, using fallback.');
      }
    }

    if (keyTerms.length > 0) {
      // Build cue list — for each canonical term, try the term + all known aliases against the transcript
      const cues = [];
      const missed = [];
      for (const term of keyTerms) {
        const variants = getTermVariants(term);
        let hit = null;
        for (const variant of variants) {
          const match = findPhraseInWords(variant, words);
          if (match) { hit = { match, variant }; break; }
        }
        if (hit) {
          const { match, variant } = hit;
          cues.push({
            text: term.toUpperCase(),
            start: words[match.startIdx].start,
            end: words[match.endIdx].end + 1.5, // Hold 1.5s past last spoken word
            position: 'bottom',
            style: cues.length === 0 ? 'banner' : cues.length === keyTerms.length - 1 ? 'pill' : 'banner',
          });
          if (variant.toLowerCase() !== term.toLowerCase()) {
            console.log(`    ✓ "${term}" matched via alias "${variant}"`);
          } else {
            console.log(`    ✓ "${term}"`);
          }
        } else {
          missed.push(term);
        }
      }
      if (missed.length > 0) {
        console.log(`    ✗ Not found in transcript: ${missed.join(', ')}`);
      }

      if (cues.length > 0) {
        console.log(`  Found ${cues.length} cue points: ${cues.map(c => c.text).join(', ')}`);

        // Get video duration for composition length
        const probeOut = execSync(
          `ffprobe -v quiet -print_format json -show_format "${gradedPath}"`,
          { encoding: 'utf8', timeout: 10000 }
        );
        const videoDuration = parseFloat(JSON.parse(probeOut).format?.duration || 60);
        const totalFrames = Math.ceil(videoDuration * 30);

        // Write props file for Remotion. durationInFrames is read by the
        // composition's calculateMetadata so the comp resizes to the source video.
        const propsPath = join(WORK_DIR, 'overlay_props.json');
        writeFileSync(propsPath, JSON.stringify({ cues, durationInFrames: totalFrames }));

        // Render overlay as VP9 WebM with alpha
        const overlayPath = join(WORK_DIR, `overlay_${timestamp()}.webm`);
        console.log('  Rendering Remotion overlay...');
        try {
          await withRemotionBrowserRetry(() => execSync(
            `npx remotion render src/remotion/index.jsx GamiBannerOverlay "${overlayPath}" --codec=vp9 --pixel-format=yuva420p --image-format=png --props "${propsPath}" --frames=0-${totalFrames - 1}`,
            { encoding: 'utf8', timeout: 600000, cwd: import.meta.dirname, stdio: 'pipe' }
          ), { label: 'gami-banner' });
          console.log(`  Overlay rendered: ${overlayPath}`);

          // Composite overlay on top of video
          const compositedPath = join(WORK_DIR, `composited_${timestamp()}.mp4`);
          console.log('  Compositing overlay on video...');
          execSync(
            `ffmpeg -y -i "${gradedPath}" -c:v libvpx-vp9 -i "${overlayPath}" -filter_complex "[0:v]scale=1080:1920[base];[base][1:v]overlay=0:0:eof_action=pass[out]" -map "[out]" -map 0:a -c:v libx264 -preset fast -crf 18 -c:a aac -b:a 256k -ac 2 -movflags +faststart "${compositedPath}"`,
            { encoding: 'utf8', timeout: 300000, stdio: 'pipe' }
          );
          console.log(`  Composited: ${compositedPath}`);
          finalVideoPath = compositedPath;
        } catch (e) {
          console.log(`  Overlay error: ${e.message?.slice(0, 150)}`);
          console.log('  Continuing without overlays.');
        }
      } else {
        console.log('  No cue points matched in transcript. Skipping overlays.');
      }
    } else {
      console.log('  No key terms found. Skipping overlays.');
    }
  } else if (skyframeSucceeded) {
    // already handled by 3a, nothing to say
  } else if (overlayDisabled) {
    console.log('\n  Step 3: Skipping overlays (--no-overlay or --overlay none)');
  } else {
    console.log('\n  Step 3: No transcript available, skipping overlays.');
  }

  // ── Step 4: QC gate ───────────────────────────────────────────────────

  console.log('\n  Step 4: QC check...');
  let qcPassed = true;
  let qcNotes = [];

  try {
    const probeJson = execSync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${finalVideoPath}"`,
      { encoding: 'utf8', timeout: 15000 }
    );
    const probe = JSON.parse(probeJson);
    const duration = parseFloat(probe.format?.duration || 0);
    const videoStream = probe.streams?.find(s => s.codec_type === 'video');
    const audioStream = probe.streams?.find(s => s.codec_type === 'audio');

    if (duration < 5) { qcPassed = false; qcNotes.push(`Too short: ${duration.toFixed(1)}s`); }
    if (duration > 180) { qcNotes.push(`Long: ${duration.toFixed(1)}s — consider trimming`); }
    if (!audioStream) { qcPassed = false; qcNotes.push('No audio stream detected'); }
    if (!videoStream) { qcPassed = false; qcNotes.push('No video stream detected'); }
    if (videoStream) {
      const w = parseInt(videoStream.width);
      const h = parseInt(videoStream.height);
      if (w < 720 || h < 720) qcNotes.push(`Low resolution: ${w}x${h}`);
    }

    console.log(`  Duration: ${duration.toFixed(1)}s`);
    console.log(`  Video: ${videoStream?.codec_name} ${videoStream?.width}x${videoStream?.height}`);
    console.log(`  Audio: ${audioStream?.codec_name} ${audioStream?.sample_rate}Hz`);
  } catch {
    qcNotes.push('Could not probe video');
  }

  if (qcPassed) {
    console.log('  QC: PASSED');
  } else {
    console.log(`  QC: FAILED — ${qcNotes.join(', ')}`);
    console.log('  Aborting upload. Fix the issues and re-run.');
    return { status: 'qc_failed', notes: qcNotes, path: gradedPath };
  }
  if (qcNotes.length > 0) {
    console.log(`  QC notes: ${qcNotes.join(', ')}`);
  }

  // ── Step 4: Upload to /Short form OUT/ ────────────────────────────────

  console.log('\n  Step 5: Uploading to Drive /Short form OUT/...');
  const finalName = `shortform_${timestamp()}.mp4`;
  const uploaded = driveUpload(finalVideoPath, DRIVE_FOLDERS.shortformOut, finalName);
  console.log(`  Uploaded: ${uploaded.name || finalName} (${uploaded.id})`);

  // ── Move source from /IN/ to trash (processed) ────────────────────────

  try {
    const trashParams = JSON.stringify({ fileId: video.id });
    const trashJson = JSON.stringify({ trashed: true });
    execSync(
      `gws drive files update --params "${trashParams.replace(/"/g, '\\"')}" --json "${trashJson.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8', timeout: 15000 }
    );
    console.log(`  Moved source to trash: ${video.name}`);
  } catch (e) {
    console.log(`  Could not trash source: ${e.message?.slice(0, 80)}`);
  }

  console.log(`\n  Done. Final video: /Short form OUT/${finalName}\n`);

  return { status: 'uploaded', name: finalName, driveId: uploaded.id };
}


// ═══════════════════════════════════════════════════════════════════════════
// MODE 4: LONGFORM — YouTube pipeline (POV + desk cam + voice anchor + clips)
// ═══════════════════════════════════════════════════════════════════════════
// Input: one or two camera feeds (Ray-Ban POV required; desk cam optional).
// Output: intro+body+outro YouTube-ready mp4 + 3-5 vertical clips + metadata
//         bundle (title, description, chapters, thumbnail concepts, LinkedIn
//         draft, X thread) + everything uploaded to Drive.
// Phase 1 scope: grade + simple stitch + ElevenLabs intro/outro + clips.
// Phase 2 (deferred): Remotion lower-third + chapter cards + real cutaway splicing.

async function elevenLabsTTS(text, voiceId, outputPath) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');

  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs TTS ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  writeFileSync(outputPath, buffer);
  return outputPath;
}

async function claudeLongformMetadata({ transcript, topic, sessionLabel, povDurationSec }) {
  const dur = povDurationSec || 0;
  const isShort = dur > 0 && dur < 420; // under 7 minutes
  const chapterMin = isShort ? 3 : 6;
  const chapterMax = isShort && dur > 0 ? Math.min(6, Math.max(chapterMin, Math.floor(dur / 30))) : 10;
  const clipMin = isShort ? 2 : 3;
  const clipMax = isShort && dur > 0 ? Math.min(3, Math.max(clipMin, Math.floor(dur / 45))) : 5;
  const clipDurMin = isShort ? 20 : 30;
  const clipDurMax = isShort && dur > 0 ? Math.min(45, Math.max(clipDurMin, Math.floor(dur / 3))) : 60;
  const durLine = dur > 0
    ? `Video duration: ${dur.toFixed(1)} seconds. EVERY timestamp (chapter start, clip start, clip start + duration) must land inside [0, ${dur.toFixed(1)}].`
    : `Video duration: unknown. Keep timestamps conservative.`;

  const systemPrompt = `You are a YouTube editor for an AI/cybersecurity builder whose Ray-Ban-Meta POV format performs well on Instagram (high save:like, strong shares, pattern-interrupt hooks).

You receive a word-level transcript of an unscripted development session. Identify the structure for YouTube longform publication.

Output ONE JSON object with this EXACT shape (no markdown fences, no commentary before or after):

{
  "title": "15-70 char YouTube title, curiosity-gap, no clickbait fluff, no emojis",
  "description": "3-5 paragraph description. Para 1: what this session covers. Para 2: key takeaways. Para 3: CTA to follow/subscribe.",
  "chapters": [
    { "start_sec": 0, "title": "Short chapter title (3-7 words)" }
  ],
  "vertical_clips": [
    { "start_sec": 0, "duration_sec": 45, "hook": "punchy clip title", "pillar": "A" }
  ],
  "thumbnail_concepts": ["one-sentence thumbnail idea"],
  "linkedin_draft": "5-8 sentence LinkedIn post in authoritative-but-conversational voice referencing the specific work shown",
  "x_thread": ["tweet 1", "tweet 2"]
}

Hard rules:
- ${durLine}
- ${chapterMin}-${chapterMax} chapters total, first chapter starts at 0, chapters minimum 30s apart
- ${clipMin}-${clipMax} vertical clips, each ${clipDurMin}-${clipDurMax} seconds, pillar must be exactly A|B|C|D where:
  A = Workflow moment (replicable takeaway)
  B = Research reveal (research findings, authority)
  C = Hot take / comparison (pattern-interrupt — proven winner)
  D = Breadstick demo (tool in action, no pitch)
- 3 thumbnail concepts
- 3-6 tweets in x_thread, each under 280 characters
- NO em-dashes, NO en-dashes, NO smart quotes anywhere
- "Claude Code" only in title if the session is specifically about it
- Dates, numerals, and technical terms preserved verbatim`;

  const transcriptText = transcript.words?.map(w => w.text || w.word).join(' ') || transcript.text || '';
  const usr = `Topic label: ${topic || 'dev session'}\nSession label: ${sessionLabel || 'untitled'}\nVideo duration: ${dur > 0 ? dur.toFixed(1) + ' seconds' : 'unknown'}\n\nTranscript:\n${transcriptText}`;

  const resp = await anthropic(systemPrompt, usr);

  // Robust JSON extraction — handle occasional markdown fencing despite instructions
  let cleaned = resp.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  // Grab the outermost { ... } if there's stray prose
  const braceMatch = cleaned.match(/\{[\s\S]*\}/);
  if (braceMatch) cleaned = braceMatch[0];

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Claude returned unparseable JSON: ${e.message}\nRaw (first 500): ${resp.slice(0, 500)}`);
  }
}

function ffmpegGradeLocal(inputPath, outputPath, lutPath = null) {
  let ffmpegFilter = '';
  if (lutPath && existsSync(lutPath)) {
    ffmpegFilter = `-vf "lut3d='${lutPath.replace(/\\/g, '/')}'"`;
  } else {
    ffmpegFilter = '-vf "eq=contrast=1.05:brightness=0.02:saturation=1.08"';
  }
  execSync(
    `ffmpeg -y -i "${inputPath}" ${ffmpegFilter} -c:a copy "${outputPath}"`,
    { encoding: 'utf8', timeout: 900000, stdio: 'pipe' }
  );
  return outputPath;
}

function findSystemFont() {
  const candidates = [
    'C:/Windows/Fonts/arialbd.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function ffprobeDimensions(videoPath) {
  try {
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_streams -select_streams v:0 "${videoPath}"`,
      { encoding: 'utf8', timeout: 15000 }
    );
    const stream = JSON.parse(out).streams?.[0];
    const width = stream?.width;
    const height = stream?.height;
    if (!width || !height) return null;
    return { width, height };
  } catch {
    return null;
  }
}

function ffmpegConcatVideos(inputPaths, outputPath, opts = {}) {
  const safeInputs = inputPaths.filter(p => p && existsSync(p));
  if (safeInputs.length === 0) throw new Error('No inputs to concat');
  if (safeInputs.length === 1) {
    writeFileSync(outputPath, readFileSync(safeInputs[0]));
    return outputPath;
  }
  const targetW = opts.width || 1920;
  const targetH = opts.height || 1080;
  const inputArgs = safeInputs.map(p => `-i "${p}"`).join(' ');
  const normParts = safeInputs.map((_, i) =>
    `[${i}:v:0]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];[${i}:a:0]aresample=48000:first_pts=0[a${i}]`
  ).join(';');
  const concatIn = safeInputs.map((_, i) => `[v${i}][a${i}]`).join('');
  const filter = `${normParts};${concatIn}concat=n=${safeInputs.length}:v=1:a=1[v][a]`;
  execSync(
    `ffmpeg -y ${inputArgs} -filter_complex "${filter}" -map "[v]" -map "[a]" -c:v libx264 -preset medium -crf 19 -c:a aac -b:a 256k -ar 48000 -ac 2 -movflags +faststart "${outputPath}"`,
    { encoding: 'utf8', timeout: 1200000, stdio: 'pipe' }
  );
  return outputPath;
}

function ffmpegTitleCardFromAudio(audioPath, outputPath, titleText = '', opts = {}) {
  const probeOut = execSync(`ffprobe -v quiet -print_format json -show_format "${audioPath}"`, { encoding: 'utf8', timeout: 10000 });
  const duration = parseFloat(JSON.parse(probeOut).format?.duration || 5);
  const width = opts.width || 1920;
  const height = opts.height || 1080;
  const fontSize = Math.round(Math.min(width, height) / 17);
  const fontPath = findSystemFont();
  const escapedText = (titleText || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
  const textFilter = (escapedText && fontPath)
    ? `,drawtext=text='${escapedText}':fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2:fontfile='${fontPath}'`
    : '';
  execSync(
    `ffmpeg -y -f lavfi -i color=c=black:s=${width}x${height}:r=30:d=${duration.toFixed(2)} -i "${audioPath}" -vf "format=yuv420p${textFilter}" -c:v libx264 -preset fast -crf 20 -c:a aac -b:a 256k -ar 48000 -ac 2 -shortest "${outputPath}"`,
    { encoding: 'utf8', timeout: 120000, stdio: 'pipe' }
  );
  return outputPath;
}

function ffmpegExtractVerticalClip(inputPath, startSec, durationSec, outputPath) {
  // Center-crop to 9:16, scale to 1080x1920
  execSync(
    `ffmpeg -y -ss ${startSec} -i "${inputPath}" -t ${durationSec} -vf "crop=ih*9/16:ih,scale=1080:1920" -c:v libx264 -preset medium -crf 19 -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`,
    { encoding: 'utf8', timeout: 300000, stdio: 'pipe' }
  );
  return outputPath;
}

function ffmpegCutawayStitch({ povPath, deskPath, outputPath }) {
  // Phase 1: POV primary throughout. Desk cam is captured + graded but not spliced yet.
  // Phase 2 will add per-segment cutaway based on Claude's camera-lead flags.
  // Ensures pipeline ships now; splicing is additive.
  writeFileSync(outputPath, readFileSync(povPath));
  if (deskPath && existsSync(deskPath)) {
    console.log('  (Cutaway splicing: Phase 2 — graded desk cam reserved at ' + deskPath + ')');
  }
  return outputPath;
}

// ── Silence removal (ported from vidpipe/htekdev — ISC licensed) ───────────
// Algorithm: ffmpeg silencedetect → filter >= 2s → cap 30 longest → Claude
// decides context-aware removals → 20% total-duration cap → trim+concat cut.

function ffmpegDetectSilence(videoPath, minDur = 1.0, threshold = '-30dB') {
  const out = execSync(
    `ffmpeg -i "${videoPath}" -af silencedetect=noise=${threshold}:d=${minDur} -f null - 2>&1`,
    { encoding: 'utf8', timeout: 900000, shell: true, maxBuffer: 64 * 1024 * 1024 }
  );
  const regions = [];
  let pendingStart = null;
  for (const line of out.split('\n')) {
    const s = line.match(/silence_start:\s*([\d.]+)/);
    if (s) { pendingStart = parseFloat(s[1]); continue; }
    const e = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
    if (e) {
      const end = parseFloat(e[1]);
      const duration = parseFloat(e[2]);
      const start = pendingStart ?? Math.max(0, end - duration);
      if (end > start) regions.push({ start, end, duration });
      pendingStart = null;
    }
  }
  return regions;
}

async function claudeDecideSilenceRemovals({ transcript, silenceRegions, videoDurationSec, filename }) {
  const systemPrompt = `You are a video editor AI deciding which silent regions in an unscripted POV recording should be removed.

Be CONSERVATIVE. Only remove silence that is CLEARLY dead air — no speech, no demonstration, no purpose. Aim to remove no more than 10-15% of total video duration. When in doubt, KEEP the silence.

KEEP silences that are:
- Dramatic pauses after impactful statements
- Brief thinking pauses (< 2 seconds) in natural speech
- Pauses before important reveals or demonstrations
- Pauses while the speaker is showing something on screen or reading from a monitor
- Silence during typing or any visible on-screen activity

REMOVE silences that are:
- Dead air with no purpose (> 3 seconds of nothing)
- Gaps between topics where the speaker was gathering thoughts
- Silence at the very beginning or end of the video
- Long restart / recomposition pauses that broke flow

Output ONE JSON object with this EXACT shape (no markdown fences, no commentary before or after):

{
  "removals": [
    { "start": 0.0, "end": 0.0, "reason": "why this should be removed" }
  ]
}

- start and end are seconds (floating point), matching one of the supplied silence regions
- reason is a short string explaining the call`;

  // Build transcript context. Prefer word-level → group into 15s buckets for readability.
  let transcriptLines = [];
  if (Array.isArray(transcript.segments) && transcript.segments.length > 0) {
    transcriptLines = transcript.segments.map(s => `[${(s.start || 0).toFixed(2)}s - ${(s.end || 0).toFixed(2)}s] ${s.text || ''}`);
  } else if (Array.isArray(transcript.words) && transcript.words.length > 0) {
    const buckets = new Map();
    for (const w of transcript.words) {
      const t = w.start ?? 0;
      const idx = Math.floor(t / 15);
      if (!buckets.has(idx)) buckets.set(idx, { start: idx * 15, words: [] });
      buckets.get(idx).words.push(w.text || w.word || '');
    }
    transcriptLines = [...buckets.values()]
      .sort((a, b) => a.start - b.start)
      .map(b => `[${b.start}s+] ${b.words.join(' ')}`);
  }

  const silenceLines = silenceRegions.map((r, i) =>
    `${i + 1}. ${r.start.toFixed(2)}s - ${r.end.toFixed(2)}s (${r.duration.toFixed(2)}s)`
  );

  const userPrompt = [
    `Video: ${filename} (${videoDurationSec.toFixed(1)}s total)`,
    '',
    '--- TRANSCRIPT ---',
    transcriptLines.join('\n'),
    '--- END TRANSCRIPT ---',
    '',
    '--- SILENCE REGIONS ---',
    silenceLines.join('\n'),
    '--- END SILENCE REGIONS ---',
    '',
    'Decide which silence regions to remove. Return JSON only.',
  ].join('\n');

  const resp = await anthropic(systemPrompt, userPrompt);
  let cleaned = resp.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  const brace = cleaned.match(/\{[\s\S]*\}/);
  if (brace) cleaned = brace[0];
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed.removals) ? parsed.removals : [];
  } catch (e) {
    throw new Error(`Silence removals JSON parse failed: ${e.message}\nRaw (first 400): ${resp.slice(0, 400)}`);
  }
}

function ffmpegCutSilences(inputPath, keepSegments, outputPath) {
  if (!keepSegments || keepSegments.length === 0) throw new Error('No keep segments');
  const parts = [];
  keepSegments.forEach((seg, i) => {
    parts.push(`[0:v]trim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
  });
  const concatIn = keepSegments.map((_, i) => `[v${i}][a${i}]`).join('');
  const filter = `${parts.join(';')};${concatIn}concat=n=${keepSegments.length}:v=1:a=1[vout][aout]`;
  execSync(
    `ffmpeg -y -i "${inputPath}" -filter_complex "${filter}" -map "[vout]" -map "[aout]" -c:v libx264 -preset medium -crf 19 -c:a aac -b:a 192k -movflags +faststart "${outputPath}"`,
    { encoding: 'utf8', timeout: 1800000, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 }
  );
  return outputPath;
}

function remapTimestamp(t, keepSegments) {
  let offset = 0;
  for (const seg of keepSegments) {
    if (t < seg.start) return null;
    if (t <= seg.end) return offset + (t - seg.start);
    offset += (seg.end - seg.start);
  }
  return null;
}

function remapTranscriptTimestamps(transcript, keepSegments) {
  const remap = t => remapTimestamp(t, keepSegments);
  const mapped = { ...transcript };
  if (Array.isArray(transcript.words)) {
    mapped.words = transcript.words.map(w => {
      const ns = remap(w.start ?? 0);
      const ne = remap(w.end ?? w.start ?? 0);
      if (ns === null || ne === null) return null;
      return { ...w, start: ns, end: ne };
    }).filter(Boolean);
  }
  if (Array.isArray(transcript.segments)) {
    mapped.segments = transcript.segments.map(s => {
      const ns = remap(s.start ?? 0);
      const ne = remap(s.end ?? s.start ?? 0);
      if (ns === null || ne === null) return null;
      return { ...s, start: ns, end: ne };
    }).filter(Boolean);
  }
  mapped.duration = keepSegments.reduce((sum, s) => sum + (s.end - s.start), 0);
  return mapped;
}

// ── Non-LLM ship gate (deterministic arbiter pattern) ──
// Deterministic validator: takes Claude's metadata JSON, returns SHIP | QUARANTINE | REJECT.
// No LLM in the verdict path. Cannot be prompt-injected because decisions are scalar comparisons.

const INJECTION_PATTERNS = [
  { name: 'INSTRUCTION_INJECTION', weight: 1.0, re: /ignore\s+(all\s+)?previous|system\s*:|do\s+not\s+flag|override\s+previous|new\s+instructions?/i },
  { name: 'ROLE_BLEEDTHROUGH',     weight: 0.9, re: /^(you|assistant|system|user)\s*:/im },
  { name: 'TOOL_USE_BLEED',        weight: 1.0, re: /<function_calls?>|<tool_use>|<|<\/antml:/i },
  { name: 'STRUCTURAL_BREAK',      weight: 0.6, re: /```|\n{5,}/ },
  { name: 'AUTHORITY_CLAIM',       weight: 0.7, re: /\bconfirmed\s+by\b|\bas\s+an?\s+admin\b|\bper\s+policy\b|\bsudo\s+|\broot\s+access\b/i },
];

function scanInjection(str, field, violations) {
  if (typeof str !== 'string') return;
  for (const p of INJECTION_PATTERNS) {
    const m = str.match(p.re);
    if (m) violations.push({ type: p.name, field, match: m[0].slice(0, 100), weight: p.weight });
  }
}

function longformShipGate(metadata, povDurationSec = 0) {
  const reasons = [];
  const warnings = [];
  const violations = [];
  const m = metadata || {};

  // Hard-fail skeleton (type contract)
  if (typeof m.title !== 'string' || !m.title.trim()) reasons.push('title: missing or not a non-empty string');
  if (typeof m.description !== 'string' || !m.description.trim()) reasons.push('description: missing or not a non-empty string');
  if (!Array.isArray(m.chapters)) reasons.push('chapters: must be an array');
  if (!Array.isArray(m.vertical_clips)) reasons.push('vertical_clips: must be an array');
  if (reasons.length > 0) return { verdict: 'REJECT', reasons, warnings, violations, taintScore: 0 };

  // Title + description scans
  scanInjection(m.title, 'title', violations);
  scanInjection(m.description, 'description', violations);
  if (m.title.length < 15 || m.title.length > 80) warnings.push(`title length ${m.title.length} out of [15,80]`);

  // Chapters
  if (m.chapters.length < 6 || m.chapters.length > 10) warnings.push(`chapter count ${m.chapters.length} out of [6,10]`);
  if (m.chapters[0]?.start_sec !== 0) warnings.push('first chapter does not start at 0s');
  for (let i = 0; i < m.chapters.length; i++) {
    const c = m.chapters[i] || {};
    if (typeof c.start_sec !== 'number' || c.start_sec < 0) { reasons.push(`chapters[${i}].start_sec invalid`); continue; }
    if (povDurationSec > 0 && c.start_sec > povDurationSec) reasons.push(`chapters[${i}].start_sec (${c.start_sec}s) exceeds video duration (${povDurationSec.toFixed(1)}s)`);
    if (typeof c.title !== 'string' || !c.title.trim()) reasons.push(`chapters[${i}].title missing`);
    else scanInjection(c.title, `chapters[${i}].title`, violations);
    if (i > 0 && typeof m.chapters[i - 1].start_sec === 'number' && (c.start_sec - m.chapters[i - 1].start_sec) < 30) {
      warnings.push(`chapters[${i}] is less than 30s from previous chapter`);
    }
  }

  // Vertical clips
  if (m.vertical_clips.length < 3 || m.vertical_clips.length > 5) warnings.push(`vertical_clips count ${m.vertical_clips.length} out of [3,5]`);
  for (let i = 0; i < m.vertical_clips.length; i++) {
    const c = m.vertical_clips[i] || {};
    if (typeof c.start_sec !== 'number' || c.start_sec < 0) { reasons.push(`vertical_clips[${i}].start_sec invalid`); continue; }
    if (typeof c.duration_sec !== 'number' || c.duration_sec < 20 || c.duration_sec > 75) reasons.push(`vertical_clips[${i}].duration_sec (${c.duration_sec}) out of [20,75]`);
    if (povDurationSec > 0 && (c.start_sec + (c.duration_sec || 0)) > povDurationSec + 1) reasons.push(`vertical_clips[${i}] end time (${c.start_sec + (c.duration_sec || 0)}s) exceeds video duration (${povDurationSec.toFixed(1)}s)`);
    if (typeof c.hook !== 'string' || !c.hook.trim()) reasons.push(`vertical_clips[${i}].hook missing`);
    else scanInjection(c.hook, `vertical_clips[${i}].hook`, violations);
    if (!['A', 'B', 'C', 'D'].includes(c.pillar)) reasons.push(`vertical_clips[${i}].pillar must be A|B|C|D, got "${c.pillar}"`);
  }

  // Optional fields
  if (Array.isArray(m.thumbnail_concepts)) {
    m.thumbnail_concepts.forEach((t, i) => { if (typeof t === 'string') scanInjection(t, `thumbnail_concepts[${i}]`, violations); });
  }
  if (typeof m.linkedin_draft === 'string') scanInjection(m.linkedin_draft, 'linkedin_draft', violations);
  if (Array.isArray(m.x_thread)) {
    m.x_thread.forEach((t, i) => {
      if (typeof t !== 'string') { reasons.push(`x_thread[${i}] not a string`); return; }
      if (t.length > 280) warnings.push(`x_thread[${i}] length ${t.length} > 280`);
      scanInjection(t, `x_thread[${i}]`, violations);
    });
  }

  // Composite taint decision (scalar comparison, no LLM)
  const taintScore = Math.min(1.0, violations.reduce((s, v) => s + v.weight, 0));
  const QUARANTINE_THRESHOLD = 0.8;

  if (reasons.length > 0) return { verdict: 'REJECT', reasons, warnings, violations, taintScore };
  if (taintScore >= QUARANTINE_THRESHOLD) {
    return { verdict: 'QUARANTINE', reasons: [`injection signatures detected (taint score ${taintScore.toFixed(2)} >= ${QUARANTINE_THRESHOLD})`], warnings, violations, taintScore };
  }
  return { verdict: 'SHIP', reasons: [], warnings, violations, taintScore };
}

async function runSilenceCut({ povPath, transcript, workDir }) {
  // Returns { cutPath, cutTranscript, report } or null if no cut applied.
  console.log('\n  Step 1.5: Silence detection + context-aware cut...');
  const silenceRegions = ffmpegDetectSilence(povPath, 1.0, '-30dB');
  const totalSilence = silenceRegions.reduce((s, r) => s + r.duration, 0);
  console.log(`    Detected: ${silenceRegions.length} regions (${totalSilence.toFixed(1)}s total silence)`);

  let forAgent = silenceRegions.filter(r => r.duration >= 2);
  if (forAgent.length === 0) {
    console.log('    No regions >= 2s — skipping silence cut.');
    return null;
  }
  if (forAgent.length > 30) {
    forAgent = [...forAgent].sort((a, b) => b.duration - a.duration).slice(0, 30);
    forAgent.sort((a, b) => a.start - b.start);
    console.log('    Capped to top 30 longest regions for Claude analysis.');
  }

  const probeOut = execSync(`ffprobe -v quiet -print_format json -show_format "${povPath}"`, { encoding: 'utf8', timeout: 15000 });
  const videoDurationSec = parseFloat(JSON.parse(probeOut).format?.duration || 0);
  if (!videoDurationSec) { console.log('    Could not probe duration — skipping.'); return null; }

  let removals;
  try {
    removals = await claudeDecideSilenceRemovals({
      transcript,
      silenceRegions: forAgent,
      videoDurationSec,
      filename: basename(povPath),
    });
  } catch (e) {
    console.log(`    Claude decision failed — skipping cut: ${e.message?.slice(0, 180)}`);
    return null;
  }
  if (!removals || removals.length === 0) {
    console.log('    Claude kept all silences — no cut.');
    return null;
  }

  // 20% safety cap: take largest removals until we hit the ceiling
  const maxRemoval = videoDurationSec * 0.20;
  let total = 0;
  const capped = [];
  for (const r of [...removals].sort((a, b) => (b.end - b.start) - (a.end - a.start))) {
    const dur = r.end - r.start;
    if (dur <= 0) continue;
    if (total + dur <= maxRemoval) { capped.push(r); total += dur; }
  }
  if (capped.length < removals.length) {
    console.log(`    Capped ${removals.length} → ${capped.length} removals (${total.toFixed(1)}s ≤ 20% threshold)`);
  }
  if (capped.length === 0) { console.log('    All removals exceeded 20% cap — skipping.'); return null; }

  // Build keep segments from the capped removals
  const sortedRem = [...capped].sort((a, b) => a.start - b.start);
  const keep = [];
  let cursor = 0;
  for (const r of sortedRem) {
    if (r.start > cursor) keep.push({ start: cursor, end: r.start });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < videoDurationSec) keep.push({ start: cursor, end: videoDurationSec });
  if (keep.length === 0) { console.log('    No keep segments — skipping.'); return null; }

  const cutPath = join(workDir, 'pov_cut.mp4');
  try {
    ffmpegCutSilences(povPath, keep, cutPath);
  } catch (e) {
    console.log(`    Cut encode failed: ${e.message?.slice(0, 180)} — falling back to original.`);
    return null;
  }

  const cutTranscript = remapTranscriptTimestamps(transcript, keep);
  const removedSec = capped.reduce((s, r) => s + (r.end - r.start), 0);
  console.log(`    Removed ${capped.length} regions (${removedSec.toFixed(1)}s = ${(removedSec / videoDurationSec * 100).toFixed(1)}% of source)`);
  console.log(`    Cut POV: ${cutPath} (${cutTranscript.duration.toFixed(1)}s)`);
  return { cutPath, cutTranscript, removals: capped, keep, removedSec };
}

async function longform(opts = {}) {
  const povInput = opts.pov;
  if (!povInput) { console.error('Error: --pov <path-or-driveId> is required.'); process.exit(1); }

  const voiceId = opts.voiceId || process.env.ELEVENLABS_VOICE_ID;
  const sessionLabel = opts.session || `session_${timestamp()}`;
  const topic = opts.topic || 'dev session';
  const lut = opts.lut || 'default';

  mkdirSync(WORK_DIR, { recursive: true });
  const workDir = join(WORK_DIR, `longform_${timestamp()}`);
  mkdirSync(workDir, { recursive: true });

  console.log(`\n  LONGFORM: ${sessionLabel}`);
  console.log(`  Topic: ${topic} | Work dir: ${workDir}\n`);

  // ── Resolve inputs (local path OR Drive file ID) ──────────────────────
  const resolvePath = (input, label) => {
    if (!input) return null;
    if (existsSync(input)) return input;
    const out = join(workDir, `${label}.mp4`);
    console.log(`  Downloading ${label} from Drive: ${input}`);
    driveDownload(input, out);
    return out;
  };

  const povPath = resolvePath(povInput, 'pov');
  const deskPath = opts.desk ? resolvePath(opts.desk, 'desk') : null;
  console.log(`  POV: ${povPath}`);
  if (deskPath) console.log(`  Desk: ${deskPath}`);

  // Probe POV dimensions so intro/outro cards + concat match the native aspect
  const povDims = ffprobeDimensions(povPath) || { width: 1920, height: 1080 };
  const aspectLabel = povDims.width >= povDims.height ? 'landscape' : 'portrait';
  console.log(`  Dimensions: ${povDims.width}x${povDims.height} (${aspectLabel})`);

  // ── Step 1: Transcribe POV audio ──────────────────────────────────────
  console.log('\n  Step 1: Transcribing POV audio (ElevenLabs Scribe)...');
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const transcribeScript = join(homeDir, '.claude', 'skills', 'video-use', 'helpers', 'transcribe.py');
  let transcript = null;
  if (!existsSync(transcribeScript)) {
    console.error(`  Missing transcribe script: ${transcribeScript}`);
    console.error('  Install the video-use skill first.');
    process.exit(1);
  }
  try {
    const editDir = join(workDir, 'edit');
    mkdirSync(editDir, { recursive: true });
    execSync(
      `python "${transcribeScript}" "${povPath}" --edit-dir "${editDir}" --language en --num-speakers 1`,
      { encoding: 'utf8', timeout: 1200000 }
    );
    const transcriptDir = join(editDir, 'transcripts');
    const files = existsSync(transcriptDir) ? readdirSync(transcriptDir).filter(f => f.endsWith('.json')) : [];
    if (files.length > 0) {
      transcript = JSON.parse(readFileSync(join(transcriptDir, files[files.length - 1]), 'utf8'));
      console.log(`  Transcript: ${transcript.words?.length || 0} words`);
    }
  } catch (e) {
    console.error(`  Transcription error: ${e.message?.slice(0, 200)}`);
    process.exit(1);
  }
  if (!transcript) { console.error('  No transcript generated. Aborting.'); process.exit(1); }

  // ── Step 1.5 (optional): Silence detection + context-aware cut ────────
  let activePovPath = povPath;
  let silenceReport = null;
  if (opts.silenceCut) {
    const cut = await runSilenceCut({ povPath, transcript, workDir });
    if (cut) {
      activePovPath = cut.cutPath;
      transcript = cut.cutTranscript;
      silenceReport = { removals: cut.removals, keep: cut.keep, removedSec: cut.removedSec };
    }
  }

  // Probe the active POV duration once — used by metadata prompt (to bound timestamps)
  // and by the ship gate (to validate timestamps). Computed on the silence-cut output
  // if that ran, otherwise on the original POV.
  let povDurationSec = 0;
  try {
    const probe = execSync(`ffprobe -v quiet -print_format json -show_format "${activePovPath}"`, { encoding: 'utf8', timeout: 15000 });
    povDurationSec = parseFloat(JSON.parse(probe).format?.duration || 0);
  } catch {}

  // ── Step 2: Claude metadata generation ────────────────────────────────
  console.log('\n  Step 2: Claude ranking moments + generating metadata...');
  let metadata;
  try {
    metadata = await claudeLongformMetadata({ transcript, topic, sessionLabel, povDurationSec });
    console.log(`  Title: ${metadata.title}`);
    console.log(`  Chapters: ${metadata.chapters?.length || 0}`);
    console.log(`  Vertical clips: ${metadata.vertical_clips?.length || 0}`);
  } catch (e) {
    console.error(`  Metadata generation failed: ${e.message}`);
    process.exit(1);
  }
  const metadataPath = join(workDir, 'metadata.json');
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  console.log(`  Saved metadata: ${metadataPath}`);

  // ── Step 2.5: Non-LLM ship gate ──────────────────────────────────────
  console.log('\n  Step 2.5: Non-LLM ship gate (deterministic validator)...');
  const gate = longformShipGate(metadata, povDurationSec);
  console.log(`    Verdict: ${gate.verdict}  |  taint=${gate.taintScore.toFixed(2)}  |  warnings=${gate.warnings.length}  violations=${gate.violations.length}`);
  for (const w of gate.warnings) console.log(`    WARN  ${w}`);
  for (const v of gate.violations) console.log(`    VIOLATION [${v.type}] ${v.field}: "${v.match}"`);
  if (gate.reasons.length > 0) for (const r of gate.reasons) console.log(`    REASON  ${r}`);

  const gateReportPath = join(workDir, 'ship_gate_report.json');
  writeFileSync(gateReportPath, JSON.stringify(gate, null, 2));

  if (gate.verdict !== 'SHIP') {
    const quarantineDir = join(workDir, 'quarantine');
    mkdirSync(quarantineDir, { recursive: true });
    const qPath = join(quarantineDir, 'metadata_blocked.json');
    writeFileSync(qPath, JSON.stringify({ verdict: gate.verdict, reasons: gate.reasons, warnings: gate.warnings, violations: gate.violations, taintScore: gate.taintScore, metadata }, null, 2));
    console.error(`\n  SHIP GATE BLOCKED: ${gate.verdict}`);
    console.error(`  Quarantined: ${qPath}`);
    if (!opts.skipShipGate) {
      console.error(`  Rerun with --skip-ship-gate to bypass (not recommended).`);
      return { status: 'gated', verdict: gate.verdict, gate, workDir };
    }
    console.error(`  Bypassing gate per --skip-ship-gate. Proceeding at operator risk.`);
  }

  // ── Step 3: Color grade ───────────────────────────────────────────────
  console.log('\n  Step 3: Color grading...');
  const gradedPovPath = join(workDir, 'pov_graded.mp4');
  const lutPath = join(LUTS_DIR, `${lut}.cube`);
  try {
    ffmpegGradeLocal(activePovPath, gradedPovPath, lutPath);
    console.log(`  POV graded: ${gradedPovPath}`);
  } catch (e) {
    console.error(`  Grade failed: ${e.message?.slice(0, 200)}`);
    writeFileSync(gradedPovPath, readFileSync(activePovPath));
  }

  let gradedDeskPath = null;
  if (deskPath) {
    gradedDeskPath = join(workDir, 'desk_graded.mp4');
    try {
      ffmpegGradeLocal(deskPath, gradedDeskPath, lutPath);
      console.log(`  Desk graded: ${gradedDeskPath}`);
    } catch {
      gradedDeskPath = deskPath;
    }
  }

  // ── Step 4: Cutaway stitch (POV + desk cam) ───────────────────────────
  console.log('\n  Step 4: Stitching body...');
  const stitchedPath = join(workDir, 'body_stitched.mp4');
  ffmpegCutawayStitch({
    povPath: gradedPovPath,
    deskPath: gradedDeskPath,
    chapters: metadata.chapters,
    outputPath: stitchedPath,
  });
  console.log(`  Body: ${stitchedPath}`);

  // ── Step 5: ElevenLabs voice anchor ──────────────────────────────────
  let hasIntro = false, hasOutro = false;
  const introVideoPath = join(workDir, 'intro_video.mp4');
  const outroVideoPath = join(workDir, 'outro_video.mp4');

  if (voiceId && !opts.noVoice) {
    console.log('\n  Step 5: Generating intro + outro voice anchor (ElevenLabs)...');
    const introText = opts.introText || `${metadata.title}. Let's see what happens.`;
    const outroText = opts.outroText || `Thanks for watching. Follow for the next session. Hit the bell for the next live drop.`;
    const introAudioPath = join(workDir, 'intro_audio.mp3');
    const outroAudioPath = join(workDir, 'outro_audio.mp3');
    try {
      await elevenLabsTTS(introText, voiceId, introAudioPath);
      console.log(`  Intro VO: ${introAudioPath}`);
      ffmpegTitleCardFromAudio(introAudioPath, introVideoPath, sessionLabel, povDims);
      hasIntro = true;
    } catch (e) { console.log(`  Intro failed: ${e.message?.slice(0, 150)}`); }
    try {
      await elevenLabsTTS(outroText, voiceId, outroAudioPath);
      console.log(`  Outro VO: ${outroAudioPath}`);
      ffmpegTitleCardFromAudio(outroAudioPath, outroVideoPath, 'follow for next episode', povDims);
      hasOutro = true;
    } catch (e) { console.log(`  Outro failed: ${e.message?.slice(0, 150)}`); }
  } else {
    console.log('\n  Step 5: Skipping voice anchor (no voice-id or --no-voice).');
  }

  // ── Step 6: Assemble final = intro + body + outro ─────────────────────
  console.log('\n  Step 6: Assembling final video...');
  const finalPath = join(workDir, `${sessionLabel}_final.mp4`);
  const assembleList = [
    ...(hasIntro ? [introVideoPath] : []),
    stitchedPath,
    ...(hasOutro ? [outroVideoPath] : []),
  ];
  try {
    ffmpegConcatVideos(assembleList, finalPath, povDims);
    console.log(`  Final: ${finalPath}`);
  } catch (e) {
    console.error(`  Concat failed: ${e.message?.slice(0, 200)}`);
    writeFileSync(finalPath, readFileSync(stitchedPath));
  }

  // ── Step 7: Extract vertical clips ────────────────────────────────────
  const clipsDir = join(workDir, 'clips');
  mkdirSync(clipsDir, { recursive: true });
  const clipPaths = [];

  if (metadata.vertical_clips?.length > 0 && !opts.skipClips) {
    console.log(`\n  Step 7: Extracting ${metadata.vertical_clips.length} vertical clips...`);
    for (let i = 0; i < metadata.vertical_clips.length; i++) {
      const clip = metadata.vertical_clips[i];
      const clipPath = join(clipsDir, `clip_${i + 1}_pillar_${clip.pillar}.mp4`);
      try {
        ffmpegExtractVerticalClip(gradedPovPath, clip.start_sec, clip.duration_sec, clipPath);
        clipPaths.push({ path: clipPath, hook: clip.hook, pillar: clip.pillar });
        console.log(`    Clip ${i + 1} (Pillar ${clip.pillar}): ${clip.hook}`);
      } catch (e) {
        console.log(`    Clip ${i + 1} failed: ${e.message?.slice(0, 100)}`);
      }
    }
  } else {
    console.log('\n  Step 7: Skipping vertical clip extraction.');
  }

  // ── Step 8: Upload to Drive ───────────────────────────────────────────
  console.log('\n  Step 8: Uploading to Drive /Short form OUT/...');
  let finalDriveId = null;
  try {
    const r = driveUpload(finalPath, DRIVE_FOLDERS.shortformOut, `${sessionLabel}_longform.mp4`);
    finalDriveId = r.id;
    console.log(`  Longform: ${r.name} (${r.id})`);
  } catch (e) { console.log(`  Final upload failed: ${e.message?.slice(0, 200)}`); }

  const clipDriveIds = [];
  for (const c of clipPaths) {
    try {
      const name = `${sessionLabel}_${basename(c.path)}`;
      const r = driveUpload(c.path, DRIVE_FOLDERS.shortformOut, name);
      clipDriveIds.push({ pillar: c.pillar, hook: c.hook, driveId: r.id, name });
      console.log(`  Clip: ${name} (${r.id})`);
    } catch (e) { console.log(`  Clip upload failed: ${e.message?.slice(0, 100)}`); }
  }

  try {
    const r = driveUpload(metadataPath, DRIVE_FOLDERS.shortformOut, `${sessionLabel}_metadata.json`);
    console.log(`  Metadata: ${r.name} (${r.id})`);
  } catch {}

  console.log(`\n  ─── LONGFORM COMPLETE ───`);
  console.log(`  Title: ${metadata.title}`);
  console.log(`  Chapters: ${(metadata.chapters || []).length}`);
  console.log(`  Vertical clips uploaded: ${clipDriveIds.length}`);
  if (silenceReport) {
    console.log(`  Silence cut: removed ${silenceReport.removals.length} regions (${silenceReport.removedSec.toFixed(1)}s)`);
  }
  console.log(`  Metadata bundle: ${metadataPath}`);
  console.log(`  Final Drive ID: ${finalDriveId}\n`);

  return { status: 'complete', finalPath, metadata, clips: clipDriveIds, workDir, silenceReport };
}


// ═══════════════════════════════════════════════════════════════════════════
// CLI Entry Point
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// MODE 3: GAMI — Generate a single 16-GAMI image from plain English
// ═══════════════════════════════════════════════════════════════════════════

const GAMI_ART_STYLE = 'High-resolution product photograph of a physical, multi-layered cut paper and origami sculpture. Stair-stepped pixelated aesthetic merged with traditional origami folds. Multi-layered 3D cardstock construction. Soft directional lighting creating distinct drop shadows between physical paper layers. Hyper-realistic tangible texture contrasted with digital abstraction. 16-bit jagged physics reinforced by fold geometry.';

function buildGamiPrompt(text) {
  return `${GAMI_ART_STYLE}\n\nThe sculpture depicts a scene inspired by this narrative:\n"${text}"\n\nTranslate the emotional core of this narrative into a single origami diorama. Use folded paper characters, layered cardstock environments, and pixel-grid textures to convey the mood. Angled macro-level perspective with shallow depth of field emphasizing paper textures and cardstock grain.`;
}

async function gamiGenerate(description, opts = {}) {
  const resolution = opts.resolution || '2K';
  const aspectRatio = opts.aspectRatio || '1:1';
  const kieKey = opts.kieKey || process.env.KIE_API_KEY;

  if (!kieKey) { console.error('Error: KIE_API_KEY not set'); process.exit(1); }

  console.log(`\n  16-GAMI: "${description}"`);
  console.log(`  Resolution: ${resolution} | Aspect: ${aspectRatio}\n`);

  const prompt = buildGamiPrompt(description);

  // Submit to kie.ai
  console.log('  Submitting to Nano Banana Pro...');
  const taskId = await createKieTask({
    server: SERVER, kieKey, model: 'nano-banana-pro',
    input: { prompt, aspect_ratio: aspectRatio, resolution, output_format: 'png' },
  });
  console.log(`  Task: ${taskId}`);

  const { url, elapsed } = await pollKieTask({
    server: SERVER, kieKey, taskId,
    onTick: ({ elapsed: s }) => process.stdout.write(`  Generating... (${s}s)\r`),
  });
  console.log(`  Done in ${elapsed}s`);
  console.log(`\n  Image URL: ${url}\n`);
  // Copy to clipboard if available
  try {
    execSync(`echo ${url} | clip`, { stdio: 'pipe' });
    console.log('  (URL copied to clipboard)');
  } catch { /* clipboard unavailable — URL already printed */ }
  return { url, elapsed };
}


// ── B-Roll: full-frame motion-graphic inserts spliced into a talking-head ──
//
// Two-step flow:
//   1) Suggest — transcribe video, ask Claude to pick 2-3 cuts from the
//      catalog at pipeline/broll-catalog.json, write the plan
//      to a JSON file for review.
//   2) Render — POST plan to server, server renders comps from
//      external\remotion via Remotion CLI and FFmpeg-splices them in.
//
// Default flow writes the plan and exits. Pass --auto to skip review and
// render immediately; pass --plan <file> to skip suggest and render an
// existing plan; pass --transcript <file> to skip transcription.

async function brollPipeline(videoPath, opts = {}) {
  if (!existsSync(videoPath)) {
    console.error(`  Video not found: ${videoPath}`);
    process.exit(1);
  }
  const absVideo = videoPath.startsWith('/') || /^[A-Z]:/i.test(videoPath)
    ? videoPath
    : join(process.cwd(), videoPath);

  const runDir = join(import.meta.dirname, 'renders', 'broll', `cli_${timestamp()}`);
  mkdirSync(runDir, { recursive: true });
  const planPath = opts.plan || join(runDir, 'broll-plan.json');

  let plan;
  if (opts.plan && existsSync(opts.plan)) {
    console.log(`  Loading plan from ${opts.plan}`);
    plan = JSON.parse(readFileSync(opts.plan, 'utf8'));
  } else {
    // ── Step 1: get transcript text
    let transcriptText = '';
    if (opts.transcript && existsSync(opts.transcript)) {
      console.log(`  Loading transcript from ${opts.transcript}`);
      const raw = readFileSync(opts.transcript, 'utf8');
      try {
        const j = JSON.parse(raw);
        transcriptText = j.text || (j.words || []).map(w => w.text || w.word || '').join(' ');
      } catch {
        transcriptText = raw;
      }
    } else {
      console.log('  Step 1: Transcribing video...');
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      const transcribeScript = join(homeDir, '.claude', 'skills', 'video-use', 'helpers', 'transcribe.py');
      if (!existsSync(transcribeScript)) {
        console.error(`  Missing ${transcribeScript} — install the video-use skill or pass --transcript`);
        process.exit(1);
      }
      const editDir = join(runDir, 'edit');
      mkdirSync(editDir, { recursive: true });
      execSync(`python "${transcribeScript}" "${absVideo}" --edit-dir "${editDir}" --language en --num-speakers 1`,
        { encoding: 'utf8', timeout: 1200000 });
      const tdir = join(editDir, 'transcripts');
      const files = existsSync(tdir) ? readdirSync(tdir).filter(f => f.endsWith('.json')) : [];
      if (!files.length) { console.error('  Transcription produced no JSON.'); process.exit(1); }
      const tjson = JSON.parse(readFileSync(join(tdir, files[files.length - 1]), 'utf8'));
      transcriptText = tjson.text || (tjson.words || []).map(w => w.text || w.word || '').join(' ');
      console.log(`  Transcript: ${transcriptText.split(/\s+/).length} words`);
    }

    // ── Step 2: video duration via ffprobe
    let durationSec = 0;
    try {
      const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${absVideo}"`,
        { encoding: 'utf8' }).trim();
      durationSec = parseFloat(out);
    } catch {}

    // ── Step 3: suggest plan
    console.log('  Step 2: Asking Claude for B-roll cuts...');
    const suggestRes = await fetch('http://localhost:3001/api/broll/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: transcriptText, videoDurationSec: durationSec, maxCuts: opts.maxCuts || 3 }),
    });
    const suggestData = await suggestRes.json();
    if (!suggestRes.ok) {
      console.error(`  Suggest failed: ${suggestData.error || suggestRes.status}`);
      if (suggestData.raw) console.error(`  Raw:\n${suggestData.raw.slice(0, 500)}`);
      process.exit(1);
    }
    plan = suggestData.plan;
    writeFileSync(planPath, JSON.stringify(plan, null, 2));
    console.log(`  Plan (${plan.cuts?.length || 0} cuts) → ${planPath}`);
    for (const cut of plan.cuts || []) {
      console.log(`    @${cut.atSec.toFixed(1)}s ${cut.durationSec.toFixed(1)}s — ${cut.compId}`);
      console.log(`       ${cut.reason}`);
    }

    if (!opts.auto) {
      console.log('\n  Review the plan, edit if needed, then re-run with:');
      console.log(`    node shortform-cli.js broll "${absVideo}" --plan "${planPath}"`);
      return;
    }
  }

  // ── Step 4: render + splice
  // 4K + 8 cuts + x264 re-encode can take 20+ minutes; default fetch
  // timeout aborts long before that. Use an AbortController to allow
  // up to 60 minutes of patience.
  console.log('\n  Step 3: Rendering B-roll comps + splicing... (this can take a while; 4K + 15+ min videos may be 20+ min)');
  const ac = new AbortController();
  const timeoutHandle = setTimeout(() => ac.abort(new Error('client timeout 60min')), 60 * 60 * 1000);
  let renderRes;
  try {
    renderRes = await fetch('http://localhost:3001/api/broll/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoPath: absVideo, plan, name: `cli_${timestamp()}` }),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
  const renderData = await renderRes.json();
  if (!renderRes.ok) {
    console.error(`  Render failed: ${renderData.error || renderRes.status}`);
    process.exit(1);
  }
  console.log(`\n  ✓ Final: http://localhost:3001${renderData.url}`);
  console.log(`    Cuts spliced: ${renderData.cuts.length}`);
}


const HELP = `
Breadstick Shortform CLI — Quick Take Pipeline

Commands:
  quicktake <topic>     Generate teleprompter script or beats cue card + upload to Drive
  process               Check /Short form IN/ for video, edit + grade + upload (shortform)
  broll <video>         Suggest + render full-frame B-roll cuts spliced into video
  longform              Full YouTube pipeline: POV + optional desk cam → graded + clips + metadata
  gami <description>    Generate a single 16-GAMI image from plain English

Quicktake options:
  --format <fmt>        teleprompter | beats (default: teleprompter)
                        teleprompter = full script to read on-camera
                        beats = keyword cue card for POV/glasses recording (don't read — glance)
  --bullets <n>         Number of bullets or beats (default: 5)
  --duration <sec>      Target speaking duration in seconds (default: 45 teleprompter / 60 beats)
  --style <style>       confident | conversational | urgent | analytical | pov (default: confident)
                        pov = Ray-Ban Meta glasses voice, mid-thought openers, save-coded
  --pillar <A|B|C|D>    Only meaningful with --style pov. Tunes opener + intent per pillar:
                        A = Workflow moment (replicable takeaway)
                        B = Research reveal (research findings, authority)
                        C = Hot take / comparison (pattern-interrupt — THE proven winner)
                        D = Breadstick in action (canvas/pipeline demo, no pitch)

Process options:
  --lut <name>          LUT filename without .cube extension (default: "default")
                        Place .cube files in pipeline/luts/
  --no-grade            Skip color grading entirely (use when not shot in Log)
  --overlay <name>      Overlay style. One of:
                        skyframe-5beat (default) — Claude-driven 5-beat Skyframe
                                                   (RayBanIntro / KaraokeCard /
                                                    CompactCard / Win95Terminal /
                                                    OpusGlisten). Falls back to
                                                    gami-banner on failure.
                        skyframe-code            — code/data-themed sibling pack
                                                   (RayBanIntro / ASCII-wave /
                                                    AppleGlassTile / HandLabel /
                                                    OpusGlisten).
                        skyframe-pov             — POV-only pack for Ray-Ban
                                                   recordings of hands (no body
                                                   subject in frame): RayBanIntro
                                                   / Win95Terminal / AppleGlassTile
                                                   / HandLabel (POV-sized) /
                                                   OpusGlisten.
                        gami-banner              — 16-GAMI key-terms banners
                                                   (parked but selectable)
                        none                     — same as --no-overlay
  --no-overlay          Skip overlay entirely (deliver graded mp4 only)
  --watch               Keep polling every 2 minutes (for cron-free usage)

Longform options:
  --pov <path|driveId>  Ray-Ban Meta POV recording (required). Local path OR Drive file ID.
  --desk <path|driveId> Optional side-profile desk cam (for cutaway B-roll).
  --session <label>     Session label (e.g. "session_52"). Defaults to timestamp.
  --topic <label>       Topic hint passed to Claude metadata (default: "dev session").
  --voice-id <id>       ElevenLabs voice ID for branded intro/outro.
                        Or set ELEVENLABS_VOICE_ID env var.
  --intro-text <text>   Override the default intro VO text.
  --outro-text <text>   Override the default outro VO text.
  --lut <name>          LUT to use for grade (default: "default").
  --no-voice            Skip voice anchor (intro/outro) entirely.
  --skip-clips          Skip vertical clip extraction.
  --silence-cut         Context-aware silence removal before metadata.
                        Detects regions >=2s, Claude decides which are dead
                        air vs intentional pause. Caps at 20% of duration.
  --skip-ship-gate      Bypass the non-LLM ship gate (not recommended).
                        Gate blocks publishing if metadata fails structural
                        validation or contains injection signatures.

Broll options:
  --auto                Skip plan review, render immediately after suggest
  --plan <file>         Use existing plan JSON; skips suggest + transcribe
  --transcript <file>   Use existing transcript instead of re-running ElevenLabs
  --max-cuts <n>        Max number of cuts (default: 3)

Default broll flow writes a plan file and exits — review it, then re-run with
--plan to render. Pass --auto for one-shot.

Audit (dry-run the ship gate against an existing metadata.json):
  node shortform-cli.js audit <metadata.json> [--duration <seconds>]

Gami options:
  --resolution <res>    1K | 2K | 4K (default: 2K)
  --aspect-ratio <ar>   1:1 | 9:16 | 16:9 (default: 1:1)
  --kie-key <key>       kie.ai API key (or KIE_API_KEY env)

Examples:
  node shortform-cli.js quicktake "Prompt Injection"
  node shortform-cli.js quicktake "Zero Trust" --bullets 7 --duration 60 --style urgent
  node shortform-cli.js quicktake "Claude Code rate limits" --format beats
  node shortform-cli.js quicktake "Agent handoffs" --format beats --bullets 6
  node shortform-cli.js quicktake "never hit rate limits" --format beats --style pov --pillar C
  node shortform-cli.js quicktake "benchmark session 51 result" --format beats --style pov --pillar B
  node shortform-cli.js quicktake "my Claude Code loop" --format beats --style pov --pillar A
  node shortform-cli.js process
  node shortform-cli.js process --lut cinematic --watch
  node shortform-cli.js gami "a dragon guarding a server room"
  node shortform-cli.js gami "hackers breaching a firewall" --resolution 4K --aspect-ratio 16:9
  node shortform-cli.js longform --pov ./raw_pov.mp4 --desk ./raw_desk.mp4 --session session_52
  node shortform-cli.js longform --pov DRIVE_FILE_ID --topic "prompt-injection resilience"

Environment:
  ANTHROPIC_API_KEY     For script generation + metadata
  ELEVENLABS_API_KEY    For transcription + voice anchor TTS
  ELEVENLABS_VOICE_ID   Default voice for longform intro/outro (or pass --voice-id)
`.trim();

// ─── Recipe subcommand ────────────────────────────────────────────────────
// `node shortform-cli.js recipe --recipe cybersec-truth-bomb --video <path>`
//
// One command, end-to-end: looks up the recipe, asks Claude to map the
// transcript to the recipe's beat anchors, renders the parametric composition
// with --props, composites with LUT #20 + gblur + audio mix, uploads to Drive.
//
// MVP scope: only --recipe cybersec-truth-bomb supported. The other 3 recipes
// extend cleanly once we refactor their compositions to be prop-driven too.

const CYBERSEC_BEAT_MAPPER_SYSTEM = `You are the Cybersec Truth Bomb recipe beat-mapper for Skyframe shortform videos. Given a transcript of a Ray-Ban POV recording, return a JSON object mapping each beat's anchor words + windows.

Output ONLY valid JSON — no markdown fences, no commentary, no prose.

Required shape:
{
  "beats": {
    "hook":    { "startSec": 0, "endSec": 2.0, "topWord": "You're", "heroPhrase": "<2-3 word HOOK PHRASE>", "midWord": "with", "pixelPhrase": "<1-3 word PIXEL PHRASE>", "subtitle": "<short subtitle phrase>" },
    "threat":  { "startSec": <number>, "endSec": <number>, "position": "bottom-left",  "eyebrow": "<2-3 word eyebrow>", "words": ["<karaoke word>", ...], "heroWord": "<one of the words>" },
    "bullets": { "startSec": <number>, "endSec": <number>, "position": "bottom-right", "eyebrow": "<2-3 word eyebrow>", "words": [...],                    "heroWord": "..." },
    "pivot":   { "startSec": <number>, "endSec": <number>, "command": "/audit",  "payoff": "<the truth-bomb sentence verbatim>" },
    "tail":    { "startSec": <number>, "endSec": <number> },
    "cta":     { "startSec": <number>, "endSec": <number>, "word": "<single CTA word, uppercase, 4-8 chars>", "fontSize": 194, "caretHeight": 146 }
  },
  "audioCues": {
    "bubbles":  [<frame indices @ 30fps — one per beat entry: 0, threat_start*30, bullets_start*30, pivot_start*30>],
    "whooshes": [],
    "chime":    <cta_startSec * 30 + 64>
  }
}

CONSTRAINTS (non-negotiable):
- hook is ALWAYS startSec=0, endSec=2.0
- pivot endSec >= pivot startSec + 3.0 (typing + 1s linger)
- cta endSec = cta startSec + 3.0 (OpusGlisten minimum)
- pivot.payoff must contain a security primitive (attack surface, blast radius, trust boundary, kill chain, lateral move) — pull it verbatim from the spoken transcript
- cta.word should be the LAST replay-worthy word of the script (typically the final spoken word), uppercased
- threat.words and bullets.words are each 4-7 short words from the script, karaoke-revealed
- All start/endSec must align with spoken-word boundaries — read the transcript carefully
- whooshes is ALWAYS [] for cybersec (locked doctrine)`;

function buildCybersecMapperUserPrompt(transcript, durationSec) {
  const text = transcript.text || '';
  const words = (transcript.words || []).filter(w => !w?.type || w.type === 'word');
  const wordList = words.map(w => `${(w.text || w.word || '').trim()} [${(w.start ?? w.start_time ?? 0).toFixed(2)}s-${(w.end ?? w.end_time ?? 0).toFixed(2)}s]`).join('\n');
  return `Video duration: ${durationSec.toFixed(2)}s @ 30fps (${Math.round(durationSec * 30)} frames)

TRANSCRIPT (plain):
"${text}"

WORD TIMINGS:
${wordList}

Map each beat to the right anchor moment and return the JSON object now.`;
}

async function recipeRender(opts) {
  const SUPPORTED_RECIPES = ['cybersec-truth-bomb'];
  if (!SUPPORTED_RECIPES.includes(opts.recipe)) {
    console.error(`Recipe "${opts.recipe}" not yet supported by CLI. Supported: ${SUPPORTED_RECIPES.join(', ')}.`);
    process.exit(1);
  }

  const videoPath = opts.video;
  if (!existsSync(videoPath)) {
    console.error(`Video not found: ${videoPath}`);
    process.exit(1);
  }

  // Resolve transcript path — default to testing-vids/edit/transcripts/<basename>.json
  const videoBase = videoPath.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '');
  const transcriptPath = opts.transcript
    || join(import.meta.dirname, 'testing-vids', 'edit', 'transcripts', `${videoBase}.json`);
  if (!existsSync(transcriptPath)) {
    console.error(`Transcript not found: ${transcriptPath}\nPass --transcript <path> or transcribe the video first.`);
    process.exit(1);
  }

  console.log(`  Recipe:     ${opts.recipe}`);
  console.log(`  Video:      ${videoPath}`);
  console.log(`  Transcript: ${transcriptPath}`);

  const transcript = JSON.parse(readFileSync(transcriptPath, 'utf8'));
  // Full ffprobe — width/height/duration in one call (ffprobeDimensions only
  // returns w/h; we need duration to compute totalFrames for the render).
  const probeOut = execSync(
    `ffprobe -v error -show_entries stream=width,height,duration -select_streams v:0 -of json "${videoPath}"`,
    { encoding: 'utf8', timeout: 15000 }
  );
  const probeStream = JSON.parse(probeOut).streams?.[0] || {};
  const width = probeStream.width;
  const height = probeStream.height;
  const durationSec = Number(probeStream.duration) || 0;
  const fps = 30;
  const totalFrames = Math.max(60, Math.round(durationSec * fps));

  console.log(`  Source:     ${width}x${height} @ ${fps}fps, ${durationSec.toFixed(2)}s (${totalFrames} frames)`);

  // ── Step 1: Claude beat mapping ─────────────────────────────────────────
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY required for recipe beat mapping.');
    process.exit(1);
  }
  console.log('\n  Step 1: Asking Claude to map transcript → recipe beats...');
  const planRaw = await anthropic(CYBERSEC_BEAT_MAPPER_SYSTEM, buildCybersecMapperUserPrompt(transcript, durationSec));
  const cleaned = planRaw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let props;
  try {
    props = JSON.parse(cleaned);
  } catch {
    console.error(`  Claude returned unparseable JSON.\nFirst 500: ${cleaned.slice(0, 500)}`);
    process.exit(1);
  }
  props.durationInFrames = totalFrames;
  console.log(`  Beats mapped. hook="${props.beats?.hook?.heroPhrase}"  cta="${props.beats?.cta?.word}"  chime@${props.audioCues?.chime}`);

  // ── Step 2: Remotion render with props ─────────────────────────────────
  const tmpDir = join(import.meta.dirname, '.tmp');
  if (!existsSync(tmpDir)) { mkdirSync(tmpDir, { recursive: true }); }
  const propsPath = join(tmpDir, `recipe_props_${timestamp()}.json`);
  writeFileSync(propsPath, JSON.stringify(props));

  const overlaysDir = join(import.meta.dirname, 'testing-vids', 'edit', 'overlays');
  if (!existsSync(overlaysDir)) { mkdirSync(overlaysDir, { recursive: true }); }
  const overlayPath = join(overlaysDir, `${videoBase}_recipe_${opts.recipe}_${timestamp()}.webm`);

  console.log('\n  Step 2: Rendering Remotion overlay (VP9 + alpha)...');
  execSync(
    `npx remotion render src/remotion/index.jsx PracticeOverlay010 "${overlayPath}" --codec=vp9 --pixel-format=yuva420p --image-format=png --props "${propsPath}" --frames=0-${totalFrames - 1}`,
    { encoding: 'utf8', timeout: 900000, cwd: import.meta.dirname, stdio: 'inherit' }
  );

  // ── Step 3: ffmpeg composite ───────────────────────────────────────────
  const lutSanitized = join(tmpDir, 'lut20.cube');
  if (!existsSync(lutSanitized)) {
    const sourceLut = join(LUTS_DIR, 'default.cube');
    if (existsSync(sourceLut)) {
      writeFileSync(lutSanitized, readFileSync(sourceLut));
    } else {
      console.error(`LUT not found: ${sourceLut}`);
      process.exit(1);
    }
  }
  const editDir = join(import.meta.dirname, 'testing-vids', 'edit');
  if (!existsSync(editDir)) { mkdirSync(editDir, { recursive: true }); }
  const outputPath = join(editDir, `${videoBase}_${opts.recipe}_${timestamp()}.mp4`);

  console.log('\n  Step 3: Compositing overlay onto base (single ffmpeg pass)...');
  // ffmpeg's filtergraph parser splits on `:`, so Windows drive-letter paths
  // (E:/...) inside `lut3d=...` are mis-parsed. Run ffmpeg with cwd at the
  // project root and reference the LUT by relative path — same pattern the
  // existing process_video grade step uses (line ~900).
  const filterComplex = `[0:v]scale=1080:1920,lut3d=.tmp/lut20.cube,gblur=sigma=22:enable='between(t,0,2)'[base];[base][1:v]overlay=0:0:eof_action=pass[out];[0:a]volume=1.0[a0];[1:a]volume=0.8[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]`;
  execSync(
    `ffmpeg -y -i "${videoPath}" -c:v libvpx-vp9 -i "${overlayPath}" -filter_complex "${filterComplex}" -map "[out]" -map "[aout]" -c:v libx264 -preset fast -crf 18 -c:a aac -b:a 256k -ac 2 -movflags +faststart "${outputPath}"`,
    { encoding: 'utf8', timeout: 600000, cwd: import.meta.dirname, stdio: 'inherit' }
  );
  console.log(`  Composited: ${outputPath}`);

  // ── Step 4: Decode check ───────────────────────────────────────────────
  console.log('\n  Step 4: Decode check...');
  try {
    execSync(`ffmpeg -v error -i "${outputPath}" -f null -`, { encoding: 'utf8', timeout: 120000 });
    console.log('  Decode: clean.');
  } catch {
    console.error('  Decode check FAILED — output may be corrupt.');
  }

  // ── Step 5: Drive upload ───────────────────────────────────────────────
  if (!opts.noUpload) {
    console.log('\n  Step 5: Uploading to Drive...');
    try {
      const uploaded = driveUpload(outputPath, null);
      const driveUrl = `https://drive.google.com/file/d/${uploaded.id}/view`;
      console.log(`\n  ✓ Drive link: ${driveUrl}`);
    } catch (e) {
      console.error(`  Drive upload failed: ${e.message}`);
      console.log(`  Local output is at: ${outputPath}`);
    }
  } else {
    console.log(`\n  ✓ Local output: ${outputPath}`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(HELP);
    process.exit(0);
  }

  const command = args[0];

  if (command === 'quicktake') {
    const topic = args[1];
    if (!topic || topic.startsWith('--')) {
      console.error('Error: quicktake requires a topic.\nUsage: node shortform-cli.js quicktake "topic"');
      process.exit(1);
    }

    const opts = {};
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--bullets' || args[i] === '--beats') { opts.bullets = parseInt(args[++i]); }
      else if (args[i] === '--duration') { opts.duration = parseInt(args[++i]); }
      else if (args[i] === '--style') { opts.style = args[++i]; }
      else if (args[i] === '--format') { opts.format = args[++i]; }
      else if (args[i] === '--pillar') { opts.pillar = String(args[++i]).toUpperCase(); }
    }
    if (opts.pillar && !['A', 'B', 'C', 'D'].includes(opts.pillar)) {
      console.error(`Error: --pillar must be A, B, C, or D (got "${opts.pillar}"). See --help.`);
      process.exit(1);
    }

    await quicktake(topic, opts);
  }
  else if (command === 'gami') {
    const description = args[1];
    if (!description || description.startsWith('--')) {
      console.error('Error: gami requires a description.\nUsage: node shortform-cli.js gami "description"');
      process.exit(1);
    }

    const opts = {};
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--resolution') { opts.resolution = args[++i]; }
      else if (args[i] === '--aspect-ratio') { opts.aspectRatio = args[++i]; }
      else if (args[i] === '--kie-key') { opts.kieKey = args[++i]; }
    }

    await gamiGenerate(description, opts);
  }
  else if (command === 'process') {
    const opts = {};
    let watch = false;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--lut') { opts.lut = args[++i]; }
      else if (args[i] === '--no-grade') { opts.noGrade = true; }
      else if (args[i] === '--no-overlay') { opts.noOverlay = true; }
      else if (args[i] === '--overlay') { opts.overlay = args[++i]; }
      else if (args[i] === '--watch') { watch = true; }
    }
    if (opts.overlay && !['gami-banner', 'skyframe-5beat', 'skyframe-code', 'skyframe-pov', 'none'].includes(opts.overlay)) {
      console.error(`Error: --overlay must be one of: gami-banner, skyframe-5beat, skyframe-code, skyframe-pov, none. Got: ${opts.overlay}`);
      process.exit(1);
    }

    if (watch) {
      console.log('  Watch mode: polling /Short form IN/ every 2 minutes. Ctrl+C to stop.\n');
      while (true) {
        try {
          await process_video(opts);
        } catch (e) {
          // A hard-fail (e.g. a skyframe render flake that survived its retry)
          // must not kill the polling daemon — log it and keep watching.
          console.error(`\n  Process error: ${e.message}\n  Continuing watch loop.`);
        }
        await new Promise(r => setTimeout(r, 120000));
      }
    } else {
      await process_video(opts);
    }
  }
  else if (command === 'longform') {
    const opts = {};
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--pov') { opts.pov = args[++i]; }
      else if (args[i] === '--desk') { opts.desk = args[++i]; }
      else if (args[i] === '--session') { opts.session = args[++i]; }
      else if (args[i] === '--topic') { opts.topic = args[++i]; }
      else if (args[i] === '--voice-id') { opts.voiceId = args[++i]; }
      else if (args[i] === '--intro-text') { opts.introText = args[++i]; }
      else if (args[i] === '--outro-text') { opts.outroText = args[++i]; }
      else if (args[i] === '--lut') { opts.lut = args[++i]; }
      else if (args[i] === '--no-voice') { opts.noVoice = true; }
      else if (args[i] === '--skip-clips') { opts.skipClips = true; }
      else if (args[i] === '--silence-cut') { opts.silenceCut = true; }
      else if (args[i] === '--skip-ship-gate') { opts.skipShipGate = true; }
    }
    if (!opts.pov) {
      console.error('Error: longform requires --pov <path-or-driveId>.\nSee --help for full options.');
      process.exit(1);
    }
    await longform(opts);
  }
  else if (command === 'broll') {
    const video = args[1];
    if (!video || video.startsWith('--')) {
      console.error('Error: broll requires a video path.\nUsage: node shortform-cli.js broll <video.mp4> [--auto] [--plan <file>] [--transcript <file>]');
      process.exit(1);
    }
    const opts = {};
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--auto') opts.auto = true;
      else if (args[i] === '--plan') opts.plan = args[++i];
      else if (args[i] === '--transcript') opts.transcript = args[++i];
      else if (args[i] === '--max-cuts') opts.maxCuts = parseInt(args[++i]);
    }
    await brollPipeline(video, opts);
  }
  else if (command === 'recipe') {
    const opts = {};
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--recipe') opts.recipe = args[++i];
      else if (args[i] === '--video') opts.video = args[++i];
      else if (args[i] === '--transcript') opts.transcript = args[++i];
      else if (args[i] === '--no-upload') opts.noUpload = true;
    }
    if (!opts.recipe || !opts.video) {
      console.error('Error: recipe requires --recipe <id> --video <path>.\nExample: node shortform-cli.js recipe --recipe cybersec-truth-bomb --video testing-vids/cartesiantest001.mp4');
      process.exit(1);
    }
    await recipeRender(opts);
  }
  else if (command === 'audit') {
    const metadataPath = args[1];
    if (!metadataPath || !existsSync(metadataPath)) {
      console.error(`Error: audit requires a metadata.json path.\nUsage: node shortform-cli.js audit <metadata.json> [--duration <seconds>]`);
      process.exit(1);
    }
    let duration = 0;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--duration') duration = parseFloat(args[++i]) || 0;
    }
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    const gate = longformShipGate(metadata, duration);
    console.log(`\n  SHIP GATE AUDIT: ${metadataPath}`);
    console.log(`  Verdict: ${gate.verdict}  |  taint=${gate.taintScore.toFixed(2)}`);
    console.log(`  Warnings: ${gate.warnings.length}  |  Violations: ${gate.violations.length}  |  Reasons: ${gate.reasons.length}\n`);
    for (const r of gate.reasons) console.log(`    REJECT: ${r}`);
    for (const w of gate.warnings) console.log(`    WARN:   ${w}`);
    for (const v of gate.violations) console.log(`    TAINT [${v.type}] ${v.field}: "${v.match}"  (weight ${v.weight})`);
    console.log();
    process.exit(gate.verdict === 'SHIP' ? 0 : 2);
  }
  else {
    console.error(`Unknown command: ${command}\n`);
    console.log(HELP);
    process.exit(1);
  }
}

main().catch(e => {
  console.error(`\nFatal: ${e.message}`);
  process.exit(1);
});

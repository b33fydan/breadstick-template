/**
 * shipGate — deterministic validator for LLM output safety.
 *
 * Two entry points:
 *   scanText(str)                   → light injection scan, for bare text
 *   shipGate(metadata, povDurSec)   → full structural + injection validator,
 *                                     same shape as shortform-cli.js longformShipGate
 *
 * Pure function. Browser- and Node-compatible. No LLM in the verdict path —
 * decisions are regex scans and scalar comparisons. Cannot be prompt-injected.
 */

export const INJECTION_PATTERNS = [
  { name: 'INSTRUCTION_INJECTION', weight: 1.0, re: /ignore\s+(all\s+)?previous|system\s*:|do\s+not\s+flag|override\s+previous|new\s+instructions?/i },
  { name: 'ROLE_BLEEDTHROUGH',     weight: 0.9, re: /^(you|assistant|system|user)\s*:/im },
  { name: 'TOOL_USE_BLEED',        weight: 1.0, re: /<function_calls?>|<tool_use>|<|<\/antml:/i },
  { name: 'STRUCTURAL_BREAK',      weight: 0.6, re: /```|\n{5,}/ },
  { name: 'AUTHORITY_CLAIM',       weight: 0.7, re: /\bconfirmed\s+by\b|\bas\s+an?\s+admin\b|\bper\s+policy\b|\bsudo\s+|\broot\s+access\b/i },
];

export const QUARANTINE_THRESHOLD = 0.8;

export function scanInjection(str, field, violations) {
  if (typeof str !== 'string') return;
  for (const p of INJECTION_PATTERNS) {
    const m = str.match(p.re);
    if (m) violations.push({ type: p.name, field, match: m[0].slice(0, 100), weight: p.weight });
  }
}

// Light-weight text scan. Returns a verdict for a single string.
export function scanText(text) {
  const violations = [];
  scanInjection(typeof text === 'string' ? text : '', 'text', violations);
  const taintScore = Math.min(1.0, violations.reduce((s, v) => s + v.weight, 0));
  const verdict = taintScore >= QUARANTINE_THRESHOLD ? 'QUARANTINE' : 'SHIP';
  return { verdict, taintScore, violations, warnings: [], reasons: [] };
}

// Inbound build-instruction gate. Distinct from scanText (which guards LLM *output*):
// a build request legitimately contains HTML/JSX (`<h1>`, `<section>`) and code fences,
// so this set drops the bare-"<" and structural-break signals and keeps only the
// markers of an actual prompt-injection attempt against the spawned coding agent.
export const INSTRUCTION_INJECTION_PATTERNS = [
  { name: 'INSTRUCTION_INJECTION', weight: 1.0, re: /ignore\s+(all\s+)?previous|disregard\s+(all\s+)?(prior|previous|above)|forget\s+(everything|all|the\s+above)|system\s*:|do\s+not\s+flag|override\s+previous|new\s+instructions?/i },
  { name: 'ROLE_BLEEDTHROUGH',     weight: 0.9, re: /^(you|assistant|system|user)\s*:/im },
  { name: 'TOOL_USE_BLEED',        weight: 1.0, re: /<function_calls?>|<\/antml:|<invoke\b|<tool_use>|<parameter\b/i },
  { name: 'AUTHORITY_CLAIM',       weight: 0.7, re: /\bconfirmed\s+by\b|\bas\s+an?\s+(admin|root|superuser)\b|\bper\s+policy\b|\bsudo\s+|\broot\s+access\b/i },
];

// Deterministic scan of an untrusted inbound instruction. No LLM in the verdict path.
export function scanInstruction(text) {
  const str = typeof text === 'string' ? text : '';
  const violations = [];
  for (const p of INSTRUCTION_INJECTION_PATTERNS) {
    const m = str.match(p.re);
    if (m) violations.push({ type: p.name, field: 'instruction', match: m[0].slice(0, 100), weight: p.weight });
  }
  const taintScore = Math.min(1.0, violations.reduce((s, v) => s + v.weight, 0));
  const verdict = taintScore >= QUARANTINE_THRESHOLD ? 'QUARANTINE' : 'SHIP';
  return { verdict, taintScore, violations, warnings: [], reasons: [] };
}

// Full validator for longform-style metadata objects (chapters, clips, etc.).
// Matches the shape of longformShipGate in shortform-cli.js — keep them in sync.
export function shipGate(metadata, povDurationSec = 0) {
  const reasons = [];
  const warnings = [];
  const violations = [];
  const m = metadata || {};

  if (typeof m.title !== 'string' || !m.title.trim()) reasons.push('title: missing or not a non-empty string');
  if (typeof m.description !== 'string' || !m.description.trim()) reasons.push('description: missing or not a non-empty string');
  if (!Array.isArray(m.chapters)) reasons.push('chapters: must be an array');
  if (!Array.isArray(m.vertical_clips)) reasons.push('vertical_clips: must be an array');
  if (reasons.length > 0) return { verdict: 'REJECT', reasons, warnings, violations, taintScore: 0 };

  scanInjection(m.title, 'title', violations);
  scanInjection(m.description, 'description', violations);
  if (m.title.length < 15 || m.title.length > 80) warnings.push(`title length ${m.title.length} out of [15,80]`);

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

  if (m.vertical_clips.length < 3 || m.vertical_clips.length > 5) warnings.push(`vertical_clips count ${m.vertical_clips.length} out of [3,5]`);
  for (let i = 0; i < m.vertical_clips.length; i++) {
    const c = m.vertical_clips[i] || {};
    if (typeof c.start_sec !== 'number' || c.start_sec < 0) { reasons.push(`vertical_clips[${i}].start_sec invalid`); continue; }
    if (typeof c.duration_sec !== 'number' || c.duration_sec < 20 || c.duration_sec > 75) reasons.push(`vertical_clips[${i}].duration_sec (${c.duration_sec}) out of [20,75]`);
    if (povDurationSec > 0 && (c.start_sec + (c.duration_sec || 0)) > povDurationSec + 1) reasons.push(`vertical_clips[${i}] end time exceeds video duration`);
    if (typeof c.hook !== 'string' || !c.hook.trim()) reasons.push(`vertical_clips[${i}].hook missing`);
    else scanInjection(c.hook, `vertical_clips[${i}].hook`, violations);
    if (!['A', 'B', 'C', 'D'].includes(c.pillar)) reasons.push(`vertical_clips[${i}].pillar must be A|B|C|D, got "${c.pillar}"`);
  }

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

  const taintScore = Math.min(1.0, violations.reduce((s, v) => s + v.weight, 0));
  if (reasons.length > 0) return { verdict: 'REJECT', reasons, warnings, violations, taintScore };
  if (taintScore >= QUARANTINE_THRESHOLD) {
    return { verdict: 'QUARANTINE', reasons: [`injection signatures detected (taint score ${taintScore.toFixed(2)} >= ${QUARANTINE_THRESHOLD})`], warnings, violations, taintScore };
  }
  return { verdict: 'SHIP', reasons: [], warnings, violations, taintScore };
}

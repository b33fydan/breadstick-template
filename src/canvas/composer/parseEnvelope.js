// src/canvas/composer/parseEnvelope.js
// Parse the Conductor's { reply, spec? } envelope from raw model text.
// Models love to wrap JSON in fences or prose — strip both before parsing.
// Returns { ok: true, reply, spec } or { ok: false, error, raw }.

export function parseEnvelope(rawText) {
  const raw = String(rawText ?? '');
  let text = raw.replace(/\r\n/g, '\n').trim();

  // Strip ```json ... ``` or ``` ... ``` fences (whole-string wrap)
  const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) text = fence[1].trim();

  // If not parseable head-on, try the first balanced {...} block
  let parsed = tryParse(text);
  if (!parsed) {
    const block = firstBalancedBlock(text);
    if (block) parsed = tryParse(block);
  }

  if (!parsed) return { ok: false, error: 'Response was not valid JSON', raw };
  if (typeof parsed.reply !== 'string' || !parsed.reply.trim().length) {
    return { ok: false, error: 'Envelope missing "reply" string', raw };
  }
  return { ok: true, reply: parsed.reply, spec: parsed.spec ?? null };
}

// Forward walk from the first '{', counting depth — string-aware for JSON
// (quotes + escapes) so braces inside string values don't skew the count.
// Returns the balanced {...} slice or null.
function firstBalancedBlock(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function tryParse(s) {
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : null; }
  catch { return null; }
}

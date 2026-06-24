// server/postizMeta.js — tag-at-birth helpers for the Postiz schedule route.
//
// The canvas (or any caller) may attach a `breadstick` sideband object to the
// /api/postiz/schedule body: { lane, angle, ...anything }. It is OURS, not
// Postiz's — strip it before forwarding (Postiz rejects unknown top-level
// keys silently at best) and fold it into the activity-ledger meta together
// with the post ids Postiz returns, so performance can later be attributed
// back to lane + angle. This is the keystone of the Scoreboard loop: without
// tag-at-birth there is no attribution, and without attribution there is no
// A/B verdict.

// Split the inbound body into what Postiz should see and what we keep.
export function extractBreadstickMeta(body = {}) {
  const { breadstick, ...forwardBody } = body;
  const sideband = (breadstick && typeof breadstick === 'object') ? breadstick : {};
  return { forwardBody, sideband };
}

// Postiz /posts responses vary by type (draft vs schedule vs now) and version;
// walk the payload defensively and collect anything that looks like a post id.
export function extractPostIds(data) {
  const ids = [];
  const idOf = (v) => {
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return null;
  };
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    // Postiz answers with `postId` on schedule responses and `id` on post
    // objects — collect both spellings, string or numeric.
    const id = idOf(node.postId) ?? idOf(node.id);
    if (id) ids.push(id);
    // Only recurse into the shapes Postiz actually nests posts under —
    // a full deep-walk would pick up integration ids as "posts".
    if (node.posts) walk(node.posts);
    if (node.post && typeof node.post === 'object') walk(node.post);
    if (node.value && Array.isArray(node.value)) walk(node.value);
  };
  walk(data);
  return [...new Set(ids)];
}

// The meta object that lands in the activity ledger for type:'post' events.
//
// When a 2xx schedule response yields zero ids, the event is marked
// POSTIZ_ID_MISSING and carries the (capped) raw response. Postiz's createPost
// has a `return []` branch that answers success with an empty array even when
// post rows were written (live-fired 2026-06-11T14:00:03Z) — such posts are
// invisible to the perf pull, so the gap must be loud, not silent.
export function buildPostMeta(sideband, forwardBody, postizResponse) {
  const integrations = (forwardBody?.posts || [])
    .map((p) => p?.integration?.id)
    .filter(Boolean);
  const postizPostIds = extractPostIds(postizResponse);
  let forensics = {};
  if (postizPostIds.length === 0) {
    let raw;
    try { raw = JSON.stringify(postizResponse); } catch { raw = String(postizResponse); }
    forensics = {
      note: sideband.note ? `POSTIZ_ID_MISSING — ${sideband.note}` : 'POSTIZ_ID_MISSING',
      rawResponse: (raw ?? 'undefined').slice(0, 2000),
    };
  }
  return {
    lane: sideband.lane || 'untagged',
    angle: sideband.angle || 'untagged',
    postType: forwardBody?.type || 'unknown',
    integrations,
    postizPostIds,
    ...(sideband.note ? { note: sideband.note } : {}),
    ...forensics,
  };
}

// src/studio/studioRender.js — Studio render API client + pure request helpers.
// All URLs are absolute to the Express server (the Vite app runs on a different port).
export const API_BASE = 'http://localhost:3001';

// Client mirror of the server's validateHyperframesRequest. Returns an error
// string or null. lower-third checks `lowerName` (the person name field).
export function validateOverlay(effect, params) {
  switch (effect) {
    case 'hook-caption':
    case 'highlight-sweep':
      if (!params.caption) return 'caption required';
      if (effect === 'highlight-sweep' && !params.targetWord) return 'targetWord required for highlight-sweep';
      return null;
    case 'title-card':
      if (!params.title) return 'title required for title-card';
      return null;
    case 'lower-third':
      if (!params.lowerName) return 'name required for lower-third';
      return null;
    case 'burst-lines':
      return null;
    default:
      return `unknown effect: ${effect}`;
  }
}

// Pure: build the exact POST body. `name` is ALWAYS the operation id (opId).
// lower-third emits the person name as `lowerName`, never as `name`.
export function buildOverlayBody({ effect, params, videoPath, accentColor = '#C9A227', quality = 'standard', name }) {
  const body = { videoUrl: videoPath, name, effect, accentColor, quality };
  switch (effect) {
    case 'title-card':
      return { ...body, title: params.title || '', subtitle: params.subtitle || '' };
    case 'lower-third':
      return { ...body, lowerName: params.lowerName || '', role: params.role || '', side: params.side || 'left' };
    case 'highlight-sweep':
      return { ...body, caption: params.caption || '', targetWord: params.targetWord || '', direction: params.direction || 'ltr', position: params.position || 'bottom' };
    case 'burst-lines': {
      const ts = parseFloat(params.timestamp);
      return { ...body, timestamp: Number.isFinite(ts) ? ts : 0.5, density: params.density || 'medium' };
    }
    case 'hook-caption':
    default:
      return { ...body, caption: params.caption || '', position: params.position || 'bottom' };
  }
}

export async function probeVideo(path) {
  const res = await fetch(`${API_BASE}/api/probe-media?path=${encodeURIComponent(path)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'probe failed');
  return data; // { durationSec, width, height, isImage }
}

export async function renderOverlay(body) {
  const res = await fetch(`${API_BASE}/api/hyperframes/overlay-caption`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'render failed');
  return `${API_BASE}${data.url}`; // e.g. http://localhost:3001/renders/hyperframes/<name>.mp4
}

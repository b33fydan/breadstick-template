// src/studio/overlayCatalog.js — presentational catalog. `type` mirrors the
// existing HyperFrames overlay vocabulary so a future apply step can route each
// to /api/remotion/skyframe-overlay. Glyphs are Unicode (the app has no icon lib).
export const OVERLAY_CATALOG = [
  { type: 'hook-caption',    label: 'Hook caption',    glyph: '❝' },
  { type: 'title-card',      label: 'Title card',      glyph: '▤' },
  { type: 'lower-third',     label: 'Lower third',     glyph: '▭' },
  { type: 'highlight-sweep', label: 'Highlight sweep', glyph: '▰' },
  { type: 'burst-lines',     label: 'Burst lines',     glyph: '✶' },
];

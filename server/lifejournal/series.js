// Pure resolver for LifeJournal aesthetic "series" (named output looks).
// Guarantees a series map + valid defaultSeries; back-compat: synthesize a
// `clean` series from the flat lut/canvas when no series map is configured.

const DEFAULT_FIT = 'pad';
const clampGrain = (g) => Math.max(0, Math.min(100, Math.trunc(Number(g) || 0)));

export function resolveSeriesConfig(cfg) {
  let series = cfg.series && Object.keys(cfg.series).length ? cfg.series : null;
  if (!series) series = { clean: { lut: cfg.lut, canvas: cfg.canvas, grain: 0, fit: DEFAULT_FIT } };

  const resolved = {};
  for (const [name, s] of Object.entries(series)) {
    if (!s || !s.lut || !s.canvas) throw new Error(`LifeJournal series "${name}" needs lut + canvas`);
    resolved[name] = { lut: s.lut, canvas: s.canvas, grain: clampGrain(s.grain), fit: s.fit === 'crop' ? 'crop' : DEFAULT_FIT };
  }
  const names = Object.keys(resolved);
  let defaultSeries = Array.isArray(cfg.defaultSeries) ? cfg.defaultSeries.filter((n) => names.includes(n)) : [];
  if (!defaultSeries.length) defaultSeries = [names[0]];
  return { ...cfg, series: resolved, defaultSeries };
}

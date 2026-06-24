/**
 * Carousel render executor — base path of onCarouselRender
 * (CanvasView.jsx:15281-15293). Output shape:
 *   { renderStatus: 'rendering'|'done'|'error', renderedSlides, zones, error }
 * The terminal-animate stage (opts.animate) is NOT migrated — that stays on
 * the node's own button until a later slice.
 */
export const carouselRenderExecutor = {
  async execute({ node, inputs, outputs, report, server, fetchImpl = fetch }) {
    const config = node.data?.config || {};
    // Art images are optional (text_only/terminal formats render without them).
    const artEntry = inputs.find((i) => i.sourceType === 'gami-art' && i.output?.slides)
      || Object.values(outputs || {}).map((output) => ({ output })).find((i) => i.output?.slides && i.output.batchStatus === 'done');
    const imageUrls = artEntry
      ? artEntry.output.slides.filter((s) => s.status === 'done' && s.url).map((s) => s.url)
      : [];

    report({ renderStatus: 'rendering', renderedSlides: [], error: '' });
    const name = `carousel_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
    const res = await fetchImpl(`${server}/api/carousel/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, config, imageUrls }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Render failed');
    return { renderStatus: 'done', renderedSlides: data.slides, zones: data.zones || {}, error: '' };
  },
};

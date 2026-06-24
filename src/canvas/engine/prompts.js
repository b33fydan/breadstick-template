// src/canvas/engine/prompts.js
/**
 * Single browser-side source for Carousel Video Lane prompt building.
 * Copied verbatim from pipeline-cli.js (the proven CLI versions). If you
 * change a style string here, change it there too — they are brand DNA.
 */

export const GAMI_ART_STYLE = 'High-resolution product photograph of a physical, multi-layered cut paper and origami sculpture. Stair-stepped pixelated aesthetic merged with traditional origami folds. Multi-layered 3D cardstock construction. Soft directional lighting creating distinct drop shadows between physical paper layers. Hyper-realistic tangible texture contrasted with digital abstraction. 16-bit jagged physics reinforced by fold geometry.';

export const TITLE_CARD_STYLE = 'High-resolution product photograph of a physical piece of aged paper resting on a wooden desk surface. The paper has hand-written text in bold, slightly imperfect lettering — as if written with a thick marker or brush pen on textured cardstock. Stair-stepped pixelated aesthetic merged with traditional origami folds on the paper edges. Multi-layered 3D cardstock construction visible at the paper borders — folded, creased edges with torn fiber detail. Soft directional lighting creating distinct drop shadows between the paper and desk. Hyper-realistic tangible texture. 16-bit jagged physics reinforced by fold geometry. The desk has subtle props: a pencil, paper clips, or a coffee ring stain. Shallow depth of field. Warm, nostalgic studio lighting.';

export function parseSlides(scriptText) {
  const lines = scriptText.split('\n').filter(l => l.trim().length > 0);
  const slides = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(/^(\d+)[.):\s]/);
    if (match) {
      if (current) slides.push(current);
      current = { num: parseInt(match[1]), text: line.replace(/^\d+[.):\s]+/, '').trim() };
    } else if (current) {
      current.text += ' ' + line.trim();
    }
  }
  if (current) slides.push(current);
  if (slides.length === 0) {
    return lines.filter(l => !l.startsWith('[')).map((l, i) => ({ num: i + 1, text: l.trim() }));
  }
  return slides;
}

export function buildGamiPrompt(slideText) {
  return `${GAMI_ART_STYLE}\n\nThe sculpture depicts a scene inspired by this narrative:\n"${slideText}"\n\nTranslate the emotional core of this narrative into a single origami diorama. Use folded paper characters, layered cardstock environments, and pixel-grid textures to convey the mood. Angled macro-level perspective with shallow depth of field emphasizing paper textures and cardstock grain.`;
}

export function buildGamiCtaPrompt() {
  return `${GAMI_ART_STYLE}\n\nThe sculpture depicts a small AI Agent. Origami paper folds and layered cardstock construction. Angled macro-level perspective with shallow depth of field emphasizing paper textures and cardstock grain.`;
}

export function buildTitleCardPrompt(slideText) {
  const words = slideText.split(/\s+/);
  const title = words.length > 8 ? words.slice(0, 8).join(' ') + '...' : slideText;
  return `${TITLE_CARD_STYLE}\n\nThe text written on the paper reads: "${title}"\n\nThe paper sits naturally on a warm wooden desk. The handwriting is bold and legible, slightly imperfect like real handwriting. The paper has origami-style folded edges with visible cardstock layers. Environment props are minimal and desk-appropriate.`;
}

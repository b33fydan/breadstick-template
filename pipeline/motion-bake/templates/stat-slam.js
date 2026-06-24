// Stat Slam — huge number + label, accent glow. Used when the script names a
// quantity that should land hard ("100,000 attempts per second", "92% of ...").
//
// Fields:
//   number    string  — the formatted number (keep the formatting — "1.2M", "92%")
//   label     string  — what the number is (kept short)
//   sublabel  string? — optional context line below the label

import { BRAND, EASE_OUT, hexToRgb, escapeHtml, composeHtml } from '../common.js';

const id = 'stat-slam';
const label = 'Stat Slam';
const description = 'Huge accent-glowing number with label + optional sublabel.';
const fields = {
  number:   { type: 'string', required: true,  description: 'formatted number, e.g. "1.2M", "92%", "100K"' },
  label:    { type: 'string', required: true,  description: 'what the number is' },
  sublabel: { type: 'string', required: false, description: 'optional context line' },
};
const defaults = { width: 1080, height: 1080, durationSec: 4.0 };

function render({ number, label: labelText, sublabel, width, height, durationSec, accentColor }) {
  const w = width  || defaults.width;
  const h = height || defaults.height;
  const dur = durationSec || defaults.durationSec;
  const accent = accentColor || BRAND.gold;
  const accentRgb = hexToRgb(accent);

  const styles = `
    .scene {
      width: 100%; height: 100%;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 60px;
      gap: 24px;
    }
    .num {
      color: ${accent};
      font-size: 320px; font-weight: 900; line-height: 0.95;
      letter-spacing: -0.04em;
      font-variant-numeric: tabular-nums;
      text-shadow:
        0 0 40px rgba(${accentRgb}, 0.45),
        0 0 110px rgba(${accentRgb}, 0.25);
      will-change: transform, opacity, filter;
    }
    .label {
      color: ${BRAND.text};
      font-size: 44px; font-weight: 700; line-height: 1.15;
      text-align: center;
      max-width: 80%;
      will-change: transform, opacity, filter;
    }
    .sublabel {
      color: ${BRAND.textDim};
      font-size: 24px; font-weight: 500; line-height: 1.3;
      text-align: center;
      letter-spacing: 0.02em;
      max-width: 70%;
      will-change: transform, opacity, filter;
    }
  `;

  const exitT = (dur - 0.4).toFixed(2);
  // Number lands first (scale+blur ramp from a noticeable start), label
  // settles 120ms after, sublabel another 100ms after that. Stagger feels
  // hierarchical — the eye reads the big number then the explanation.
  const script = `
    tl.from(".num",      { scale: 0.95, opacity: 0, filter: "blur(8px)", duration: 0.75, ease: "${EASE_OUT}" }, 0.15);
    tl.from(".label",    { y: 22, opacity: 0, filter: "blur(3px)", duration: 0.55, ease: "${EASE_OUT}" }, 0.40);
    ${sublabel ? `tl.from(".sublabel", { y: 18, opacity: 0, filter: "blur(2px)", duration: 0.50, ease: "${EASE_OUT}" }, 0.55);` : ''}
    tl.to  (".num",      { opacity: 0, scale: 0.97, filter: "blur(4px)", duration: 0.4, ease: "power2.in" }, ${exitT});
    tl.to  (".label",    { opacity: 0, duration: 0.4, ease: "power2.in" }, ${exitT});
    ${sublabel ? `tl.to  (".sublabel", { opacity: 0, duration: 0.4, ease: "power2.in" }, ${exitT});` : ''}
  `;

  const inner = `
      <div class="scene clip" id="stat-slam-scene" data-start="0" data-duration="${dur}" data-track-index="0">
        <div class="num">${escapeHtml(number || '')}</div>
        <div class="label">${escapeHtml(labelText || '')}</div>
        ${sublabel ? `<div class="sublabel">${escapeHtml(sublabel)}</div>` : ''}
      </div>`;

  return composeHtml({ width: w, height: h, durationSec: dur, inner, styles, script });
}

export default { id, label, description, fields, defaults, render };

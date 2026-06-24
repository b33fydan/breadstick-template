// Callout Card — single bold phrase on a glass card. The "and here's the
// punchline" beat. Use for short headline-style emphasis (3–8 words).
//
// Fields:
//   text  string  — the phrase (kept short — wraps but max ~3 lines at base size)

import { BRAND, EASE_OUT, tintedGlow, hexToRgb, escapeHtml, composeHtml } from '../common.js';

const id = 'callout';
const label = 'Callout Card';
const description = 'Glass card with a single bold phrase, scale + blur entry.';
const fields = {
  text: { type: 'string', required: true, description: 'the phrase (3–8 words ideal)' },
};
const defaults = { width: 1080, height: 720, durationSec: 4.5 };

function render({ text, width, height, durationSec, accentColor }) {
  const w = width  || defaults.width;
  const h = height || defaults.height;
  const dur = durationSec || defaults.durationSec;
  const accent = accentColor || BRAND.gold;
  const accentRgb = hexToRgb(accent);

  const styles = `
    .scene {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      padding: 80px;
    }
    .card {
      position: relative;
      width: 100%; max-width: 880px;
      padding: 64px 72px;
      background: rgba(19, 19, 26, 0.78);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      box-shadow: ${tintedGlow(accentRgb)};
      overflow: hidden;
      will-change: transform, opacity, filter;
    }
    .card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 4px;
      background: ${accent};
      box-shadow: 0 0 18px ${accent}aa;
    }
    .phrase {
      color: ${BRAND.text};
      font-size: 76px; font-weight: 800; line-height: 1.1;
      letter-spacing: -0.015em;
      text-align: center;
      will-change: transform, opacity, filter;
    }
  `;

  // Card scales 0.95 → 1 with 6px blur ramp (entry); the phrase rises 16px
  // 100ms after the card so it reads as "card lands, then content settles."
  // Final fade keeps the standalone playback graceful.
  const exitT = (dur - 0.4).toFixed(2);
  const script = `
    tl.from(".card",   { scale: 0.95, opacity: 0, filter: "blur(6px)", duration: 0.7,  ease: "${EASE_OUT}" }, 0.1);
    tl.from(".phrase", { y: 16,       opacity: 0, filter: "blur(2px)", duration: 0.55, ease: "${EASE_OUT}" }, 0.25);
    tl.to  (".card",   { opacity: 0,  scale: 0.97, filter: "blur(4px)", duration: 0.4, ease: "power2.in" }, ${exitT});
  `;

  const inner = `
      <div class="scene clip" id="callout-scene" data-start="0" data-duration="${dur}" data-track-index="0">
        <div class="card">
          <div class="phrase">${escapeHtml(text || '')}</div>
        </div>
      </div>`;

  return composeHtml({ width: w, height: h, durationSec: dur, inner, styles, script });
}

export default { id, label, description, fields, defaults, render };

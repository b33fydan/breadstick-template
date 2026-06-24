// Lower Third — bottom strap with name + title. Slides in from left.
// Used when the script names a person, a tool, or a brand.
//
// Fields:
//   name   string  — primary text (large)
//   title  string  — secondary text (uppercase, accent-colored)

import { BRAND, EASE_OUT, EASE_DRAWER, tintedGlow, hexToRgb, escapeHtml, composeHtml } from '../common.js';

const id = 'lower-third';
const label = 'Lower Third';
const description = 'Bottom strap with name + title, slides in from left, accent bar.';
const fields = {
  name:  { type: 'string', required: true,  description: 'primary name (large)' },
  title: { type: 'string', required: false, description: 'role / subtitle (uppercase, accent color)' },
};
// Wide bottom-strap aspect — Cartesian zone usually ~80% wide × 15% tall at the bottom.
const defaults = { width: 1920, height: 320, durationSec: 5.0 };

function render({ name, title, width, height, durationSec, accentColor }) {
  const w = width  || defaults.width;
  const h = height || defaults.height;
  const dur = durationSec || defaults.durationSec;
  const accent = accentColor || BRAND.gold;
  const accentRgb = hexToRgb(accent);

  const styles = `
    .scene {
      width: 100%; height: 100%;
      display: flex; align-items: center;
      padding: 0 80px;
    }
    .strap {
      display: flex; align-items: stretch;
      width: 100%;
      background: rgba(19, 19, 26, 0.78);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      box-shadow: ${tintedGlow(accentRgb)};
      overflow: hidden;
      will-change: transform, opacity, filter;
    }
    .accent {
      width: 10px; flex-shrink: 0;
      background: ${accent};
      box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.15);
    }
    .text {
      display: flex; flex-direction: column; justify-content: center;
      padding: 26px 36px;
      gap: 8px;
    }
    .name {
      color: ${BRAND.text};
      font-size: 64px; font-weight: 800; line-height: 1;
      letter-spacing: -0.01em;
      will-change: transform, opacity, filter;
    }
    .title {
      color: ${accent};
      font-size: 22px; font-weight: 600; line-height: 1;
      text-transform: uppercase; letter-spacing: 0.18em;
      will-change: transform, opacity, filter;
    }
  `;

  // Animation: strap slides in from x: -60 (drawer ease, motion-blur 8px ramp);
  // accent bar fades in slightly behind so it reads as a separate stroke;
  // text elements stagger 80ms, smaller blur (closer-distance translation).
  const exitT = (dur - 0.4).toFixed(2);
  const script = `
    tl.fromTo(".strap",
      { x: -60, opacity: 0, filter: "blur(8px)" },
      { x:   0, opacity: 1, filter: "blur(0px)", duration: 0.7, ease: "${EASE_DRAWER}" },
      0.1);
    tl.from(".accent", { scaleY: 0.6, opacity: 0, duration: 0.5, ease: "${EASE_OUT}", transformOrigin: "center bottom" }, 0.35);
    tl.from(".name",   { y: 18, opacity: 0, filter: "blur(2px)", duration: 0.55, ease: "${EASE_OUT}" }, 0.45);
    tl.from(".title",  { y: 14, opacity: 0, filter: "blur(2px)", duration: 0.50, ease: "${EASE_OUT}" }, 0.55);
    tl.to  (".strap",  { opacity: 0, x: -20, filter: "blur(6px)", duration: 0.4, ease: "power2.in" }, ${exitT});
  `;

  const inner = `
      <div class="scene clip" id="lower-third-scene" data-start="0" data-duration="${dur}" data-track-index="0">
        <div class="strap">
          <div class="accent"></div>
          <div class="text">
            <div class="name">${escapeHtml(name || '')}</div>
            ${title ? `<div class="title">${escapeHtml(title)}</div>` : ''}
          </div>
        </div>
      </div>`;

  return composeHtml({ width: w, height: h, durationSec: dur, inner, styles, script });
}

export default { id, label, description, fields, defaults, render };

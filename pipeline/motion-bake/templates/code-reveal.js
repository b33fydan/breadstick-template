// Code Reveal — multi-line code block with line numbers, lines stagger in.
// Use when the script narrates code, config, or structured commands.
//
// Fields:
//   lines     string[]  — each line of code, no manual line numbers
//   language  string?   — optional badge in the header (e.g., "js", "py", "bash")

import { BRAND, EASE_OUT, EASE_DRAWER, SHADOW_CARD, escapeHtml, composeHtml } from '../common.js';

const id = 'code-reveal';
const label = 'Code Reveal';
const description = 'Code editor with line numbers, lines stagger in 80ms each.';
const fields = {
  lines:    { type: 'string[]', required: true,  description: 'one entry per line of code' },
  language: { type: 'string',   required: false, description: 'badge label, e.g. "js", "py", "bash"' },
};
const defaults = { width: 1280, height: 720, durationSec: 6.0 };

function render({ lines, language, width, height, durationSec, accentColor }) {
  const w = width  || defaults.width;
  const h = height || defaults.height;
  const dur = durationSec || defaults.durationSec;
  const accent = accentColor || BRAND.gold;
  const lineList = Array.isArray(lines) ? lines : (lines ? [String(lines)] : []);
  const lang = (language || '').trim().toLowerCase();

  const lineHtml = lineList.map((line, i) => `
    <div class="row" data-i="${i}">
      <span class="ln">${i + 1}</span>
      <span class="code">${escapeHtml(line)}</span>
    </div>`).join('');

  const styles = `
    .scene {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      padding: 70px;
    }
    .editor {
      width: 100%; max-width: 1080px;
      background: ${BRAND.surface};
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      box-shadow: ${SHADOW_CARD};
      overflow: hidden;
      font-family: 'JetBrains Mono', 'SF Mono', Consolas, Menlo, monospace;
      will-change: transform, opacity, filter;
    }
    .header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 18px;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      font-size: 12px; color: ${BRAND.textDim};
      letter-spacing: 0.04em;
    }
    .lang-badge {
      padding: 3px 10px;
      background: ${accent};
      color: ${BRAND.bg};
      border-radius: 4px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .body { padding: 22px 0; }
    .row {
      display: flex; gap: 18px; align-items: baseline;
      padding: 4px 22px;
      font-size: 22px; line-height: 1.55;
      will-change: transform, opacity, filter;
    }
    .ln {
      width: 32px; text-align: right; flex-shrink: 0;
      color: ${BRAND.textDim};
      user-select: none;
    }
    .code { color: ${BRAND.text}; white-space: pre; }
  `;

  const exitT = (dur - 0.4).toFixed(2);
  const script = `
    tl.from(".editor", { scale: 0.95, opacity: 0, filter: "blur(8px)", duration: 0.7, ease: "${EASE_OUT}" }, 0.1);
    tl.from(".header", { y: -8, opacity: 0, duration: 0.45, ease: "${EASE_DRAWER}" }, 0.35);
    tl.from(".row",    { x: -16, opacity: 0, filter: "blur(3px)", duration: 0.45, ease: "${EASE_OUT}", stagger: 0.08 }, 0.65);
    tl.to  (".editor", { opacity: 0, duration: 0.4, ease: "power2.in" }, ${exitT});
  `;

  const inner = `
      <div class="scene clip" id="code-reveal-scene" data-start="0" data-duration="${dur}" data-track-index="0">
        <div class="editor">
          <div class="header">
            <span>code</span>
            ${lang ? `<span class="lang-badge">${escapeHtml(lang)}</span>` : ''}
          </div>
          <div class="body">${lineHtml}</div>
        </div>
      </div>`;

  return composeHtml({ width: w, height: h, durationSec: dur, inner, styles, script });
}

export default { id, label, description, fields, defaults, render };

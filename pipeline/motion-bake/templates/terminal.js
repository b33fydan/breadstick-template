// Terminal Block — dark CLI window with a typed-on command + result lines.
// Sits on top of POV / desk-cam footage to back up a "and then I ran X" beat.
//
// Fields (filled by the Motion Bake LLM split):
//   command  string     — the prompt line typed after the $
//   output   string[]   — result lines below (each on its own row)

import { BRAND, EASE_OUT, EASE_DRAWER, SHADOW_CARD, escapeHtml, composeHtml } from '../common.js';

const id = 'terminal';
const label = 'Terminal Block';
const description = 'Dark CLI window with monospace command + output lines staggered in.';
const fields = {
  command: { type: 'string', required: true,  description: 'the prompt line typed after $' },
  output:  { type: 'string[]', required: false, description: 'result lines below the command (one per line)' },
};
const defaults = { width: 1280, height: 720, durationSec: 5.0 };

function render({ command, output, width, height, durationSec, accentColor }) {
  const w = width  || defaults.width;
  const h = height || defaults.height;
  const dur = durationSec || defaults.durationSec;
  const accent = accentColor || BRAND.gold;
  const cmd = escapeHtml(command || '');
  const lines = Array.isArray(output) ? output : (output ? [String(output)] : []);

  // Build line markup. Each line is a separate div so GSAP can stagger.
  const linesHtml = lines.map((line, i) => `
    <div class="line out" data-i="${i}">${escapeHtml(line)}</div>`).join('');

  const styles = `
    .scene {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      padding: 80px;
    }
    .term {
      width: 100%; max-width: 1040px;
      background: ${BRAND.surface};
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      box-shadow: ${SHADOW_CARD};
      overflow: hidden;
      font-family: 'JetBrains Mono', 'SF Mono', Consolas, Menlo, monospace;
    }
    .chrome {
      display: flex; align-items: center; gap: 8px;
      padding: 14px 18px;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .dot { width: 12px; height: 12px; border-radius: 50%; }
    .dot.r { background: #ff5f57; }
    .dot.y { background: #febc2e; }
    .dot.g { background: #28c840; }
    .path {
      margin-left: 14px;
      font-size: 13px; color: ${BRAND.textDim};
      letter-spacing: 0.04em;
    }
    .body {
      padding: 28px 32px 36px;
      font-size: 24px; line-height: 1.55;
      color: ${BRAND.text};
    }
    .cmd { display: flex; gap: 12px; align-items: baseline; }
    .prompt { color: ${accent}; font-weight: 700; }
    .cmd-text { color: ${BRAND.text}; }
    .line { color: ${BRAND.text}; opacity: 0.92; padding-left: 28px; }
    .out { will-change: transform, opacity, filter; }
  `;

  // Animation:
  //   1. Window scales 0.95 → 1, opacity 0 → 1, blur 8px → 0  (entry, EASE_OUT)
  //   2. Chrome bar slides down from y -10  (EASE_DRAWER)
  //   3. Command line types in via opacity + slight x slide  (EASE_OUT)
  //   4. Output lines stagger in 80ms each, x: -16 → 0, blur 3px → 0
  //   5. Final 0.4s fade-out for standalone playback (Cartesian's fadeOut
  //      can re-handle this externally — both add up to a graceful end).
  const exitT = (dur - 0.4).toFixed(2);
  const script = `
    tl.from(".term",   { scale: 0.95, opacity: 0, filter: "blur(8px)", duration: 0.7,  ease: "${EASE_OUT}" }, 0.1);
    tl.from(".chrome", { y: -10,      opacity: 0,                          duration: 0.5,  ease: "${EASE_DRAWER}" }, 0.35);
    tl.from(".cmd",    { x: -16,      opacity: 0, filter: "blur(3px)", duration: 0.5,  ease: "${EASE_OUT}" }, 0.55);
    tl.from(".out",    { x: -16,      opacity: 0, filter: "blur(3px)", duration: 0.45, ease: "${EASE_OUT}", stagger: 0.08 }, 0.95);
    tl.to  (".term",   { opacity: 0,  duration: 0.4, ease: "power2.in" }, ${exitT});
  `;

  const inner = `
      <div class="scene clip" id="terminal-scene" data-start="0" data-duration="${dur}" data-track-index="0">
        <div class="term">
          <div class="chrome">
            <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
            <span class="path">~/skyframe</span>
          </div>
          <div class="body">
            <div class="cmd">
              <span class="prompt">$</span>
              <span class="cmd-text">${cmd}</span>
            </div>
            ${linesHtml}
          </div>
        </div>
      </div>`;

  return composeHtml({ width: w, height: h, durationSec: dur, inner, styles, script });
}

export default { id, label, description, fields, defaults, render };

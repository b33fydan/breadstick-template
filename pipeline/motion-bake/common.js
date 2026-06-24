// Shared building blocks for every Motion Bake template.
//
// Pulls the motion-craft skill's recipe into reusable constants so every
// template renders with the same easing vocabulary, brand palette, and
// shadow recipe. Templates compose these — they don't redefine them.

// Skyframe brand (matches the carousel renderer + Cartesian accents).
export const BRAND = {
  bg:       '#0a0a0f',  // dark canvas
  surface:  '#13131a',  // elevated card / window background
  text:     '#e8e8e8',  // off-white body
  textDim:  '#7a7a85',  // de-emphasized labels
  gold:     '#C9A227',  // primary accent
  cyan:     '#00FFFF',  // secondary accent (Skyframe done-state)
};

// Three named easings, never the CSS defaults. From motion-craft's pillar 1.
export const EASE_OUT     = 'cubic-bezier(0.23, 1, 0.32, 1)';      // entries (Emil Kowalski)
export const EASE_DRAWER  = 'cubic-bezier(0.32, 0.72, 0, 1)';      // slides / drawer-like
export const EASE_IN      = 'cubic-bezier(0.7, 0, 0.84, 0)';       // exits (rare)

// Two-layer ambient shadow recipe. `cushion` = long soft, `contact` = tight.
// Templates concat these into a single box-shadow string.
export const SHADOW_CARD =
  '0 24px 56px rgba(0, 0, 0, 0.45), 0 6px 14px rgba(0, 0, 0, 0.30)';

// Tinted glow for accent-bearing elevated elements (gold or cyan).
// Pass the rgb triplet of the accent (without the alpha) to colorize.
export const tintedGlow = (rgb) =>
  `0 18px 38px rgba(${rgb}, 0.22), 0 4px 12px rgba(${rgb}, 0.32)`;

// Hex (#C9A227) → "201, 162, 39". Used for tinted shadows.
export const hexToRgb = (hex) => {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return '201, 162, 39';
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

// HTML-escape user-supplied text so a stray `<` doesn't break the comp.
export const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// Compose the GSAP CDN tag the same way every template does.
export const GSAP_SCRIPT =
  '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>';

// Compose the global reset + body sizing every template needs.
// Templates only override the .scene contents, not these.
export const baseStyles = (width, height) => `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: ${width}px; height: ${height}px;
    margin: 0; overflow: hidden;
    background: ${BRAND.bg};
    color: ${BRAND.text};
    font-family: 'Inter', 'SF Pro Display', system-ui, -apple-system, sans-serif;
  }
`;

// Wrap the rendered HTML in the standard hyperframes shell (single-scene
// composition, root container directly in <body>, no <template> wrapper).
// `inner` is the markup that lives inside the root container.
// `styles` is composition-specific CSS; `script` is the GSAP timeline body.
export const composeHtml = ({
  width, height, durationSec, inner, styles = '', script = '',
}) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    ${GSAP_SCRIPT}
    <style>
      ${baseStyles(width, height)}
      ${styles}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${durationSec}" data-width="${width}" data-height="${height}">
      ${inner}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      ${script}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;

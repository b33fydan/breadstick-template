// ─── RayBanIntro ─────────────────────────────────────────────────────────
// The Skyframe shortform Beat 1 hook. 3-second template that doubles as the
// portrait thumbnail for IG / TikTok / YouTube — pause at ~1.5s and the frame
// reads as a static title card.
//
// Layout (top to bottom, centered):
//   topWord      — small white prefix (e.g. "You're")
//   heroPhrase   — large Anton yellow with stacked-shadow 3D extrusion
//   midWord      — small white connector (e.g. "your")
//   pixelPhrase  — chunky 5×7 pixel-block, white (the 8-bit signature)
//   subtitle     — muted white tail (e.g. "context is bloated.")
//
// Pair with FFmpeg base blur:
//   `gblur=sigma=22:enable='between(t,0,3)'`
//
// The hero color is canonical yellow (#FFD24A) — never override unless you're
// rebranding the whole template.

import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import {
  EASE_OUT,
  SKYFRAME_PALETTE,
  buildExtrusionShadow,
  PixelBlockText,
} from './_helpers.jsx';

export const RayBanIntro = ({
  frame,
  fps,
  startSec = 0,
  endSec = 3.0,
  topWord = "You're",
  heroPhrase = 'BURNING THROUGH',
  midWord = '',
  pixelPhrase = 'CLOUD CODE',
  subtitle = 'context is bloated.',
  heroColor = SKYFRAME_PALETTE.hero,
}) => {
  const startF = startSec * fps;
  const endF = endSec * fps;
  const local = frame - startF;
  if (frame > endF + 6 || frame < startF - 8) return null;

  const enterDur = 8;
  const exitStart = endF - startF - 10;
  const containerOpacity = interpolate(
    local, [0, enterDur, exitStart, endF - startF],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const layers = [
    { key: 'top', text: topWord, delay: 0, kind: 'fade',
      style: {
        fontFamily: 'Inter, Arial, sans-serif', fontWeight: 400, fontSize: 38,
        color: '#fff', letterSpacing: '0.01em',
        textShadow: '0 3px 10px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.65)',
        marginBottom: 8,
      } },
    { key: 'hero', text: heroPhrase, delay: 2, kind: 'printer',
      style: {
        fontFamily: '"Anton", Impact, "Arial Narrow", sans-serif',
        fontWeight: 400, fontSize: 138, color: heroColor,
        lineHeight: 0.96, letterSpacing: '0.01em',
        paddingBottom: 14,
        textShadow: buildExtrusionShadow(),
      } },
    { key: 'mid', text: midWord, delay: 4, kind: 'fade',
      style: {
        fontFamily: 'Inter, Arial, sans-serif', fontWeight: 400, fontSize: 32,
        color: '#fff', letterSpacing: '0.01em',
        textShadow: '0 3px 10px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.65)',
        margin: '8px 0',
      } },
    // Pixel reveals near-simultaneous with hero (delay 4 vs 2) — the prior
    // 14-frame gap created a visible "yellow only" interim state we rejected.
    { key: 'pixel', kind: 'pixelblock', text: pixelPhrase, delay: 4,
      pixelSize: pixelPhrase.length <= 9  ? 14
               : pixelPhrase.length <= 12 ? 12
               : pixelPhrase.length <= 15 ? 10 : 9 },
    { key: 'subtitle', text: subtitle, delay: 10, kind: 'fade',
      style: {
        fontFamily: 'Inter, Arial, sans-serif', fontWeight: 400, fontSize: 30,
        color: 'rgba(255, 255, 255, 0.62)', letterSpacing: '0.025em',
        marginTop: 28,
        textShadow: '0 2px 8px rgba(0,0,0,0.55)',
      } },
  ];

  return (
    <AbsoluteFill style={{
      pointerEvents: 'none',
      opacity: containerOpacity,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '0 60px', textAlign: 'center',
    }}>
      {layers.map((layer) => {
        if (!layer.text) return null;

        if (layer.kind === 'pixelblock') {
          return (
            <div key={layer.key} style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 4px' }}>
              <PixelBlockText
                text={layer.text}
                frame={local}
                startFrame={layer.delay}
                color={SKYFRAME_PALETTE.pixelBlock}
                pixelSize={layer.pixelSize ?? 14}
                gap={2}
              />
            </div>
          );
        }

        if (layer.kind === 'printer') {
          const printDur = 22;
          const printProg = interpolate(local - layer.delay, [0, printDur], [0, 100], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
          });
          const op = interpolate(local - layer.delay, [0, 4], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          });
          return (
            <div key={layer.key} style={{
              ...layer.style,
              opacity: op,
              clipPath: `inset(${100 - printProg}% 0 0 0)`,
              WebkitClipPath: `inset(${100 - printProg}% 0 0 0)`,
            }}>
              {layer.text}
            </div>
          );
        }

        const cl = local - layer.delay;
        const op = interpolate(cl, [0, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const ty = interpolate(cl, [0, 8], [10, 0], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
        });
        return (
          <div key={layer.key} style={{
            ...layer.style,
            opacity: op,
            transform: `translateY(${ty}px)`,
          }}>
            {layer.text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

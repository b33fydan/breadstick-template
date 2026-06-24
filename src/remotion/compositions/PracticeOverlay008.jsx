import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  HtmlInCanvas,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

// ─── CRT shader sources (used by AsciiPlanet's HtmlInCanvas) ────────────
const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_resolution;
out vec4 fragColor;
void main() {
  vec2 uv = v_uv;
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  vec2 dUV = uv + cc * r2 * 0.18;
  if (dUV.x < 0.0 || dUV.x > 1.0 || dUV.y < 0.0 || dUV.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float caAmount = 0.0025 + 0.006 * length(cc);
  vec3 col;
  col.r = texture(u_tex, dUV + vec2(caAmount, 0.0)).r;
  col.g = texture(u_tex, dUV).g;
  col.b = texture(u_tex, dUV - vec2(caAmount, 0.0)).b;
  float scan = 0.78 + 0.22 * sin(dUV.y * u_resolution.y * 1.4);
  col *= scan;
  float vig = smoothstep(0.85, 0.30, length(cc));
  col *= vig;
  col *= vec3(0.92, 1.02, 1.10);
  vec3 bright = max(col - 0.55, 0.0);
  col += bright * 0.55;
  fragColor = vec4(col, 1.0);
}`;

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const EASE_DRAWER = Easing.bezier(0.32, 0.72, 0, 1);

// ─── 5x7 bitmap font ─────────────────────────────────────────────────────
const PIXEL_FONT_5x7 = {
  C: ['.XXXX', 'X....', 'X....', 'X....', 'X....', 'X....', '.XXXX'],
  L: ['X....', 'X....', 'X....', 'X....', 'X....', 'X....', 'XXXXX'],
  O: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  U: ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  D: ['XXXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'XXXX.'],
  E: ['XXXXX', 'X....', 'X....', 'XXX..', 'X....', 'X....', 'XXXXX'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};
const SPACE_COLS = 3;

// PixelBlockText — left-to-right swipe reveal (replaces column-wave per-pixel stagger)
const PixelBlockText = ({ text, frame, startFrame, color = '#FFC233', pixelSize = 14, gap = 2 }) => {
  const cell = pixelSize + gap;
  const charGap = 1;
  const pixels = [];
  let cursorX = 0;
  for (const ch of text) {
    const pattern = PIXEL_FONT_5x7[ch] || PIXEL_FONT_5x7[' '];
    const charCols = ch === ' ' ? SPACE_COLS : pattern[0].length;
    for (let r = 0; r < pattern.length; r++) {
      for (let c = 0; c < pattern[r].length; c++) {
        if (pattern[r][c] === 'X') {
          pixels.push({ x: cursorX + c * cell, y: r * cell });
        }
      }
    }
    cursorX += charCols * cell + charGap * cell;
  }
  const totalWidth = Math.max(0, cursorX - charGap * cell);
  const totalHeight = 7 * cell - gap;
  const maxX = Math.max(...pixels.map((p) => p.x), 1);

  // Swipe progress 0 → 1 over swipeDur frames
  const swipeDur = 22;
  const swipeProg = interpolate(frame - startFrame, [0, swipeDur], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  return (
    <div style={{ position: 'relative', width: totalWidth, height: totalHeight }}>
      {pixels.map((p, i) => {
        const xNorm = p.x / maxX;
        // Soft edge: pixel becomes visible as the swipe front passes its x-position
        const op = interpolate(swipeProg - xNorm, [-0.03, 0.02], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: p.x,
              top: p.y,
              width: pixelSize,
              height: pixelSize,
              background: color,
              opacity: op,
              boxShadow: '0 4px 0 rgba(0,0,0,0.55), 0 7px 18px rgba(0,0,0,0.42)',
            }}
          />
        );
      })}
    </div>
  );
};

// ─── Google Fonts ────────────────────────────────────────────────────────
let fontPromise = null;
const ensureFonts = () => {
  if (fontPromise) return fontPromise;
  fontPromise = (async () => {
    if (typeof document === 'undefined') return;
    if (!document.querySelector('link[data-googfonts-008]')) {
      const link = document.createElement('link');
      link.setAttribute('data-googfonts-008', 'true');
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;700;900&display=block';
      document.head.appendChild(link);
    }
    await document.fonts.ready;
  })();
  return fontPromise;
};

const inWindow = (frame, startSec, endSec, fps, padFrames = 8) =>
  frame >= startSec * fps - padFrames && frame <= endSec * fps + padFrames;

// ─── Effect 0: Intro title card 0–2.0s ───────────────────────────────────
const IntroTitleCard = ({ frame, fps }) => {
  const endF = 2.0 * fps;
  if (frame > endF + 6) return null;

  const enterDur = 8;
  const exitStart = endF - 8;
  const containerOpacity = interpolate(
    frame, [0, enterDur, exitStart, endF],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Layer config
  const layers = [
    { key: 'youre', text: "You're", delay: 0, kind: 'fade',
      style: { fontFamily: 'Inter, Arial, sans-serif', fontWeight: 400, fontSize: 38,
        color: '#fff', letterSpacing: '0.01em',
        textShadow: '0 3px 10px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.65)',
        marginBottom: 8 } },
    { key: 'burning', text: 'BURNING THROUGH', delay: 4, kind: 'printer',
      style: { fontFamily: '"Anton", Impact, "Arial Narrow", sans-serif',
        fontWeight: 400, fontSize: 138, color: '#ffffff',
        lineHeight: 0.92, letterSpacing: '0.01em',
        textShadow: '0 8px 26px rgba(0,0,0,0.55), 0 3px 8px rgba(0,0,0,0.7)' } },
    { key: 'your', text: 'your', delay: 14, kind: 'fade',
      style: { fontFamily: 'Inter, Arial, sans-serif', fontWeight: 400, fontSize: 32,
        color: '#fff', letterSpacing: '0.01em',
        textShadow: '0 3px 10px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.65)',
        margin: '8px 0' } },
    { key: 'cloudcode', kind: 'pixelblock', text: 'CLOUD CODE', delay: 18 },
    { key: 'subtext', text: 'context is bloated.', delay: 30, kind: 'fade',
      style: { fontFamily: 'Inter, Arial, sans-serif', fontWeight: 400, fontSize: 30,
        color: 'rgba(255, 255, 255, 0.62)', letterSpacing: '0.025em',
        marginTop: 28,
        textShadow: '0 2px 8px rgba(0,0,0,0.55)' } },
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
        if (layer.kind === 'pixelblock') {
          return (
            <div key={layer.key} style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 4px' }}>
              <PixelBlockText
                text={layer.text}
                frame={frame}
                startFrame={layer.delay}
                color="#FFC233"
                pixelSize={14}
                gap={2}
              />
            </div>
          );
        }

        if (layer.kind === 'printer') {
          // 3D printer: clip-path inset(top% 0 0 0) where top% goes 100 → 0
          const printDur = 22;
          const printProg = interpolate(frame - layer.delay, [0, printDur], [0, 100], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
          });
          const containerOp = interpolate(frame - layer.delay, [0, 4], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          });
          return (
            <div key={layer.key} style={{
              ...layer.style,
              opacity: containerOp,
              clipPath: `inset(${100 - printProg}% 0 0 0)`,
              WebkitClipPath: `inset(${100 - printProg}% 0 0 0)`,
            }}>
              {layer.text}
            </div>
          );
        }

        // Default 'fade': simple opacity + translateY entry
        const cl = frame - layer.delay;
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

// ─── Effect 1: CLAUDE.md liquid glass card 6–12s — karaoke title ────────
const ClaudeMdCard = ({ frame, fps }) => {
  const startF = 6.0 * fps;
  const endF = 12.0 * fps;
  if (!inWindow(frame, 6.0, 12.0, fps)) return null;

  const local = frame - startF;
  const total = endF - startF;
  const enterDur = 14;
  const exitStart = total - 16;

  const cardScale = interpolate(local, [0, enterDur], [0.95, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });
  const cardOpacity = interpolate(
    local, [0, enterDur, exitStart, total], [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const cardBlur = interpolate(local, [0, enterDur], [6, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });
  const cardY = interpolate(local, [0, enterDur], [24, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  // Karaoke words — each word fades + scales + colors
  const words = ['Keep', 'CLAUDE.md', 'under', '40K', 'characters'];
  const wordStart = enterDur + 4;
  const wordStagger = 7;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute',
        left: 50,
        top: 660,
        width: 510,
        opacity: cardOpacity,
        transform: `translateY(${cardY}px) scale(${cardScale})`,
        filter: `blur(${cardBlur}px)`,
        background: 'rgba(18, 26, 48, 0.32)',
        backdropFilter: 'blur(28px) saturate(1.25)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.25)',
        borderRadius: 32,
        border: '1px solid rgba(255, 255, 255, 0.20)',
        boxShadow: '0 22px 52px rgba(0,0,0,0.42), 0 6px 14px rgba(0,0,0,0.22)',
        padding: '38px 36px',
      }}>
        {/* eyebrow */}
        <div style={{
          fontFamily: 'Inter, Arial, sans-serif', fontWeight: 700, fontSize: 22,
          letterSpacing: '0.18em', color: 'rgba(0, 200, 255, 0.92)',
          marginBottom: 14, textTransform: 'uppercase',
        }}>
          Tip 1 · Context
        </div>
        {/* karaoke title */}
        <div style={{
          fontFamily: 'Inter, Arial, sans-serif', fontWeight: 900, fontSize: 64,
          color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.04,
          textShadow: '0 4px 10px rgba(0,0,0,0.35)',
        }}>
          {words.map((word, i) => {
            const isHero = word === 'CLAUDE.md';
            const cl = local - (wordStart + i * wordStagger);
            const op = interpolate(cl, [0, 8], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            });
            const ty = interpolate(cl, [0, 8], [14, 0], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
            });
            const sc = interpolate(cl, [0, 6, 12], [0.92, 1.12, 1.0], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
            });
            // Underline draws after the hero word lands
            const underlineProg = isHero
              ? interpolate(cl, [12, 26], [0, 1], {
                  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
                })
              : 0;
            // Non-hero: cyan → white shift; hero: stays gold
            const cyan = interpolate(cl, [0, 6, 14], [1, 1, 0], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            });
            const r = Math.round(255 * (1 - cyan) + 0 * cyan);
            const g = Math.round(255 * (1 - cyan) + 200 * cyan);
            const b = Math.round(255 * (1 - cyan) + 255 * cyan);
            const heroColor = '#FFC233';
            return (
              <span key={i} style={{
                position: 'relative',
                display: 'inline-block',
                opacity: op,
                transform: `translateY(${ty}px) scale(${sc})`,
                color: isHero ? heroColor : `rgb(${r}, ${g}, ${b})`,
                fontSize: isHero ? 82 : 'inherit',
                fontWeight: isHero ? 900 : 'inherit',
                lineHeight: isHero ? 1.0 : 'inherit',
                marginRight: '0.28em',
                marginTop: isHero ? 4 : 0,
                whiteSpace: 'pre',
                textShadow: isHero
                  ? '0 4px 14px rgba(0,0,0,0.5), 0 2px 4px rgba(255,194,51,0.35)'
                  : '0 4px 10px rgba(0,0,0,0.35)',
              }}>
                {word}
                {isHero && (
                  <div style={{
                    position: 'absolute',
                    left: 0,
                    bottom: -2,
                    height: 5,
                    width: `${underlineProg * 100}%`,
                    background: heroColor,
                    borderRadius: 1,
                    boxShadow: '0 0 12px rgba(255, 194, 51, 0.6)',
                  }} />
                )}
              </span>
            );
          })}
        </div>
        {/* bottom rule */}
        <div style={{
          marginTop: 22, height: 2, width: 80,
          background: 'rgba(0, 200, 255, 0.65)', borderRadius: 2,
        }} />
      </div>
    </AbsoluteFill>
  );
};

// ─── Trash compactor SVG (right side of CompactCard) ─────────────────────
const TrashCompactor = ({ local, total }) => {
  // Animation arcs across the window
  // Phase A: press appears (0–8 frames)
  // Phase B: press descends, numbers squish (8–32)
  // Phase C: hold (32–48)
  // Phase D: result reveal "40K" (48–60)
  // Phase E: press lifts + hold (60–end)
  const pressY = interpolate(local, [0, 8, 32, 60, total - 6, total],
    [-80, -20, 110, 110, -20, -60],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_DRAWER });

  const stackScaleY = interpolate(local, [8, 32], [1, 0.18], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_DRAWER,
  });
  const stackOp = interpolate(local, [8, 32, 48], [1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const resultOp = interpolate(local, [44, 56], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const resultScale = interpolate(local, [44, 60], [0.7, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  const containerOp = interpolate(local, [0, 6, total - 14, total],
    [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <svg width={300} height={420} style={{ opacity: containerOp, overflow: 'visible' }}>
      <defs>
        <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cdd2da" />
          <stop offset="50%" stopColor="#9aa3b0" />
          <stop offset="100%" stopColor="#6a7280" />
        </linearGradient>
        <linearGradient id="compactor-edge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a3f48" />
          <stop offset="100%" stopColor="#1a1d22" />
        </linearGradient>
      </defs>

      {/* Side rails (compactor walls) */}
      <rect x={20} y={40} width={10} height={340} fill="url(#compactor-edge)" />
      <rect x={270} y={40} width={10} height={340} fill="url(#compactor-edge)" />

      {/* Floor */}
      <rect x={20} y={376} width={260} height={8} fill="url(#compactor-edge)" />

      {/* Press */}
      <g transform={`translate(0, ${pressY})`}>
        <rect x={30} y={120} width={240} height={42} fill="url(#metal)" stroke="#1a1d22" strokeWidth="2" rx="4" />
        {/* Hydraulic shaft */}
        <rect x={140} y={70} width={20} height={50} fill="#666" />
        {/* Press body bolts */}
        <circle cx={50} cy={141} r="4" fill="#3a3f48" />
        <circle cx={250} cy={141} r="4" fill="#3a3f48" />
      </g>

      {/* Numbers being squished */}
      <g transform={`translate(150, 200) scale(1, ${stackScaleY})`} style={{ opacity: stackOp, transformOrigin: 'center 100%' }}>
        <text x={0} y={0} fontFamily="Inter, Arial, sans-serif" fontWeight={900} fontSize={48}
          textAnchor="middle" fill="#fff" stroke="#000" strokeWidth="0.5">245K</text>
        <text x={0} y={56} fontFamily="Inter, Arial, sans-serif" fontWeight={400} fontSize={22}
          textAnchor="middle" fill="rgba(255,255,255,0.7)">tokens</text>
        <text x={0} y={110} fontFamily="Inter, Arial, sans-serif" fontWeight={900} fontSize={32}
          textAnchor="middle" fill="#FFC233">↓</text>
      </g>

      {/* Compacted result */}
      <g transform={`translate(150, 340) scale(${resultScale})`} style={{ opacity: resultOp, transformOrigin: 'center' }}>
        <rect x={-90} y={-44} width={180} height={70} rx="14"
          fill="rgba(255, 194, 51, 0.16)" stroke="#FFC233" strokeWidth="2" />
        <text x={0} y={9} fontFamily="Inter, Arial, sans-serif" fontWeight={900} fontSize={48}
          textAnchor="middle" fill="#FFC233">40K</text>
      </g>
    </svg>
  );
};

// ─── Effect 2: /compact bottom card + Trash compactor 15.5–21s ──────────
const CompactCard = ({ frame, fps }) => {
  const startF = 15.5 * fps;
  const endF = 21.0 * fps;
  if (!inWindow(frame, 15.5, 21.0, fps)) return null;

  const local = frame - startF;
  const total = endF - startF;
  const enterDur = 12;
  const exitStart = total - 14;

  const cardOpacity = interpolate(
    local, [0, enterDur, exitStart, total], [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const cardY = interpolate(local, [0, enterDur], [60, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {/* Bottom card */}
      <div style={{
        position: 'absolute',
        left: '50%',
        bottom: 220,
        transform: `translateX(-50%) translateY(${cardY}px)`,
        opacity: cardOpacity,
        padding: '24px 48px 28px',
        background: 'rgba(8, 14, 30, 0.78)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 22,
        border: '1.5px solid rgba(0, 138, 255, 0.55)',
        boxShadow: '0 22px 44px rgba(0,0,0,0.50), 0 6px 12px rgba(0,0,0,0.28)',
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: 'Consolas, "Courier New", monospace',
          fontSize: 68, fontWeight: 700, color: '#fff',
          letterSpacing: '0.02em', lineHeight: 1.0, marginBottom: 6,
        }}>
          /compact
        </div>
        <div style={{
          fontFamily: 'Inter, Arial, sans-serif', fontWeight: 400,
          fontSize: 28, color: 'rgba(255,255,255,0.78)',
          letterSpacing: '0.02em',
        }}>
          without breaking content
        </div>
      </div>

      {/* Right side trash compactor */}
      <div style={{
        position: 'absolute', right: 40, top: 540,
      }}>
        <TrashCompactor local={local} total={total} />
      </div>
    </AbsoluteFill>
  );
};

// ─── Origami paper figure (animated) ─────────────────────────────────────
const PaperFigure = ({ tint, badge, foldProg = 1 }) => {
  // foldProg 0 = flat (rectangle), 1 = folded character
  // Body folds: trapezoid edges interpolate from flat to folded
  const flatTop = 100;
  const foldedTopL = 40;  // Trapezoid narrow top, left x
  const foldedTopR = 120; // Trapezoid narrow top, right x
  const tlx = interpolate(foldProg, [0, 1], [0, 40]);
  const trx = interpolate(foldProg, [0, 1], [160, 120]);
  const headOp = interpolate(foldProg, [0.4, 0.9], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const headR = interpolate(foldProg, [0.4, 1.0], [0, 32], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  return (
    <svg width="160" height="220" viewBox="0 0 160 220" style={{ display: 'block' }}>
      {/* Body trapezoid morphing from flat to folded */}
      <path
        d={`M 24 200 L ${tlx} ${flatTop - foldProg * 12} Q 80 ${flatTop - foldProg * 22} ${trx} ${flatTop - foldProg * 12} L 136 200 Z`}
        fill="#f5ecdc" stroke="#bda07a" strokeWidth="2"
      />
      {/* Head (appears as fold completes) */}
      <circle cx="80" cy="56" r={headR} fill="#f5ecdc" stroke="#bda07a" strokeWidth="2" opacity={headOp} />
      {/* Crease */}
      <line x1="80" y1={flatTop - foldProg * 12} x2="80" y2="200" stroke="#cdb692" strokeWidth="1.4" opacity={0.55 * foldProg} />
      {/* Top edge highlight */}
      <path d={`M 24 200 L ${tlx} ${flatTop - foldProg * 12}`} stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" fill="none" />
      {/* Tint accent */}
      <circle cx="80" cy="130" r="7" fill={tint} opacity={0.85 * foldProg} />
      {/* Task badge above head */}
      {badge && (
        <text x="80" y="32" fontFamily="Inter, Arial, sans-serif" fontWeight="900" fontSize="24"
          textAnchor="middle" fill={tint} opacity={headOp}>
          {badge}
        </text>
      )}
    </svg>
  );
};

// ─── Effect 3: Origami sub-agents 27.5–31.5s ─────────────────────────────
const OrigamiSubAgents = ({ frame, fps }) => {
  const startF = 27.5 * fps;
  const endF = 31.5 * fps;
  if (!inWindow(frame, 27.5, 31.5, fps)) return null;

  const local = frame - startF;
  const total = endF - startF;
  const enterDur = 12;
  const exitStart = total - 14;

  const cardOpacity = interpolate(
    local, [0, enterDur, exitStart, total], [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const cardScale = interpolate(local, [0, enterDur], [0.94, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  // Story arc (in frames within local window):
  // 0–14:  card enters
  // 10–28: ONE figure folds in (operator, center)
  // 26–34: operator pulses
  // 32–48: spawns into 3 (operator fades, 3 fan out from center to L/M/R positions)
  // 48–80: 3 figures parallel work — each does subtle bob + badge appears
  // 80–end: result symbol "✓" appears between them

  const opFold = interpolate(local, [10, 28], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });
  const opPulse = 1 + 0.10 * Math.sin(Math.max(0, local - 26) * 0.85);
  const opShow = interpolate(local, [10, 20, 38, 46], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Three sub-agent figures — fan out
  const fanProg = interpolate(local, [32, 52], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });
  const subFold = interpolate(local, [32, 50], [0.4, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });
  const subFigShow = interpolate(local, [32, 42, exitStart - 4, exitStart + 4],
    [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Result checkmark
  const checkOp = interpolate(local, [76, 88], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const checkScale = interpolate(local, [76, 92], [0.6, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  // Card geometry — centered, large
  const cardW = 880;
  const cardH = 580;
  const cardLeft = (1080 - cardW) / 2;
  const cardTop = 720;

  // Sub-agent positions inside card (relative)
  const cardCenterX = cardW / 2;
  const figW = 160;
  const tints = ['rgb(120, 220, 140)', 'rgb(0, 138, 255)', 'rgb(255, 158, 64)'];
  const badges = ['🔍', '✏', '✓'];
  const targetXs = [cardCenterX - 240, cardCenterX, cardCenterX + 240];
  const baseY = 280;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute',
        left: cardLeft, top: cardTop,
        width: cardW, height: cardH,
        opacity: cardOpacity,
        transform: `scale(${cardScale})`,
        transformOrigin: 'center',
        background: 'rgba(18, 26, 48, 0.30)',
        backdropFilter: 'blur(28px) saturate(1.25)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.25)',
        borderRadius: 36,
        border: '1px solid rgba(255, 255, 255, 0.20)',
        boxShadow: '0 26px 60px rgba(0,0,0,0.42), 0 8px 18px rgba(0,0,0,0.22)',
        padding: '36px 36px 28px',
        overflow: 'hidden',
      }}>
        {/* Eyebrow */}
        <div style={{
          fontFamily: 'Inter, Arial, sans-serif', fontWeight: 700, fontSize: 22,
          letterSpacing: '0.18em', color: 'rgba(0, 200, 255, 0.92)',
          textAlign: 'center',
          textTransform: 'uppercase', marginBottom: 6,
        }}>
          Tip · Sub-agents
        </div>
        {/* Title */}
        <div style={{
          fontFamily: 'Inter, Arial, sans-serif', fontWeight: 900, fontSize: 60,
          color: '#fff', textAlign: 'center', letterSpacing: '-0.02em',
          textShadow: '0 4px 10px rgba(0,0,0,0.35)', marginBottom: 16,
        }}>
          Spawn parallel workers
        </div>

        {/* Stage area for figures */}
        <div style={{ position: 'relative', height: 380 }}>
          {/* Operator (single figure) — visible during 10–46 local */}
          <div style={{
            position: 'absolute',
            left: cardCenterX - figW / 2,
            top: baseY - 100,
            opacity: opShow,
            transform: `scale(${opPulse})`,
            transformOrigin: 'center bottom',
            filter: 'drop-shadow(0 18px 32px rgba(0,0,0,0.38)) drop-shadow(0 5px 10px rgba(0,0,0,0.25))',
          }}>
            <PaperFigure tint="rgb(180, 220, 255)" foldProg={opFold} />
          </div>

          {/* Sub-agents — appear 32+ */}
          {[0, 1, 2].map((i) => {
            const targetX = targetXs[i];
            const startX = cardCenterX;
            const x = interpolate(fanProg, [0, 1], [startX, targetX], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
            });
            // Subtle bob during parallel work phase
            const figLocal = local - 32;
            const bob = Math.sin(figLocal * 0.22 + i * 1.0) * 6;
            return (
              <div key={i} style={{
                position: 'absolute',
                left: x - figW / 2,
                top: baseY - 100 + bob,
                opacity: subFigShow,
                filter: 'drop-shadow(0 18px 32px rgba(0,0,0,0.38)) drop-shadow(0 5px 10px rgba(0,0,0,0.25))',
              }}>
                <PaperFigure tint={tints[i]} badge={badges[i]} foldProg={subFold} />
              </div>
            );
          })}

          {/* Result checkmark */}
          <div style={{
            position: 'absolute',
            left: cardCenterX - 60,
            top: baseY + 130,
            width: 120, height: 70,
            opacity: checkOp,
            transform: `scale(${checkScale})`,
            transformOrigin: 'center',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(120, 220, 140, 0.16)',
            border: '2px solid rgb(120, 220, 140)',
            borderRadius: 18,
            fontFamily: 'Inter, Arial, sans-serif', fontWeight: 900, fontSize: 44,
            color: 'rgb(120, 220, 140)',
            textShadow: '0 0 16px rgba(120, 220, 140, 0.55)',
          }}>
            ✓ done
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Effect 3.5: ASCII planet motion graphic 21.5–27s ────────────────────
// Now wrapped in HtmlInCanvas with a WebGL CRT shader (barrel distortion +
// chromatic aberration + scanlines + vignette + bloom + phosphor tint) and a
// "spinning" effect achieved by shifting the noise function over time —
// continents appear to rotate across the disc without any actual rotation
// transform. Requires `--gl=angle` on render (set in remotion.config.mjs).
const AsciiPlanet = ({ frame, fps }) => {
  // Hooks must be called every render — keep them above the early-return.
  const stateRef = useRef(null);

  const onInit = useCallback(({ canvas }) => {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true });
    if (!gl) return;
    const compileShader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    };
    const vs = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const aPos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const uTex = gl.getUniformLocation(program, 'u_tex');
    const uRes = gl.getUniformLocation(program, 'u_resolution');

    stateRef.current = { gl, program, vao, vbo, tex, uTex, uRes };

    return () => {
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(vbo);
      gl.deleteTexture(tex);
      stateRef.current = null;
    };
  }, []);

  const onPaint = useCallback(({ canvas, element, elementImage }) => {
    if (!stateRef.current) return;
    const { gl, program, vao, tex, uTex, uRes } = stateRef.current;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texElementImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, elementImage);
    gl.uniform1i(uTex, 0);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (element && element.style) {
      element.style.transform = 'matrix(1, 0, 0, 1, 0, 0)';
    }
  }, []);

  if (!inWindow(frame, 21.5, 27.0, fps)) return null;
  const startF = 21.5 * fps;
  const endF = 27.0 * fps;
  const local = frame - startF;
  const total = endF - startF;
  const enterDur = 30;
  const exitStart = total - 16;

  const containerOpacity = interpolate(
    local, [0, 14, exitStart, total], [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const cols = 64;
  const rows = 28;
  const cx = cols / 2 - 0.5;
  const cy = rows / 2 - 0.5;
  const radius = 13;
  const dyStretch = 1.7;

  // Spinning: shift the noise input over local frame for "rotating continents"
  const spinOffset = local * 0.15;

  const cellHash = (x, y) => {
    const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return ((v % 1) + 1) % 1;
  };

  const isLand = (x, y) => {
    const xRot = x + spinOffset;
    const n1 = Math.sin(xRot * 0.18 + 1.4) * Math.cos(y * 0.32);
    const n2 = Math.sin(xRot * 0.08 + y * 0.21 + 2.7) * 0.85;
    const n3 = Math.cos(xRot * 0.27 + y * 0.16) * 0.4;
    return (n1 + n2 + n3) > 0.25;
  };

  const scanRow = interpolate(local, [0, enterDur], [-1, rows + 2], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  const lines = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) {
      const dx = x - cx;
      const dy = (y - cy) * dyStretch;
      const distSq = dx * dx + dy * dy;
      if (distSq > radius * radius) { line += ' '; continue; }
      if (y > scanRow) { line += ' '; continue; }
      const distNorm = Math.sqrt(distSq) / radius;
      const land = isLand(x, y);
      // Cell hash also rotates so glyphs flicker — sells the spin
      const h = cellHash(x + Math.floor(spinOffset), y);
      if (distNorm > 0.94) { line += h < 0.5 ? '·' : ' '; continue; }
      if (land) line += h < 0.85 ? '/' : 'X';
      else line += h < 0.42 ? '/' : (h < 0.55 ? '·' : ' ');
    }
    lines.push(line);
  }

  const sfPinOp = interpolate(local, [enterDur + 4, enterDur + 16], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const lonPinOp = interpolate(local, [enterDur + 14, enterDur + 26], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const arcProg = interpolate(local, [enterDur + 22, enterDur + 50], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  // Bigger font for the embedded version — at 1080×1920 the planet should pop
  const fontSize = 22;
  const charW = fontSize * 0.6;
  const lineH = fontSize * 1.0;
  const planetW = cols * charW;
  const planetH = rows * lineH;

  const sfPx = { x: cols * 0.32 * charW, y: rows * 0.40 * lineH };
  const lonPx = { x: cols * 0.66 * charW, y: rows * 0.36 * lineH };
  const arcMidX = (sfPx.x + lonPx.x) / 2;
  const arcMidY = Math.min(sfPx.y, lonPx.y) - 90;
  const arcPath = `M ${sfPx.x} ${sfPx.y} Q ${arcMidX} ${arcMidY} ${lonPx.x} ${lonPx.y}`;
  const arcLen = 800;

  // HtmlInCanvas region — full width, partial height, vertically centered
  const canvasW = 1080;
  const canvasH = 1100;
  const canvasTop = (1920 - canvasH) / 2;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: containerOpacity }}>
      <div style={{
        position: 'absolute',
        left: 0, top: canvasTop,
        width: canvasW, height: canvasH,
      }}>
        <HtmlInCanvas width={canvasW} height={canvasH} onInit={onInit} onPaint={onPaint}>
          <AbsoluteFill style={{
            background: '#0a0a0f',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ position: 'relative', width: planetW, height: planetH }}>
              <div style={{
                position: 'absolute', left: 0, top: -64, width: '100%',
                textAlign: 'center',
                fontFamily: 'Inter, Arial, sans-serif', fontWeight: 700, fontSize: 22,
                letterSpacing: '0.22em', color: '#00C8FF', textTransform: 'uppercase',
                textShadow: '0 0 12px rgba(0,200,255,0.55)',
              }}>
                Code w/ Claude · Global
              </div>

              <pre style={{
                position: 'relative',
                fontFamily: 'Consolas, "Courier New", monospace',
                fontSize: fontSize, lineHeight: 1.0,
                color: 'rgba(245, 245, 245, 0.94)', letterSpacing: 0,
                margin: 0, padding: 0,
                textShadow: '0 0 6px rgba(0,200,255,0.18)',
                whiteSpace: 'pre',
              }}>
                {lines.join('\n')}
              </pre>

              <svg style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                pointerEvents: 'none', overflow: 'visible',
              }}>
                <path d={arcPath} fill="none" stroke="#E08855" strokeWidth="3"
                  strokeDasharray={`${arcLen} ${arcLen}`}
                  strokeDashoffset={`${arcLen * (1 - arcProg)}`}
                  opacity={arcProg > 0 ? 0.95 : 0} />
              </svg>

              <div style={{
                position: 'absolute', left: sfPx.x, top: sfPx.y,
                opacity: sfPinOp, transform: 'translate(-50%, -100%)',
                fontFamily: 'Consolas, "Courier New", monospace',
              }}>
                <div style={{
                  background: '#E08855', color: '#fff',
                  padding: '4px 12px', fontSize: 18, fontWeight: 700,
                  letterSpacing: '0.02em', borderRadius: 4,
                  boxShadow: '0 4px 10px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
                }}>San Francisco</div>
                <div style={{ width: 2, height: 18, background: '#E08855', margin: '0 auto' }} />
                <div style={{
                  width: 12, height: 12, borderRadius: '50%', background: '#E08855',
                  margin: '0 auto', marginTop: -3,
                  boxShadow: '0 0 12px rgba(224, 136, 85, 0.95)',
                }} />
              </div>

              <div style={{
                position: 'absolute', left: lonPx.x, top: lonPx.y,
                opacity: lonPinOp, transform: 'translate(-50%, -100%)',
                fontFamily: 'Consolas, "Courier New", monospace',
              }}>
                <div style={{
                  background: '#E08855', color: '#fff',
                  padding: '4px 12px', fontSize: 18, fontWeight: 700,
                  letterSpacing: '0.02em', borderRadius: 4,
                  boxShadow: '0 4px 10px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
                }}>London</div>
                <div style={{ width: 2, height: 18, background: '#E08855', margin: '0 auto' }} />
                <div style={{
                  width: 12, height: 12, borderRadius: '50%', background: '#E08855',
                  margin: '0 auto', marginTop: -3,
                  boxShadow: '0 0 12px rgba(224, 136, 85, 0.95)',
                }} />
              </div>
            </div>
          </AbsoluteFill>
        </HtmlInCanvas>
      </div>
    </AbsoluteFill>
  );
};

// ─── Effect 4: Opus glistening 34.5–40s (preserved from 007) ─────────────
const OpusGlisten = ({ frame, fps }) => {
  const startF = 34.5 * fps;
  const endF = 40.0 * fps;
  if (!inWindow(frame, 34.5, 40.0, fps)) return null;

  const local = frame - startF;
  const total = endF - startF;
  const text = 'Opus';
  const typeStart = 4;
  const charPace = 5;
  const visibleChars = Math.max(0, Math.min(text.length, Math.floor((local - typeStart) / charPace)));
  const visibleText = text.slice(0, visibleChars);

  const caretPhase = Math.floor(local / 6) % 2;
  const caretOn = visibleChars < text.length || caretPhase === 0;

  const shineProgress = ((local % 70) / 70);
  const shineCenter = -20 + shineProgress * 160;

  const containerOpacity = interpolate(
    local, [0, 8, total - 14, total], [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const wordScale = interpolate(local, [0, 18], [0.96, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  return (
    <AbsoluteFill style={{
      pointerEvents: 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        opacity: containerOpacity,
        transform: `scale(${wordScale})`,
        position: 'relative',
        display: 'flex', alignItems: 'baseline',
      }}>
        <div style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 240, fontWeight: 700,
          letterSpacing: '-0.02em', lineHeight: 1.0,
          backgroundImage: `linear-gradient(48deg,
            #8c5e1f 0%,
            #c98f30 ${Math.max(0, shineCenter - 22)}%,
            #f6dc92 ${Math.max(0, shineCenter - 6)}%,
            #ffffff ${shineCenter}%,
            #f6dc92 ${Math.min(100, shineCenter + 6)}%,
            #c98f30 ${Math.min(100, shineCenter + 22)}%,
            #8c5e1f 100%)`,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          color: 'transparent',
          filter: 'drop-shadow(0 18px 56px rgba(0,0,0,0.85)) drop-shadow(0 24px 64px rgba(255, 200, 80, 0.45)) drop-shadow(0 6px 14px rgba(0, 0, 0, 0.75)) drop-shadow(0 2px 4px rgba(0,0,0,0.9))',
        }}>
          {visibleText || '​'}
        </div>
        <div style={{
          width: 6, height: 180, marginLeft: 14, marginBottom: 14,
          background: 'rgba(255, 240, 200, 0.92)',
          opacity: caretOn ? 0.85 : 0,
          borderRadius: 3,
          boxShadow: '0 0 18px rgba(255, 220, 130, 0.55)',
        }} />
      </div>
    </AbsoluteFill>
  );
};

// ─── Master composition ──────────────────────────────────────────────────
export const PracticeOverlay008 = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('Loading Google fonts'));
  useEffect(() => {
    ensureFonts().then(() => continueRender(fontHandle));
  }, [fontHandle]);

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <IntroTitleCard frame={frame} fps={fps} />
      <ClaudeMdCard frame={frame} fps={fps} />
      <CompactCard frame={frame} fps={fps} />
      <AsciiPlanet frame={frame} fps={fps} />
      <OrigamiSubAgents frame={frame} fps={fps} />
      <OpusGlisten frame={frame} fps={fps} />

      {/* Audio cues — see project_motion_graphic_sounds.md for the vocabulary.
          bubble = motion graphic appearing, whoosh = transition / pattern-interrupt,
          chime = emphasis-word reveal (one per video, reserved for the Opus moment). */}
      <Sequence from={0} durationInFrames={24}>
        <Audio src={staticFile('sounds/bubble.mp3')} />
      </Sequence>
      <Sequence from={132} durationInFrames={24}>
        <Audio src={staticFile('sounds/whoosh.mp3')} />
      </Sequence>
      <Sequence from={156} durationInFrames={24}>
        <Audio src={staticFile('sounds/bubble.mp3')} />
      </Sequence>
      <Sequence from={360} durationInFrames={24}>
        <Audio src={staticFile('sounds/whoosh.mp3')} />
      </Sequence>
      <Sequence from={384} durationInFrames={24}>
        <Audio src={staticFile('sounds/bubble.mp3')} />
      </Sequence>
      <Sequence from={504} durationInFrames={24}>
        <Audio src={staticFile('sounds/whoosh.mp3')} />
      </Sequence>
      <Sequence from={672} durationInFrames={24}>
        <Audio src={staticFile('sounds/bubble.mp3')} />
      </Sequence>
      <Sequence from={832} durationInFrames={48}>
        <Audio src={staticFile('sounds/chime.mp3')} />
      </Sequence>
    </AbsoluteFill>
  );
};

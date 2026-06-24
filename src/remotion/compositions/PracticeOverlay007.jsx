import React, { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  Easing,
  continueRender,
  delayRender,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const EASE_DRAWER = Easing.bezier(0.32, 0.72, 0, 1);

// 5×7 bitmap patterns for letters used in the intro pixel block.
// Each pixel is rendered as an individual square in PixelBlockText below.
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

const PixelBlockText = ({ text, frame, startFrame, pixelSize = 14, gap = 2 }) => {
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
  const revealDur = 16;

  return (
    <div style={{ position: 'relative', width: totalWidth, height: totalHeight }}>
      {pixels.map((p, i) => {
        const colProgress = p.x / maxX;
        const delay = startFrame + colProgress * revealDur;
        const cl = frame - delay;
        const op = interpolate(cl, [0, 4], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        const sc = interpolate(cl, [0, 5], [0.55, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
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
              background: '#ffffff',
              opacity: op,
              transform: `scale(${sc})`,
              transformOrigin: 'center',
              // Sharp 4px pixel-drop + soft ambient grounding — depth on every square
              boxShadow: '0 4px 0 rgba(0,0,0,0.55), 0 7px 18px rgba(0,0,0,0.42)',
            }}
          />
        );
      })}
    </div>
  );
};

// ─── Google Fonts loader ─────────────────────────────────────────────────
// Press Start 2P = the pixelated/8-bit type from the @omgluka reference.
// Bebas Neue   = condensed-bold-display for the yellow emphasis tier.
// Loaded once per bundle; subsequent component mounts reuse the same Promise.
let fontPromise = null;
const ensureFonts = () => {
  if (fontPromise) return fontPromise;
  fontPromise = (async () => {
    if (typeof document === 'undefined') return;
    if (!document.querySelector('link[data-googfonts]')) {
      const link = document.createElement('link');
      link.dataset.googfonts = 'true';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Bebas+Neue&display=block';
      document.head.appendChild(link);
    }
    await document.fonts.ready;
  })();
  return fontPromise;
};

const inWindow = (frame, startSec, endSec, fps, padFrames = 8) => {
  const startF = startSec * fps;
  const endF = endSec * fps;
  return frame >= startF - padFrames && frame <= endF + padFrames;
};

// ─── Effect 1: CLAUDE.md liquid-glass card with karaoke title ────────────
const ClaudeMdCard = ({ frame, fps }) => {
  const startF = 6.0 * fps;
  const endF = 12.0 * fps;
  if (!inWindow(frame, 6.0, 12.0, fps)) return null;

  const local = frame - startF;
  const total = endF - startF;
  const enterDur = 14;
  const exitStart = total - 14;

  const cardScale = interpolate(local, [0, enterDur], [0.95, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });
  const cardOpacity = interpolate(
    local, [0, enterDur, exitStart, total],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const cardBlur = interpolate(local, [0, enterDur], [6, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });
  const cardY = interpolate(local, [0, enterDur], [24, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  const title = 'CLAUDE.md';
  const charStart = enterDur + 4;
  const charStagger = 1.6;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute',
        left: 50,
        top: 720,
        width: 480,
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
        {/* eyebrow label */}
        <div style={{
          fontFamily: 'Arial, sans-serif',
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: '0.18em',
          color: 'rgba(0, 200, 255, 0.92)',
          marginBottom: 14,
          textTransform: 'uppercase',
        }}>
          Tip 1 · Context
        </div>
        {/* karaoke title */}
        <div style={{
          fontFamily: 'Arial, sans-serif',
          fontWeight: 900,
          fontSize: 86,
          color: '#fff',
          letterSpacing: '-0.025em',
          lineHeight: 1.0,
          textShadow: '0 4px 10px rgba(0,0,0,0.35)',
        }}>
          {title.split('').map((ch, i) => {
            const cl = local - (charStart + i * charStagger);
            const op = interpolate(cl, [0, 7], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            });
            const ty = interpolate(cl, [0, 7], [16, 0], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
            });
            const sc = interpolate(cl, [0, 5, 10], [0.94, 1.08, 1.0], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
            });
            return (
              <span key={i} style={{
                display: 'inline-block',
                opacity: op,
                transform: `translateY(${ty}px) scale(${sc})`,
                whiteSpace: 'pre',
              }}>{ch}</span>
            );
          })}
        </div>
        {/* subtle bottom rule */}
        <div style={{
          marginTop: 20,
          height: 2,
          width: 80,
          background: 'rgba(0, 200, 255, 0.65)',
          borderRadius: 2,
        }} />
      </div>
    </AbsoluteFill>
  );
};

// ─── Effect 2: /compact card + binary squeeze ─────────────────────────────
const CompactCard = ({ frame, fps }) => {
  const startF = 15.5 * fps;
  const endF = 21.0 * fps;
  if (!inWindow(frame, 15.5, 21.0, fps)) return null;

  const local = frame - startF;
  const total = endF - startF;
  const enterDur = 12;
  const exitStart = total - 12;

  const cardOpacity = interpolate(
    local, [0, enterDur, exitStart, total],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const cardY = interpolate(local, [0, enterDur], [60, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });
  const cardBlur = interpolate(local, [0, enterDur], [5, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Binary squeeze pulse — 0.7 to 1.0 oscillation, gentle
  const pulsePhase = Math.max(0, local - enterDur);
  const squeezePulse = (Math.sin(pulsePhase * 0.16) + 1) / 2;
  const squeezeY = 1 - squeezePulse * 0.32;
  const gapY = 6 + (1 - squeezePulse) * 6;

  // Stable binary pattern (no rerender churn)
  const bits = ['1','0','1','1','0','0','1','0','1','1','0','1'];

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {/* Bottom card */}
      <div style={{
        position: 'absolute',
        left: '50%',
        bottom: 240,
        transform: `translateX(-50%) translateY(${cardY}px)`,
        opacity: cardOpacity,
        filter: `blur(${cardBlur}px)`,
        padding: '26px 56px',
        background: 'rgba(8, 14, 30, 0.78)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 22,
        border: '1.5px solid rgba(0, 138, 255, 0.55)',
        boxShadow: '0 22px 44px rgba(0,0,0,0.50), 0 6px 12px rgba(0,0,0,0.28)',
      }}>
        <div style={{
          fontFamily: 'Consolas, "Courier New", monospace',
          fontSize: 76,
          fontWeight: 700,
          color: '#fff',
          letterSpacing: '0.02em',
          lineHeight: 1.0,
        }}>
          /compact
        </div>
      </div>

      {/* Binary squeeze on right side */}
      <div style={{
        position: 'absolute',
        right: 90,
        top: 700,
        opacity: cardOpacity * 0.95,
        filter: `blur(${cardBlur}px)`,
        transform: `scaleY(${squeezeY})`,
        transformOrigin: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: gapY,
        fontFamily: 'Consolas, "Courier New", monospace',
        fontSize: 38,
        fontWeight: 700,
        color: 'rgba(120, 220, 255, 0.95)',
        textShadow: '0 0 14px rgba(0, 138, 255, 0.65), 0 0 4px rgba(0, 200, 255, 0.85)',
      }}>
        {bits.map((d, i) => {
          const flicker = Math.sin((local + i * 5) * 0.42);
          const op = 0.7 + 0.3 * (flicker + 1) / 2;
          return <span key={i} style={{ opacity: op }}>{d}</span>;
        })}
      </div>
    </AbsoluteFill>
  );
};

// ─── Effect 3: Sub-Agents — 3 paper figures marching L→R ─────────────────
const PaperFigure = ({ tint }) => (
  <svg width="160" height="200" viewBox="0 0 160 200" style={{ display: 'block' }}>
    {/* Body trapezoid */}
    <path
      d="M 24 200 L 40 88 Q 80 78 120 88 L 136 200 Z"
      fill="#f5ecdc" stroke="#bda07a" strokeWidth="2"
    />
    {/* Head */}
    <circle cx="80" cy="46" r="32" fill="#f5ecdc" stroke="#bda07a" strokeWidth="2" />
    {/* Paper crease */}
    <line x1="80" y1="78" x2="80" y2="200" stroke="#cdb692" strokeWidth="1.4" opacity="0.55" />
    {/* Top edge highlight */}
    <path d="M 24 200 L 40 88" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" fill="none" />
    {/* Tint accent — small badge */}
    <circle cx="80" cy="120" r="7" fill={tint} opacity="0.85" />
  </svg>
);

const PaperFigures = ({ frame, fps }) => {
  const startF = 27.5 * fps;
  const endF = 31.5 * fps;
  if (!inWindow(frame, 27.5, 31.5, fps)) return null;

  const local = frame - startF;
  const total = endF - startF;

  const tints = ['rgb(0, 138, 255)', 'rgb(255, 158, 64)', 'rgb(120, 220, 140)'];
  const figureWidth = 160;
  const baseY = 1100;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {[0, 1, 2].map((i) => {
        const stagger = 6;
        const figLocal = local - i * stagger;
        if (figLocal < 0) return null;

        const window = total - i * stagger;
        const marchProg = interpolate(figLocal, [0, window], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_DRAWER,
        });
        const x = -200 + marchProg * 1500;

        // Subtle bob — alternating "step" bob
        const bobPhase = figLocal * 0.55 + i * 1.2;
        const bob = Math.sin(bobPhase) * 9;

        // Motion blur in / out — moderate during travel
        const mid = window / 2;
        const blur = figLocal < 8
          ? interpolate(figLocal, [0, 8], [6, 1.5], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
          : figLocal > window - 8
            ? interpolate(figLocal, [window - 8, window], [1.5, 6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
            : 1.5;

        // Slight rotation alternates per step for "marching" feel
        const tilt = Math.sin(bobPhase) * 2.5;

        return (
          <div key={i} style={{
            position: 'absolute',
            left: x,
            top: baseY + bob,
            width: figureWidth,
            transform: `rotate(${tilt}deg)`,
            filter: `blur(${blur}px) drop-shadow(0 18px 32px rgba(0,0,0,0.38)) drop-shadow(0 5px 10px rgba(0,0,0,0.25))`,
          }}>
            <PaperFigure tint={tints[i]} />
          </div>
        );
      })}

      {/* Subtitle pill below */}
      <div style={{
        position: 'absolute',
        left: '50%',
        top: 1340,
        transform: 'translateX(-50%)',
        opacity: interpolate(local, [4, 14, total - 14, total - 4], [0, 1, 1, 0], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        }),
        padding: '12px 28px',
        background: 'rgba(8, 14, 30, 0.78)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderRadius: 999,
        border: '1px solid rgba(255, 255, 255, 0.22)',
        boxShadow: '0 14px 30px rgba(0,0,0,0.4), 0 4px 8px rgba(0,0,0,0.22)',
        fontFamily: 'Arial, sans-serif',
        fontWeight: 800,
        fontSize: 38,
        color: '#fff',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}>
        sub-agents
      </div>
    </AbsoluteFill>
  );
};

// ─── Effect 4: Opus glistening typed text ────────────────────────────────
const OpusGlisten = ({ frame, fps }) => {
  const startF = 34.5 * fps;
  const endF = 40.0 * fps;
  if (!inWindow(frame, 34.5, 40.0, fps)) return null;

  const local = frame - startF;
  const total = endF - startF;

  // Typewriter reveal
  const text = 'Opus';
  const typeStart = 4;
  const charPace = 5;
  const visibleChars = Math.max(
    0,
    Math.min(text.length, Math.floor((local - typeStart) / charPace))
  );
  const visibleText = text.slice(0, visibleChars);

  // Caret blink
  const caretPhase = Math.floor(local / 6) % 2;
  const caretOn = visibleChars < text.length || caretPhase === 0;

  // Shine sweep — gradient stop position oscillating from -20% to 120%
  const shineProgress = ((local % 70) / 70); // 0 to 1, repeats every ~3s
  const shineCenter = -20 + shineProgress * 160;

  const containerOpacity = interpolate(
    local, [0, 8, total - 14, total],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Subtle scale-in on the whole word
  const wordScale = interpolate(local, [0, 18], [0.96, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  return (
    <AbsoluteFill style={{
      pointerEvents: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        opacity: containerOpacity,
        transform: `scale(${wordScale})`,
        position: 'relative',
        display: 'flex',
        alignItems: 'baseline',
      }}>
        <div style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 240,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1.0,
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
          filter: 'drop-shadow(0 10px 28px rgba(255, 200, 80, 0.30)) drop-shadow(0 3px 8px rgba(0, 0, 0, 0.55))',
        }}>
          {visibleText || '​'}
        </div>
        {/* Caret */}
        <div style={{
          width: 6,
          height: 180,
          marginLeft: 14,
          marginBottom: 14,
          background: 'rgba(255, 240, 200, 0.92)',
          opacity: caretOn ? 0.85 : 0,
          borderRadius: 3,
          boxShadow: '0 0 18px rgba(255, 220, 130, 0.55)',
        }} />
      </div>
    </AbsoluteFill>
  );
};

// ─── Effect 0: Intro title card (0–2.0s) — @omgluka-style multi-tier ─────
const IntroTitleCard = ({ frame, fps }) => {
  const endF = 2.0 * fps; // 48 frames at 24fps
  if (frame > endF + 6) return null;

  const enterDur = 8;
  const exitStart = endF - 8;

  // Container fade
  const containerOpacity = interpolate(
    frame, [0, enterDur, exitStart, endF],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Layer hierarchy mirrors @omgluka: small / DISPLAY / small / PIXEL / subtext
  const layers = [
    {
      key: 'youre', text: "You're", delay: 0,
      style: {
        fontFamily: 'Arial, sans-serif', fontWeight: 400, fontSize: 38,
        color: '#fff', letterSpacing: '0.01em',
        textShadow: '0 3px 10px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.65)',
        marginBottom: 8,
      },
    },
    {
      key: 'burning', text: 'BURNING THROUGH', delay: 4,
      style: {
        fontFamily: '"Bebas Neue", Impact, "Arial Narrow", sans-serif',
        fontWeight: 700, fontSize: 138, color: '#FFC233',
        lineHeight: 0.92, letterSpacing: '0.01em',
        textShadow: '0 8px 26px rgba(0,0,0,0.55), 0 3px 8px rgba(0,0,0,0.7)',
      },
    },
    {
      key: 'your', text: 'your', delay: 8,
      style: {
        fontFamily: 'Arial, sans-serif', fontWeight: 400, fontSize: 32,
        color: '#fff', letterSpacing: '0.01em',
        textShadow: '0 3px 10px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.65)',
        margin: '8px 0',
      },
    },
    {
      key: 'cloudcode', type: 'pixelblock', text: 'CLOUD CODE', delay: 10,
    },
    {
      key: 'subtext', text: 'context is bloated.', delay: 14,
      style: {
        fontFamily: 'Arial, sans-serif', fontWeight: 400, fontSize: 30,
        color: 'rgba(255, 255, 255, 0.62)', letterSpacing: '0.025em',
        marginTop: 28,
        textShadow: '0 2px 8px rgba(0,0,0,0.55)',
      },
    },
  ];

  return (
    <AbsoluteFill style={{
      pointerEvents: 'none',
      opacity: containerOpacity,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 60px',
      textAlign: 'center',
    }}>
      {layers.map((layer) => {
        if (layer.type === 'pixelblock') {
          // Per-pixel entry handles its own stagger; container fade handles exit.
          return (
            <div key={layer.key} style={{
              display: 'flex', justifyContent: 'center',
              margin: '14px 0 4px',
            }}>
              <PixelBlockText
                text={layer.text}
                frame={frame}
                startFrame={layer.delay}
                pixelSize={14}
                gap={2}
              />
            </div>
          );
        }
        const cl = frame - layer.delay;
        const op = interpolate(cl, [0, 6], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        const ty = interpolate(cl, [0, 6], [14, 0], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
        });
        const sc = interpolate(cl, [0, 6], [0.97, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
        });
        const blur = interpolate(cl, [0, 6], [3, 0], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        return (
          <div key={layer.key} style={{
            ...layer.style,
            opacity: op,
            transform: `translateY(${ty}px) scale(${sc})`,
            filter: `blur(${blur}px)`,
          }}>
            {layer.text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// ─── Master composition ───────────────────────────────────────────────────
export const PracticeOverlay007 = () => {
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
      <PaperFigures frame={frame} fps={fps} />
      <OpusGlisten frame={frame} fps={fps} />
    </AbsoluteFill>
  );
};

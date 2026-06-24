// ─── KaraokeCard ─────────────────────────────────────────────────────────
// Glass-morphism card with karaoke-revealed body words and one yellow hero
// word that gets the underline-draw treatment. Used for Subject beats (2/3/4)
// where the message is short and has one anchor word worth amplifying.
//
// Position presets — pick to keep the talking head visible:
//   'bottom-left'  (default — left-aligned, talking-head right side)
//   'bottom-right' (right-aligned)
//   'top-left'
//   'top-right'
//
// The hero word styling (yellow + underline + size bump) matches the canonical
// Skyframe palette. Other body words karaoke from cyan→white as they enter.

import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { EASE_OUT, SKYFRAME_PALETTE, inWindow } from './_helpers.jsx';

const POSITIONS = {
  'bottom-left':  { left: 50,  top: 660,  textAlign: 'left' },
  'bottom-right': { left: 540, top: 660,  textAlign: 'left' },
  'top-left':     { left: 50,  top: 220,  textAlign: 'left' },
  'top-right':    { left: 540, top: 220,  textAlign: 'left' },
};

export const KaraokeCard = ({
  frame,
  fps,
  startSec,
  endSec,
  eyebrow = '',
  words = [],
  heroWord = '',
  position = 'bottom-left',
  heroColor = SKYFRAME_PALETTE.hero,
  heroGlow = SKYFRAME_PALETTE.heroGlow,
  accentColor = SKYFRAME_PALETTE.accent,
  accentGlow = SKYFRAME_PALETTE.accentGlow,
  cardWidth = 540,
}) => {
  if (!inWindow(frame, startSec, endSec, fps)) return null;

  const startF = startSec * fps;
  const endF = endSec * fps;
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

  const wordStart = enterDur + 4;
  const wordStagger = 7;
  const pos = POSITIONS[position] || POSITIONS['bottom-left'];

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute',
        left: pos.left,
        top: pos.top,
        width: cardWidth,
        opacity: cardOpacity,
        transform: `translateY(${cardY}px) scale(${cardScale})`,
        filter: `blur(${cardBlur}px)`,
        background: 'rgba(18, 26, 48, 0.32)',
        backdropFilter: 'blur(28px) saturate(1.25)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.25)',
        borderRadius: 30,
        border: '1px solid rgba(255, 255, 255, 0.20)',
        boxShadow: '0 22px 52px rgba(0,0,0,0.42), 0 6px 14px rgba(0,0,0,0.22)',
        padding: '32px 30px',
        textAlign: pos.textAlign,
      }}>
        {eyebrow && (
          <div style={{
            fontFamily: 'Inter, Arial, sans-serif', fontWeight: 700, fontSize: 22,
            letterSpacing: '0.18em', color: accentColor,
            marginBottom: 12, textTransform: 'uppercase',
            textShadow: `0 0 14px ${accentGlow}`,
          }}>
            {eyebrow}
          </div>
        )}
        <div style={{
          fontFamily: 'Inter, Arial, sans-serif', fontWeight: 900, fontSize: 58,
          color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.04,
          textShadow: '0 4px 10px rgba(0,0,0,0.35)',
        }}>
          {words.map((word, i) => {
            const isHero = word === heroWord;
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
            const underlineProg = isHero
              ? interpolate(cl, [12, 26], [0, 1], {
                  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
                })
              : 0;
            const cyan = interpolate(cl, [0, 6, 14], [1, 1, 0], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            });
            const r = Math.round(255 * (1 - cyan) + 0 * cyan);
            const g = Math.round(255 * (1 - cyan) + 200 * cyan);
            const b = Math.round(255 * (1 - cyan) + 255 * cyan);
            return (
              <span key={i} style={{
                position: 'relative',
                display: 'inline-block',
                opacity: op,
                transform: `translateY(${ty}px) scale(${sc})`,
                color: isHero ? heroColor : `rgb(${r}, ${g}, ${b})`,
                fontSize: isHero ? 76 : 'inherit',
                fontWeight: isHero ? 900 : 'inherit',
                lineHeight: isHero ? 1.0 : 'inherit',
                marginRight: '0.28em',
                marginTop: isHero ? 4 : 0,
                whiteSpace: 'pre',
                textShadow: isHero
                  ? `0 4px 14px rgba(0,0,0,0.5), 0 0 22px ${heroGlow}`
                  : '0 4px 10px rgba(0,0,0,0.35)',
              }}>
                {word}
                {isHero && (
                  <div style={{
                    position: 'absolute',
                    left: 0,
                    bottom: -4,
                    height: 5,
                    width: `${underlineProg * 100}%`,
                    background: heroColor,
                    borderRadius: 1,
                    boxShadow: `0 0 14px ${heroGlow}`,
                  }} />
                )}
              </span>
            );
          })}
        </div>
        <div style={{
          marginTop: 20, height: 2, width: 72,
          background: accentColor, opacity: 0.7, borderRadius: 2,
        }} />
      </div>
    </AbsoluteFill>
  );
};

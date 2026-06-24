import React from 'react';
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  interpolateColors,
  Easing,
  random,
  AbsoluteFill,
} from 'remotion';

// ═══════════════════════════════════════════════════════════
// BEAT 2 — THE FAILURE
// An overhyped idea collapses under scrutiny.
// Glowing document → cracks → shatters → red X
// Emotion: setback → hard-earned wisdom
// ═══════════════════════════════════════════════════════════

const SKY = {
  yellow: '#ffff00',
  cyan: '#00ffff',
  white: '#ffffff',
  muted: '#cccccc',
  red: '#ff3344',
  redGlow: 'rgba(255,51,68,0.4)',
};

const GENTLE = { damping: 20, stiffness: 80, mass: 1 };
const SNAPPY = { damping: 12, stiffness: 100, mass: 0.8 };

// Document shape: a rectangle with "text lines" inside
const DOC_W = 320;
const DOC_H = 420;
const DOC_X = 960 - DOC_W / 2;
const DOC_Y = 280;

// Crack lines across the document
const CRACKS = [
  { x1: 0.1, y1: 0.3, x2: 0.9, y2: 0.35 },
  { x1: 0.2, y1: 0.0, x2: 0.15, y2: 1.0 },
  { x1: 0.5, y1: 0.2, x2: 0.85, y2: 0.8 },
  { x1: 0.0, y1: 0.6, x2: 0.6, y2: 0.65 },
  { x1: 0.7, y1: 0.1, x2: 0.4, y2: 0.9 },
];

// Shattered fragments (offset from original position after shatter)
const FRAGMENTS = Array.from({ length: 12 }, (_, i) => ({
  startX: random(`fx${i}`) * DOC_W - DOC_W / 2,
  startY: random(`fy${i}`) * DOC_H - DOC_H / 2,
  driftX: (random(`fdx${i}`) - 0.5) * 600,
  driftY: random(`fdy${i}`) * 400 + 100,
  rot: (random(`fr${i}`) - 0.5) * 120,
  w: 30 + random(`fw${i}`) * 60,
  h: 20 + random(`fh${i}`) * 50,
}));

// Dust particles
const DUST = Array.from({ length: 40 }, (_, i) => ({
  x: random(`dx${i}`) * 1920,
  y: random(`dy${i}`) * 1080,
  size: 1.5 + random(`ds${i}`) * 2.5,
  speed: 0.5 + random(`dv${i}`) * 1,
  phase: random(`dp${i}`) * Math.PI * 2,
  baseAlpha: 0.05 + random(`da${i}`) * 0.08,
}));

export const Beat02Failure = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(frame, [durationInFrames - 30, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const master = fadeIn * fadeOut;

  // Phase timing
  // 0-60: Document appears, glows golden (the hype)
  // 60-130: Cracks appear across the document
  // 130-180: Document shatters, fragments fly
  // 180-230: Red X slams down
  // 230-270: Text: "HUMILIATION → WISDOM"
  // 270-300: Fade out

  // Document entry
  const docEntry = Math.min(1, Math.max(0, spring({
    frame: frame - 10, fps, config: GENTLE,
  })));

  // Document glow (golden hype, then fades)
  const hypeGlow = interpolate(frame, [20, 50, 70, 100], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Crack progress (staggered)
  const crackProgress = CRACKS.map((_, i) => {
    return interpolate(frame, [65 + i * 10, 85 + i * 10], [0, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    });
  });

  // Shatter (document opacity drops, fragments appear)
  const shatterStart = 135;
  const docShatter = interpolate(frame, [shatterStart, shatterStart + 8], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const fragmentProgress = interpolate(frame, [shatterStart, shatterStart + 60], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // Red X
  const xEntry = Math.min(1, Math.max(0, spring({
    frame: frame - 185, fps, config: { damping: 10, stiffness: 200, mass: 0.6 },
  })));
  const xShake = frame >= 185 && frame <= 195
    ? Math.sin((frame - 185) * 3) * (195 - frame) * 0.4
    : 0;

  // Text
  const t1 = Math.min(1, Math.max(0, spring({ frame: frame - 210, fps, config: GENTLE })));
  const t2 = Math.min(1, Math.max(0, spring({ frame: frame - 228, fps, config: GENTLE })));
  const textOut = interpolate(frame, [durationInFrames - 50, durationInFrames - 18], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: master }}>
      {/* Background */}
      <AbsoluteFill style={{
        background: 'radial-gradient(ellipse at 50% 40%, #1a1418 0%, #0f0a0c 55%, #000000 100%)',
      }} />

      {/* Dust */}
      {DUST.map((d, i) => {
        const px = d.x + Math.sin(frame * 0.008 * d.speed + d.phase) * 20;
        const py = d.y + Math.cos(frame * 0.006 * d.speed + d.phase * 1.3) * 14;
        const dOp = interpolate(frame, [5, 40], [0, d.baseAlpha], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        return (
          <div key={`d${i}`} style={{
            position: 'absolute', left: px, top: py,
            width: d.size, height: d.size, borderRadius: '50%',
            backgroundColor: i % 6 === 0 ? SKY.red : SKY.cyan,
            opacity: dOp,
          }} />
        );
      })}

      {/* Document (pre-shatter) */}
      {docShatter > 0 && (
        <div style={{
          position: 'absolute', left: DOC_X, top: DOC_Y,
          width: DOC_W, height: DOC_H,
          borderRadius: 12,
          backgroundColor: '#1a1a2a',
          border: `2px solid ${interpolateColors(hypeGlow, [0, 1], ['rgba(255,255,255,0.15)', SKY.yellow])}`,
          opacity: docEntry * docShatter,
          transform: `scale(${docEntry})`,
          boxShadow: hypeGlow > 0
            ? `0 0 ${30 * hypeGlow}px rgba(255,255,0,${0.3 * hypeGlow})`
            : 'none',
          overflow: 'hidden',
        }}>
          {/* Fake text lines */}
          {Array.from({ length: 14 }, (_, i) => (
            <div key={`line${i}`} style={{
              position: 'absolute',
              left: i === 0 ? 40 : 30,
              top: 30 + i * 28,
              width: i === 0 ? 200 : (140 + random(`lw${i}`) * 120),
              height: i === 0 ? 14 : 8,
              borderRadius: 4,
              backgroundColor: i === 0
                ? interpolateColors(hypeGlow, [0, 1], ['#444', SKY.yellow])
                : `rgba(255,255,255,${0.08 + random(`lo${i}`) * 0.06})`,
            }} />
          ))}

          {/* "PATENT" header */}
          <div style={{
            position: 'absolute', top: 25, left: 0, right: 0,
            textAlign: 'center', fontSize: 18, fontWeight: 'bold',
            letterSpacing: 6, color: interpolateColors(hypeGlow, [0, 1], ['#666', SKY.yellow]),
            fontFamily: '"Georgia", serif',
          }}>
            PATENT
          </div>

          {/* Crack SVG overlay */}
          <svg width={DOC_W} height={DOC_H} style={{ position: 'absolute', top: 0, left: 0 }}>
            {CRACKS.map((c, i) => {
              if (crackProgress[i] <= 0) return null;
              const x1 = c.x1 * DOC_W;
              const y1 = c.y1 * DOC_H;
              const x2 = x1 + (c.x2 * DOC_W - x1) * crackProgress[i];
              const y2 = y1 + (c.y2 * DOC_H - y1) * crackProgress[i];
              return (
                <line key={`crack${i}`}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={SKY.red} strokeWidth={2.5}
                  opacity={0.7}
                  style={{ filter: `drop-shadow(0 0 4px ${SKY.redGlow})` }}
                />
              );
            })}
          </svg>
        </div>
      )}

      {/* Shattered fragments */}
      {fragmentProgress > 0 && FRAGMENTS.map((f, i) => {
        const fOp = interpolate(fragmentProgress, [0, 0.3, 0.8, 1], [1, 0.8, 0.4, 0], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        return (
          <div key={`frag${i}`} style={{
            position: 'absolute',
            left: 960 + f.startX + f.driftX * fragmentProgress,
            top: DOC_Y + DOC_H / 2 + f.startY + f.driftY * fragmentProgress,
            width: f.w, height: f.h,
            borderRadius: 3,
            backgroundColor: '#1a1a2a',
            border: '1px solid rgba(255,51,68,0.3)',
            opacity: fOp,
            transform: `rotate(${f.rot * fragmentProgress}deg)`,
          }} />
        );
      })}

      {/* Red X */}
      {xEntry > 0 && (
        <svg width={200} height={200}
          style={{
            position: 'absolute',
            left: 960 - 100 + xShake, top: 440 - 100,
            opacity: xEntry,
            transform: `scale(${xEntry})`,
            filter: `drop-shadow(0 0 20px ${SKY.redGlow})`,
          }}
        >
          <line x1={30} y1={30} x2={170} y2={170} stroke={SKY.red} strokeWidth={16} strokeLinecap="round" />
          <line x1={170} y1={30} x2={30} y2={170} stroke={SKY.red} strokeWidth={16} strokeLinecap="round" />
        </svg>
      )}

      {/* Text */}
      <div style={{
        position: 'absolute', bottom: 140, left: 0, right: 0,
        textAlign: 'center',
        fontFamily: '"Georgia", "Times New Roman", serif',
      }}>
        <div style={{
          fontSize: 42, fontWeight: 'bold', letterSpacing: 3,
          color: SKY.red,
          opacity: t1 * textOut,
          transform: `translateY(${interpolate(t1, [0, 1], [28, 0])}px)`,
          textShadow: `0 0 25px ${SKY.redGlow}`,
        }}>
          THE HYPE WAS A LIE
        </div>
        <div style={{
          fontSize: 36, letterSpacing: 4,
          color: SKY.muted,
          marginTop: 16,
          opacity: t2 * textOut,
          transform: `translateY(${interpolate(t2, [0, 1], [28, 0])}px)`,
        }}>
          BUT THE LESSON WAS REAL
        </div>
      </div>
    </AbsoluteFill>
  );
};

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
// BEAT 10 — THE PIVOT (Single-Turn Hardening)
// A dark wall with a crack of light. Not a ceiling — a
// missing concept. Pivot energy, problem-solving mode.
// ═══════════════════════════════════════════════════════════

const SKY = {
  yellow: '#ffff00',
  cyan: '#00ffff',
  white: '#ffffff',
  muted: '#cccccc',
};

const GENTLE = { damping: 20, stiffness: 80, mass: 1 };

// Wall bricks
const BRICKS = [];
const BRICK_W = 160;
const BRICK_H = 60;
const WALL_LEFT = 560;
const WALL_TOP = 120;
const COLS = 5;
const ROWS = 10;
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const offset = r % 2 === 0 ? 0 : BRICK_W / 2;
    BRICKS.push({
      x: WALL_LEFT + c * BRICK_W + offset,
      y: WALL_TOP + r * BRICK_H,
      distFromCrack: Math.abs((c + (r % 2 === 0 ? 0 : 0.5)) - COLS / 2),
    });
  }
}

// Light rays through the crack
const RAYS = Array.from({ length: 8 }, (_, i) => ({
  angle: -30 + i * 8 + random(`ra${i}`) * 5,
  width: 3 + random(`rw${i}`) * 6,
  length: 300 + random(`rl${i}`) * 400,
  alpha: 0.08 + random(`ro${i}`) * 0.1,
  delay: i * 3,
}));

// Dust
const DUST = Array.from({ length: 30 }, (_, i) => ({
  x: random(`dx${i}`) * 1920,
  y: random(`dy${i}`) * 1080,
  size: 1.5 + random(`ds${i}`) * 2,
  speed: 0.5 + random(`dv${i}`) * 1,
  phase: random(`dp${i}`) * Math.PI * 2,
  baseAlpha: 0.04 + random(`da${i}`) * 0.06,
}));

export const Beat10Pivot = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(frame, [durationInFrames - 30, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const master = fadeIn * fadeOut;

  // Phases:
  // 0-50: Dark wall of bricks builds up (staggered)
  // 50-80: "81.8% CEILING" label appears on wall
  // 80-140: Crack of light appears down the center, widens
  // 140-180: Light rays pour through, wall bricks near crack shift
  // 180-230: Text: "NOT A CEILING — A MISSING CONCEPT"
  // 230-300: Fade out

  // Brick entries (stagger from bottom-up)
  const brickEntries = BRICKS.map((b, i) => {
    const row = Math.floor(i / COLS);
    const delay = 5 + (ROWS - 1 - row) * 3 + (i % COLS) * 1.5;
    return Math.min(1, Math.max(0, spring({
      frame: frame - delay, fps, config: { damping: 15, stiffness: 100, mass: 0.8 },
    })));
  });

  // Ceiling label
  const ceilLabel = Math.min(1, Math.max(0, spring({
    frame: frame - 55, fps, config: GENTLE,
  })));

  // Crack opening
  const crackWidth = interpolate(frame, [85, 140], [0, 12], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const crackGlow = interpolate(frame, [90, 130, 220, 260], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Brick displacement near crack
  const brickShift = BRICKS.map((b) => {
    if (b.distFromCrack > 1.5) return 0;
    const shift = interpolate(frame, [100, 160], [0, (1.5 - b.distFromCrack) * 25], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    });
    return b.x < 960 ? -shift : shift;
  });

  // Light rays
  const rayIntensity = interpolate(frame, [120, 160, 230, 270], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Text
  const t1 = Math.min(1, Math.max(0, spring({ frame: frame - 185, fps, config: GENTLE })));
  const t2 = Math.min(1, Math.max(0, spring({ frame: frame - 202, fps, config: GENTLE })));
  const textOut = interpolate(frame, [durationInFrames - 50, durationInFrames - 18], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const wallCenterX = WALL_LEFT + (COLS * BRICK_W) / 2;

  return (
    <AbsoluteFill style={{ opacity: master }}>
      {/* Background */}
      <AbsoluteFill style={{
        background: 'radial-gradient(ellipse at 50% 50%, #101014 0%, #06060a 55%, #000000 100%)',
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
            backgroundColor: SKY.cyan, opacity: dOp,
          }} />
        );
      })}

      {/* Light rays (behind wall, pour through crack) */}
      {rayIntensity > 0 && (
        <svg width={1920} height={1080} style={{ position: 'absolute' }}>
          {RAYS.map((ray, i) => {
            const rOp = interpolate(frame, [120 + ray.delay, 150 + ray.delay], [0, ray.alpha * rayIntensity], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            });
            const radAngle = (ray.angle * Math.PI) / 180;
            const x1 = wallCenterX;
            const y1 = WALL_TOP + (ROWS * BRICK_H) / 2;
            const x2 = x1 + Math.cos(radAngle) * ray.length;
            const y2 = y1 + Math.sin(radAngle) * ray.length;
            return (
              <line key={`ray${i}`}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={SKY.yellow} strokeWidth={ray.width}
                opacity={rOp}
                strokeLinecap="round"
              />
            );
          })}
        </svg>
      )}

      {/* Wall bricks */}
      {BRICKS.map((brick, i) => {
        const entry = brickEntries[i];
        if (entry <= 0) return null;
        const shift = brickShift[i];
        return (
          <div key={`brick${i}`} style={{
            position: 'absolute',
            left: brick.x + shift, top: brick.y,
            width: BRICK_W - 4, height: BRICK_H - 4,
            borderRadius: 4,
            backgroundColor: '#181820',
            border: '1px solid rgba(255,255,255,0.08)',
            opacity: Math.min(1, entry),
            transform: `scale(${Math.min(1, entry)})`,
          }} />
        );
      })}

      {/* Crack glow line */}
      {crackWidth > 0 && (
        <div style={{
          position: 'absolute',
          left: wallCenterX - crackWidth / 2,
          top: WALL_TOP,
          width: crackWidth,
          height: ROWS * BRICK_H,
          backgroundColor: `rgba(255,255,0,${0.3 * crackGlow})`,
          boxShadow: `0 0 ${30 * crackGlow}px rgba(255,255,0,${0.4 * crackGlow})`,
        }} />
      )}

      {/* Ceiling label on wall */}
      {ceilLabel > 0 && frame < 180 && (
        <div style={{
          position: 'absolute',
          left: wallCenterX - 120, top: WALL_TOP + ROWS * BRICK_H / 2 - 30,
          width: 240, textAlign: 'center',
          fontFamily: '"Courier New", monospace',
          opacity: ceilLabel * interpolate(frame, [120, 150], [1, 0], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          }),
        }}>
          <div style={{ fontSize: 32, fontWeight: 'bold', color: SKY.muted }}>
            81.8%
          </div>
          <div style={{ fontSize: 12, letterSpacing: 4, color: SKY.muted, marginTop: 4 }}>
            CEILING?
          </div>
        </div>
      )}

      {/* Text */}
      <div style={{
        position: 'absolute', bottom: 120, left: 0, right: 0,
        textAlign: 'center', fontFamily: '"Georgia", serif',
      }}>
        <div style={{
          fontSize: 42, fontWeight: 'bold', letterSpacing: 4,
          color: SKY.yellow,
          opacity: t1 * textOut,
          transform: `translateY(${interpolate(t1, [0, 1], [25, 0])}px)`,
          textShadow: '0 0 25px rgba(255,255,0,0.35)',
        }}>
          NOT A CEILING
        </div>
        <div style={{
          fontSize: 38, fontWeight: 'bold', letterSpacing: 4,
          color: SKY.white, marginTop: 14,
          opacity: t2 * textOut,
          transform: `translateY(${interpolate(t2, [0, 1], [25, 0])}px)`,
        }}>
          A MISSING CONCEPT
        </div>
      </div>
    </AbsoluteFill>
  );
};

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
// BEAT 3 — THE REBUILD (ARES is Born)
// The concept wasn't wrong — just the execution.
// Broken code fragments → reassemble into blueprint → ARES
// Emotion: Determination, clarity, discipline
// ═══════════════════════════════════════════════════════════

const SKY = {
  yellow: '#ffff00',
  cyan: '#00ffff',
  white: '#ffffff',
  muted: '#cccccc',
};

const GENTLE = { damping: 20, stiffness: 80, mass: 1 };

// Code fragments: start scattered, converge to center
const FRAGMENTS = Array.from({ length: 16 }, (_, i) => {
  const angle = (i / 16) * Math.PI * 2;
  const dist = 400 + random(`fd${i}`) * 300;
  return {
    scatterX: 960 + Math.cos(angle) * dist,
    scatterY: 540 + Math.sin(angle) * dist,
    targetX: 760 + random(`ftx${i}`) * 400,
    targetY: 300 + random(`fty${i}`) * 360,
    rot: (random(`fr${i}`) - 0.5) * 180,
    width: 60 + random(`fw${i}`) * 100,
    label: ['def', 'class', 'import', 'async', 'return', 'yield',
            'fn()', 'data', 'test', 'parse', 'build', 'run',
            'init', 'load', 'exec', 'emit'][i],
  };
});

// Blueprint grid lines (appear after fragments converge)
const GRID_LINES_H = 8;
const GRID_LINES_V = 6;

// Dust
const DUST = Array.from({ length: 40 }, (_, i) => ({
  x: random(`dx${i}`) * 1920,
  y: random(`dy${i}`) * 1080,
  size: 1.5 + random(`ds${i}`) * 2.5,
  speed: 0.5 + random(`dv${i}`) * 1,
  phase: random(`dp${i}`) * Math.PI * 2,
  baseAlpha: 0.05 + random(`da${i}`) * 0.08,
}));

export const Beat03Rebuild = () => {
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
  // 0-20: Scattered broken fragments visible
  // 20-120: Fragments converge to center (spring)
  // 120-170: Blueprint grid draws around them
  // 170-220: "ARES" text assembles, yellow glow
  // 220-260: Hold + subtitle
  // 260-300: Fade out

  // Fragment convergence
  const fragPositions = FRAGMENTS.map((f, i) => {
    const moveStart = 20 + i * 4;
    const p = Math.min(1, Math.max(0, spring({
      frame: frame - moveStart, fps, config: GENTLE,
    })));
    const entryP = Math.min(1, Math.max(0, spring({
      frame: frame - (5 + i * 1.5), fps, config: { damping: 15, stiffness: 100, mass: 0.8 },
    })));
    return {
      x: interpolate(p, [0, 1], [f.scatterX, f.targetX]),
      y: interpolate(p, [0, 1], [f.scatterY, f.targetY]),
      rot: interpolate(p, [0, 1], [f.rot, 0]),
      color: interpolateColors(p, [0, 0.6, 1], ['rgba(255,51,68,0.3)', 'rgba(0,255,255,0.2)', 'rgba(0,255,255,0.35)']),
      borderColor: interpolateColors(p, [0, 0.6, 1], ['rgba(255,51,68,0.4)', 'rgba(0,255,255,0.3)', 'rgba(0,255,255,0.5)']),
      textColor: interpolateColors(p, [0, 1], ['#664444', SKY.cyan]),
      opacity: entryP,
    };
  });

  // Blueprint grid
  const gridDraw = interpolate(frame, [120, 170], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

  // ARES text
  const aresEntry = Math.min(1, Math.max(0, spring({
    frame: frame - 175, fps, config: { damping: 14, stiffness: 90, mass: 1 },
  })));
  const aresGlow = interpolate(frame, [185, 210, 240, 265], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const aresPulse = aresGlow > 0 ? 0.7 + 0.3 * Math.sin((frame - 185) * 0.35) : 0;

  // Subtitle
  const subEntry = Math.min(1, Math.max(0, spring({
    frame: frame - 210, fps, config: GENTLE,
  })));
  const textOut = interpolate(frame, [durationInFrames - 50, durationInFrames - 18], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: master }}>
      {/* Background */}
      <AbsoluteFill style={{
        background: 'radial-gradient(ellipse at 50% 45%, #0f1420 0%, #080a12 55%, #000000 100%)',
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

      {/* Blueprint grid */}
      {gridDraw > 0 && (
        <svg width={1920} height={1080} style={{ position: 'absolute', opacity: 0.12 * gridDraw }}>
          {Array.from({ length: GRID_LINES_H }, (_, i) => {
            const y = 260 + i * 70;
            const drawP = interpolate(gridDraw, [i / GRID_LINES_H, Math.min(1, (i + 1) / GRID_LINES_H)], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            });
            return (
              <line key={`gh${i}`}
                x1={700} y1={y} x2={700 + 520 * drawP} y2={y}
                stroke={SKY.cyan} strokeWidth={0.8}
              />
            );
          })}
          {Array.from({ length: GRID_LINES_V }, (_, i) => {
            const x = 720 + i * 85;
            const drawP = interpolate(gridDraw, [i / GRID_LINES_V, Math.min(1, (i + 1) / GRID_LINES_V)], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            });
            return (
              <line key={`gv${i}`}
                x1={x} y1={260} x2={x} y2={260 + 490 * drawP}
                stroke={SKY.cyan} strokeWidth={0.8}
              />
            );
          })}
        </svg>
      )}

      {/* Code fragments */}
      {fragPositions.map((pos, i) => (
        <div key={`f${i}`} style={{
          position: 'absolute',
          left: pos.x - FRAGMENTS[i].width / 2,
          top: pos.y - 14,
          width: FRAGMENTS[i].width,
          height: 28,
          borderRadius: 6,
          backgroundColor: pos.color,
          border: `1.5px solid ${pos.borderColor}`,
          opacity: pos.opacity,
          transform: `rotate(${pos.rot}deg)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: '"Courier New", monospace',
          fontSize: 12, fontWeight: 'bold',
          color: pos.textColor,
          letterSpacing: 1,
        }}>
          {FRAGMENTS[i].label}
        </div>
      ))}

      {/* ARES text */}
      <div style={{
        position: 'absolute',
        left: 0, right: 0, top: 360,
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: 96, fontWeight: 'bold', letterSpacing: 20,
          color: SKY.cyan,
          fontFamily: '"Georgia", serif',
          opacity: aresEntry,
          transform: `scale(${0.6 + aresEntry * 0.4})`,
          textShadow: aresGlow > 0
            ? `0 0 ${40 * aresGlow * aresPulse}px rgba(0,255,255,0.5)`
            : 'none',
        }}>
          ARES
        </div>
      </div>

      {/* Subtitle */}
      <div style={{
        position: 'absolute', bottom: 160, left: 0, right: 0,
        textAlign: 'center',
        fontFamily: '"Georgia", serif',
      }}>
        <div style={{
          fontSize: 32, letterSpacing: 4,
          color: SKY.muted,
          opacity: subEntry * textOut,
          transform: `translateY(${interpolate(subEntry, [0, 1], [25, 0])}px)`,
        }}>
          ADVERSARIAL REASONING ENGINE SYSTEM
        </div>
        <div style={{
          fontSize: 26, letterSpacing: 3, marginTop: 14,
          color: interpolateColors(aresGlow, [0, 1], [SKY.muted, SKY.yellow]),
          opacity: subEntry * textOut * 0.8,
          transform: `translateY(${interpolate(subEntry, [0, 1], [25, 0])}px)`,
        }}>
          THE CONCEPT WASN'T WRONG — JUST THE EXECUTION
        </div>
      </div>
    </AbsoluteFill>
  );
};

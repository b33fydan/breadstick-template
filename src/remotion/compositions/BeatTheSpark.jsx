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
// BEAT 1 — THE SPARK
// "What if AI could argue with itself to find the truth?"
//
// Neural network nodes scattered in void → connections form →
// nodes drift into question mark shape → climax glow → text
// ═══════════════════════════════════════════════════════════

// ─── Brand ────────────────────────────────────────────────
const SKY = {
  yellow: '#ffff00',
  cyan: '#00ffff',
  white: '#ffffff',
  muted: '#cccccc',
};

const GENTLE = { damping: 20, stiffness: 80, mass: 1 };
const SNAPPY = { damping: 12, stiffness: 100, mass: 0.8 };

// ─── Node Definitions ─────────────────────────────────────
// 13 "forming" nodes arrange into a "?" shape
// 7 "ambient" nodes float freely for depth
const FORMING = 13;

// [startX, startY, targetX, targetY]
// Start positions are scattered across the 1920x1080 canvas
// Target positions trace a recognizable "?" glyph
const FORMING_NODES = [
  // Top arc of ?
  [180, 120,   860, 310],   // 0: left edge of arc
  [1720, 80,   885, 235],   // 1: upper-left
  [420, 820,   930, 195],   // 2: top-left
  [1480, 620,  990, 185],   // 3: top center
  [80, 520,    1045, 210],  // 4: upper-right
  [1800, 380,  1070, 270],  // 5: right edge
  // Right descent
  [680, 180,   1058, 335],  // 6: descending right
  [1220, 920,  1025, 378],  // 7: curving inward
  [320, 430,   985, 408],   // 8: approaching center
  // Vertical stem
  [1580, 180,  960, 440],   // 9: top of stem
  [780, 740,   960, 475],   // 10: mid stem
  [1120, 280,  960, 510],   // 11: bottom of stem
  // Dot
  [480, 960,   960, 590],   // 12: the dot
];

const AMBIENT_NODES = [
  [140, 280],
  [1760, 780],
  [280, 900],
  [1420, 70],
  [620, 540],
  [1100, 850],
  [50, 720],
];

// ─── Connection edges ─────────────────────────────────────
// [nodeA, nodeB] — drawn as animated lines
const EDGES = [
  // ? path (sequential)
  [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,11],
  // Cross-links (neural network feel)
  [0,2],[1,3],[3,5],[2,4],[7,9],[6,8],
  // Links to ambient nodes (13-19)
  [0,13],[5,14],[11,15],[3,16],[8,17],[6,18],[10,19],
  // Ambient cross-links
  [13,15],[14,16],[17,19],
];

// ─── Ambient particles (depth layer) ──────────────────────
const DUST = Array.from({ length: 50 }, (_, i) => ({
  x: random(`dx${i}`) * 1920,
  y: random(`dy${i}`) * 1080,
  size: 1.5 + random(`ds${i}`) * 2.5,
  speed: 0.5 + random(`dv${i}`) * 1,
  phase: random(`dp${i}`) * Math.PI * 2,
  bright: random(`db${i}`) > 0.8, // 20% are yellow, rest cyan
  baseAlpha: 0.05 + random(`da${i}`) * 0.09,
}));

// ═══════════════════════════════════════════════════════════
// COMPOSITION
// ═══════════════════════════════════════════════════════════

export const BeatTheSpark = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // ── Master fade in / fade out ───────────────────────────
  const fadeIn = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(frame, [durationInFrames - 30, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const master = fadeIn * fadeOut;

  // ── Compute node positions ──────────────────────────────
  const positions = [];

  // Forming nodes: interpolate scattered → question mark
  for (let i = 0; i < FORMING; i++) {
    const [sx, sy, tx, ty] = FORMING_NODES[i];
    const moveStart = 55 + i * 8;
    const moveP = Math.min(1, Math.max(0, spring({
      frame: frame - moveStart, fps, config: GENTLE,
    })));

    const entryDelay = 8 + i * 2;
    const entryP = Math.min(1.15, Math.max(0, spring({
      frame: frame - entryDelay, fps, config: SNAPPY,
    })));

    positions.push({
      x: interpolate(moveP, [0, 1], [sx, tx]),
      y: interpolate(moveP, [0, 1], [sy, ty]),
      color: interpolateColors(moveP, [0, 0.4, 1], [SKY.cyan, '#44ddbb', SKY.yellow]),
      glow: interpolateColors(moveP, [0, 1], ['rgba(0,255,255,0.35)', 'rgba(255,255,0,0.45)']),
      opacity: Math.min(1, entryP),
      scale: Math.min(1.08, entryP),
      forming: true,
    });
  }

  // Ambient nodes: gentle drift
  for (let i = 0; i < AMBIENT_NODES.length; i++) {
    const [ax, ay] = AMBIENT_NODES[i];
    const entryDelay = 14 + i * 5;
    const entryP = Math.min(1, Math.max(0, spring({
      frame: frame - entryDelay, fps, config: GENTLE,
    })));
    const dx = Math.sin(frame * 0.012 + i * 2.5) * 15;
    const dy = Math.cos(frame * 0.009 + i * 1.8) * 10;

    positions.push({
      x: ax + dx,
      y: ay + dy,
      color: SKY.cyan,
      glow: 'rgba(0,255,255,0.25)',
      opacity: entryP * 0.5,
      scale: Math.min(1, entryP),
      forming: false,
    });
  }

  // ── Climax pulse (frames 185–250) ───────────────────────
  const climax = interpolate(frame, [185, 205, 240, 260], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const pulse = climax > 0 ? 0.65 + 0.35 * Math.sin((frame - 185) * 0.38) : 0;
  const glowR = climax * pulse * 28;

  // ── Text springs ────────────────────────────────────────
  const t1 = Math.min(1, Math.max(0, spring({
    frame: frame - 200, fps, config: GENTLE,
  })));
  const t2 = Math.min(1, Math.max(0, spring({
    frame: frame - 218, fps, config: GENTLE,
  })));
  const textOut = interpolate(frame, [durationInFrames - 50, durationInFrames - 18], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: master }}>

      {/* ── Background gradient ── */}
      <AbsoluteFill style={{
        background:
          'radial-gradient(ellipse at 50% 42%, #141428 0%, #0a0a14 55%, #000000 100%)',
      }} />

      {/* ── Subtle grid ── */}
      <svg width={1920} height={1080}
        style={{ position: 'absolute', opacity: 0.03 }}
      >
        {Array.from({ length: 25 }, (_, i) => (
          <React.Fragment key={`g${i}`}>
            <line
              x1={0} y1={i * 45} x2={1920} y2={i * 45}
              stroke="#ffffff" strokeWidth={0.5}
            />
            <line
              x1={i * 80} y1={0} x2={i * 80} y2={1080}
              stroke="#ffffff" strokeWidth={0.5}
            />
          </React.Fragment>
        ))}
      </svg>

      {/* ── Dust particles ── */}
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
            backgroundColor: d.bright ? SKY.yellow : SKY.cyan,
            opacity: dOp,
          }} />
        );
      })}

      {/* ── Connection lines (SVG) ── */}
      <svg width={1920} height={1080} style={{ position: 'absolute' }}>
        <defs>
          <filter id="edgeGlow">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {EDGES.map(([a, b], i) => {
          const delay = 28 + i * 2.5;
          const draw = interpolate(frame, [delay, delay + 28], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            easing: Easing.inOut(Easing.cubic),
          });
          if (draw <= 0) return null;

          const pa = positions[a];
          const pb = positions[b];
          if (!pa || !pb) return null;
          const baseOp = Math.min(pa.opacity, pb.opacity) * 0.4 * draw;

          // Color follows forming progress
          const bothForming = a < FORMING && b < FORMING;
          let edgeColor = SKY.cyan;
          if (bothForming) {
            const fp = Math.min(1, Math.max(0, spring({
              frame: frame - (55 + Math.min(a, b) * 8), fps, config: GENTLE,
            })));
            edgeColor = interpolateColors(fp, [0, 1], [SKY.cyan, SKY.yellow]);
          }

          const hot = bothForming && climax > 0.3;

          return (
            <line key={`e${i}`}
              x1={pa.x} y1={pa.y}
              x2={pa.x + (pb.x - pa.x) * draw}
              y2={pa.y + (pb.y - pa.y) * draw}
              stroke={edgeColor}
              strokeWidth={hot ? 2.5 : 1.5}
              opacity={baseOp + (hot ? climax * 0.25 : 0)}
              filter={hot ? 'url(#edgeGlow)' : undefined}
            />
          );
        })}
      </svg>

      {/* ── Nodes ── */}
      {positions.map((pos, i) => {
        const size = i === 12 ? 16 : (pos.forming ? 11 : 7);
        const gR = pos.forming ? 8 + glowR : 5;
        return (
          <div key={`n${i}`} style={{
            position: 'absolute',
            left: pos.x - size / 2,
            top: pos.y - size / 2,
            width: size, height: size, borderRadius: '50%',
            backgroundColor: pos.color,
            border: `1.5px solid rgba(255,255,255,${
              pos.forming ? 0.22 + climax * 0.28 : 0.12
            })`,
            opacity: pos.opacity,
            transform: `scale(${pos.scale})`,
            boxShadow: `0 0 ${gR}px ${pos.glow}`,
          }} />
        );
      })}

      {/* ── Climax: radial glow behind the ? ── */}
      {climax > 0 && (
        <div style={{
          position: 'absolute',
          left: 960 - 160, top: 390 - 160,
          width: 320, height: 320, borderRadius: '50%',
          background: `radial-gradient(circle,
            rgba(255,255,0,${0.1 * climax * pulse}) 0%,
            rgba(255,255,0,${0.04 * climax * pulse}) 40%,
            transparent 70%)`,
          pointerEvents: 'none',
        }} />
      )}

      {/* ── Text ── */}
      <div style={{
        position: 'absolute', bottom: 140, left: 0, right: 0,
        textAlign: 'center',
        fontFamily: '"Georgia", "Times New Roman", serif',
      }}>
        {/* Line 1 */}
        <div style={{
          fontSize: 44, fontWeight: 'bold', letterSpacing: 3,
          color: SKY.white,
          opacity: t1 * textOut,
          transform: `translateY(${interpolate(t1, [0, 1], [28, 0])}px)`,
          textShadow: '0 0 25px rgba(255,255,0,0.2)',
        }}>
          WHAT IF AI COULD ARGUE WITH ITSELF
        </div>
        {/* Line 2 */}
        <div style={{
          fontSize: 52, fontWeight: 'bold', letterSpacing: 5,
          color: SKY.yellow,
          marginTop: 16,
          opacity: t2 * textOut,
          transform: `translateY(${interpolate(t2, [0, 1], [28, 0])}px)`,
          textShadow: '0 0 35px rgba(255,255,0,0.45)',
        }}>
          TO FIND THE TRUTH?
        </div>
      </div>
    </AbsoluteFill>
  );
};

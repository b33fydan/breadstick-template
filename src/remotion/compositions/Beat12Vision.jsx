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
// BEAT 12 — THE VISION (ARES-VISION / AKIRA Core)
// Data made visible. Three.js real-time 3D rendering.
// Evidence particles color-coded by kill chain stage.
// Neon particle streams flowing L→R. AKIRA-inspired.
// Emotion: Wonder, beauty, the art of engineering
// ═══════════════════════════════════════════════════════════

const SKY = {
  yellow: '#ffff00',
  cyan: '#00ffff',
  white: '#ffffff',
  muted: '#cccccc',
};

const GENTLE = { damping: 20, stiffness: 80, mass: 1 };

// Kill chain colors for particles
const KC_COLORS = [
  '#4488ff',  // Reconnaissance (blue)
  '#00ccff',  // Vulnerability (cyan)
  '#ff8844',  // Exploitation (orange-red)
  '#ffffff',  // Post-exploitation (white)
];

// Particle streams — 4 horizontal lanes, L→R
const LANES = [
  { y: 280, color: KC_COLORS[0], label: 'RECON', count: 18 },
  { y: 420, color: KC_COLORS[1], label: 'VULN', count: 15 },
  { y: 560, color: KC_COLORS[2], label: 'EXPLOIT', count: 12 },
  { y: 700, color: KC_COLORS[3], label: 'POST', count: 8 },
];

// Generate particles per lane
const PARTICLES = LANES.flatMap((lane, li) =>
  Array.from({ length: lane.count }, (_, pi) => ({
    lane: li,
    laneY: lane.y,
    color: lane.color,
    offset: random(`po${li}-${pi}`) * 200,
    yDrift: (random(`py${li}-${pi}`) - 0.5) * 60,
    size: 4 + random(`ps${li}-${pi}`) * 6,
    speed: 2 + random(`pv${li}-${pi}`) * 3,
    phase: random(`pp${li}-${pi}`) * 1920,
    trail: 20 + random(`pt${li}-${pi}`) * 40,
  }))
);

// Background grid nodes (simulating a 3D graph)
const GRAPH_NODES = Array.from({ length: 20 }, (_, i) => ({
  x: 100 + random(`gx${i}`) * 1720,
  y: 100 + random(`gy${i}`) * 880,
  size: 3 + random(`gs${i}`) * 4,
  connections: Math.floor(random(`gc${i}`) * 3),
}));

export const Beat12Vision = () => {
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
  // 0-40: Background graph nodes fade in
  // 20-280: Particle streams flow L→R continuously
  // 40-80: Lane labels appear on left
  // 160-220: Glow intensifies, "ARES-VISION" text
  // 220-260: Subtitle text
  // 260-300: Fade out

  // Graph node opacity
  const graphOp = interpolate(frame, [5, 35], [0, 0.08], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Lane label entries
  const laneLabels = LANES.map((_, i) => {
    return Math.min(1, Math.max(0, spring({
      frame: frame - (45 + i * 10), fps, config: GENTLE,
    })));
  });

  // Overall intensity ramp
  const intensity = interpolate(frame, [20, 80, 250, 280], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Climax glow
  const climaxGlow = interpolate(frame, [160, 190, 250, 275], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Text
  const t1 = Math.min(1, Math.max(0, spring({ frame: frame - 170, fps, config: GENTLE })));
  const t2 = Math.min(1, Math.max(0, spring({ frame: frame - 225, fps, config: GENTLE })));
  const textOut = interpolate(frame, [durationInFrames - 50, durationInFrames - 18], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: master }}>
      {/* Background — darker, AKIRA-inspired */}
      <AbsoluteFill style={{
        background: 'radial-gradient(ellipse at 50% 50%, #0a0814 0%, #050408 55%, #000000 100%)',
      }} />

      {/* Background graph nodes */}
      <svg width={1920} height={1080} style={{ position: 'absolute', opacity: graphOp }}>
        {GRAPH_NODES.map((node, i) => (
          <React.Fragment key={`gn${i}`}>
            <circle cx={node.x} cy={node.y} r={node.size} fill="#ffffff" opacity={0.3} />
            {/* Connect to next nodes */}
            {Array.from({ length: node.connections }, (_, j) => {
              const target = GRAPH_NODES[(i + j + 1) % GRAPH_NODES.length];
              return (
                <line key={`gl${i}-${j}`}
                  x1={node.x} y1={node.y} x2={target.x} y2={target.y}
                  stroke="#ffffff" strokeWidth={0.5} opacity={0.15}
                />
              );
            })}
          </React.Fragment>
        ))}
      </svg>

      {/* Lane guide lines */}
      {LANES.map((lane, i) => (
        <div key={`lane${i}`} style={{
          position: 'absolute', left: 160, right: 100,
          top: lane.y, height: 1,
          backgroundColor: lane.color,
          opacity: 0.06 * intensity,
        }} />
      ))}

      {/* Particle streams */}
      {PARTICLES.map((p, i) => {
        const cycleLen = 1920 / p.speed;
        const x = ((frame * p.speed + p.phase) % (1920 + p.trail * 2)) - p.trail;
        const y = p.laneY + p.yDrift + Math.sin(frame * 0.03 + i) * 8;
        const pOp = interpolate(x, [-p.trail, 0, 1800, 1920], [0, 1, 1, 0], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        }) * intensity;
        if (pOp <= 0) return null;
        return (
          <React.Fragment key={`p${i}`}>
            {/* Trail */}
            <div style={{
              position: 'absolute',
              left: x - p.trail, top: y - 1,
              width: p.trail, height: 2,
              background: `linear-gradient(to right, transparent, ${p.color})`,
              opacity: pOp * 0.4,
            }} />
            {/* Particle head */}
            <div style={{
              position: 'absolute',
              left: x - p.size / 2, top: y - p.size / 2,
              width: p.size, height: p.size, borderRadius: '50%',
              backgroundColor: p.color,
              opacity: pOp,
              boxShadow: `0 0 ${6 + climaxGlow * 8}px ${p.color}`,
            }} />
          </React.Fragment>
        );
      })}

      {/* Lane labels (left side) */}
      {LANES.map((lane, i) => (
        <div key={`ll${i}`} style={{
          position: 'absolute', left: 60, top: lane.y - 10,
          fontFamily: '"Courier New", monospace',
          fontSize: 12, fontWeight: 'bold', letterSpacing: 3,
          color: lane.color,
          opacity: laneLabels[i] * 0.7,
          transform: `translateX(${interpolate(laneLabels[i], [0, 1], [-15, 0])}px)`,
        }}>
          {lane.label}
        </div>
      ))}

      {/* ARES-VISION text */}
      <div style={{
        position: 'absolute', top: 100, left: 0, right: 0,
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: 64, fontWeight: 'bold', letterSpacing: 12,
          color: SKY.yellow,
          fontFamily: '"Georgia", serif',
          opacity: t1 * textOut,
          transform: `scale(${0.8 + t1 * 0.2})`,
          textShadow: climaxGlow > 0
            ? `0 0 ${40 * climaxGlow}px rgba(255,255,0,0.5)`
            : '0 0 15px rgba(255,255,0,0.2)',
        }}>
          ARES-VISION
        </div>
      </div>

      {/* Subtitle */}
      <div style={{
        position: 'absolute', bottom: 100, left: 0, right: 0,
        textAlign: 'center', fontFamily: '"Georgia", serif',
      }}>
        <div style={{
          fontSize: 32, letterSpacing: 4,
          color: SKY.white,
          opacity: t2 * textOut,
          transform: `translateY(${interpolate(t2, [0, 1], [25, 0])}px)`,
        }}>
          DATA MADE VISIBLE
        </div>
      </div>
    </AbsoluteFill>
  );
};

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
// BEAT 4 — THE ARENA (The Trident)
// Three agents: Architect (prosecution), Skeptic (defense),
// OracleJudge (math-only verdict). Triangle with energy.
// Emotion: Tension, intellectual combat, structure
// ═══════════════════════════════════════════════════════════

const SKY = {
  yellow: '#ffff00',
  cyan: '#00ffff',
  white: '#ffffff',
  muted: '#cccccc',
};

const GENTLE = { damping: 20, stiffness: 80, mass: 1 };

// Three agents positioned in triangle
const AGENTS = [
  { x: 960, y: 220, label: 'ARCHITECT', role: 'Prosecution', color: '#00ff88', glow: 'rgba(0,255,136,0.4)' },
  { x: 560, y: 680, label: 'SKEPTIC', role: 'Defense', color: '#ff4466', glow: 'rgba(255,68,102,0.4)' },
  { x: 1360, y: 680, label: 'ORACLE', role: 'Judge', color: '#ffff00', glow: 'rgba(255,255,0,0.4)' },
];

// Energy bolts between agents (pairs)
const BOLTS = [[0, 1], [1, 2], [2, 0]];

// Dust
const DUST = Array.from({ length: 40 }, (_, i) => ({
  x: random(`dx${i}`) * 1920,
  y: random(`dy${i}`) * 1080,
  size: 1.5 + random(`ds${i}`) * 2.5,
  speed: 0.5 + random(`dv${i}`) * 1,
  phase: random(`dp${i}`) * Math.PI * 2,
  baseAlpha: 0.05 + random(`da${i}`) * 0.08,
}));

// Lightning bolt path generator (jagged line between two points)
const makeBoltPath = (x1, y1, x2, y2, seed, segments) => {
  const points = [{ x: x1, y: y1 }];
  const dx = x2 - x1;
  const dy = y2 - y1;
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const offsetX = (random(`${seed}x${i}`) - 0.5) * 60;
    const offsetY = (random(`${seed}y${i}`) - 0.5) * 60;
    points.push({ x: x1 + dx * t + offsetX, y: y1 + dy * t + offsetY });
  }
  points.push({ x: x2, y: y2 });
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
};

export const Beat04Arena = () => {
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
  // 0-30: Background
  // 15-60: Three agent nodes pop in (staggered)
  // 50-90: Labels appear
  // 80-180: Energy bolts crackle between them (cycling)
  // 160-220: Triangle outline draws, center glow
  // 200-250: Text appears
  // 250-300: Fade out

  // Agent entries
  const agentEntries = AGENTS.map((_, i) => {
    const delay = 18 + i * 15;
    return Math.min(1.1, Math.max(0, spring({
      frame: frame - delay, fps, config: { damping: 10, stiffness: 120, mass: 0.7 },
    })));
  });

  // Label entries
  const labelEntries = AGENTS.map((_, i) => {
    return Math.min(1, Math.max(0, spring({
      frame: frame - (55 + i * 10), fps, config: GENTLE,
    })));
  });

  // Energy bolt cycling: each bolt fires for ~20 frames, staggered
  const boltCycle = 50; // frames per cycle
  const boltActive = BOLTS.map((_, i) => {
    const cycleFrame = (frame - 80 + i * 17) % boltCycle;
    if (frame < 80) return 0;
    const intensity = interpolate(cycleFrame, [0, 5, 15, 25], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    return intensity;
  });

  // Triangle outline
  const triDraw = interpolate(frame, [160, 210], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

  // Center glow
  const centerGlow = interpolate(frame, [180, 210, 245, 270], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Text
  const t1 = Math.min(1, Math.max(0, spring({ frame: frame - 205, fps, config: GENTLE })));
  const textOut = interpolate(frame, [durationInFrames - 50, durationInFrames - 18], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Triangle center
  const cx = (AGENTS[0].x + AGENTS[1].x + AGENTS[2].x) / 3;
  const cy = (AGENTS[0].y + AGENTS[1].y + AGENTS[2].y) / 3;

  return (
    <AbsoluteFill style={{ opacity: master }}>
      {/* Background */}
      <AbsoluteFill style={{
        background: 'radial-gradient(ellipse at 50% 48%, #141420 0%, #0a0a12 55%, #000000 100%)',
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

      {/* SVG layer: triangle, bolts */}
      <svg width={1920} height={1080} style={{ position: 'absolute' }}>
        <defs>
          <filter id="boltGlow">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Triangle outline */}
        {triDraw > 0 && (
          <polygon
            points={AGENTS.map(a => `${a.x},${a.y}`).join(' ')}
            fill="none"
            stroke={SKY.cyan}
            strokeWidth={1.5}
            opacity={0.2 * triDraw}
            strokeDasharray={2400}
            strokeDashoffset={2400 * (1 - triDraw)}
          />
        )}

        {/* Energy bolts */}
        {BOLTS.map(([a, b], i) => {
          if (boltActive[i] <= 0) return null;
          // Regenerate path each cycle for variation
          const cycleIndex = Math.floor((frame - 80) / 8);
          const pathD = makeBoltPath(
            AGENTS[a].x, AGENTS[a].y,
            AGENTS[b].x, AGENTS[b].y,
            `bolt${i}-${cycleIndex}`, 8
          );
          const boltColor = interpolateColors(0.5, [0, 1], [AGENTS[a].color, AGENTS[b].color]);
          return (
            <path key={`bolt${i}`}
              d={pathD}
              fill="none"
              stroke={boltColor}
              strokeWidth={2.5}
              opacity={boltActive[i] * 0.7}
              filter="url(#boltGlow)"
            />
          );
        })}
      </svg>

      {/* Center glow */}
      {centerGlow > 0 && (
        <div style={{
          position: 'absolute',
          left: cx - 120, top: cy - 120,
          width: 240, height: 240, borderRadius: '50%',
          background: `radial-gradient(circle, rgba(255,255,0,${0.1 * centerGlow}) 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />
      )}

      {/* Agent nodes */}
      {AGENTS.map((agent, i) => {
        const entry = agentEntries[i];
        if (entry <= 0) return null;
        const nodeSize = 60;
        const pulse = boltActive[(i + 2) % 3] > 0 || boltActive[i] > 0
          ? 1 + Math.sin(frame * 0.5) * 0.05
          : 1;
        return (
          <React.Fragment key={`agent${i}`}>
            {/* Node */}
            <div style={{
              position: 'absolute',
              left: agent.x - nodeSize / 2,
              top: agent.y - nodeSize / 2,
              width: nodeSize, height: nodeSize,
              borderRadius: '50%',
              backgroundColor: 'rgba(10,10,20,0.9)',
              border: `2.5px solid ${agent.color}`,
              opacity: Math.min(1, entry),
              transform: `scale(${Math.min(1, entry) * pulse})`,
              boxShadow: `0 0 15px ${agent.glow}, inset 0 0 15px ${agent.glow}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                width: 20, height: 20, borderRadius: '50%',
                backgroundColor: agent.color,
                boxShadow: `0 0 8px ${agent.glow}`,
              }} />
            </div>
            {/* Label */}
            <div style={{
              position: 'absolute',
              left: agent.x - 80, top: agent.y + nodeSize / 2 + 12,
              width: 160, textAlign: 'center',
              opacity: labelEntries[i],
              transform: `translateY(${interpolate(labelEntries[i], [0, 1], [10, 0])}px)`,
            }}>
              <div style={{
                fontSize: 16, fontWeight: 'bold', letterSpacing: 3,
                color: agent.color, fontFamily: '"Courier New", monospace',
              }}>
                {agent.label}
              </div>
              <div style={{
                fontSize: 12, letterSpacing: 2, marginTop: 4,
                color: SKY.muted, fontFamily: '"Georgia", serif',
              }}>
                {agent.role}
              </div>
            </div>
          </React.Fragment>
        );
      })}

      {/* Text */}
      <div style={{
        position: 'absolute', bottom: 80, left: 0, right: 0,
        textAlign: 'center', fontFamily: '"Georgia", serif',
      }}>
        <div style={{
          fontSize: 38, fontWeight: 'bold', letterSpacing: 4,
          color: SKY.white,
          opacity: t1 * textOut,
          transform: `translateY(${interpolate(t1, [0, 1], [25, 0])}px)`,
          textShadow: '0 0 20px rgba(255,255,0,0.2)',
        }}>
          DIALECTICAL REASONING
        </div>
      </div>
    </AbsoluteFill>
  );
};

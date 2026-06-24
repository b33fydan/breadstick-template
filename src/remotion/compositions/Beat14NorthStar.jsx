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
// BEAT 14 — THE NORTH STAR
// Lone builder at a desk. Single light. Code glowing.
// Curiosity and discipline over quick-buck AI building.
// Emotion: Resolve, authenticity, underdog energy
// ═══════════════════════════════════════════════════════════

const SKY = {
  yellow: '#ffff00',
  cyan: '#00ffff',
  white: '#ffffff',
  muted: '#cccccc',
};

const GENTLE = { damping: 20, stiffness: 80, mass: 1 };

// Code lines (glowing on the "screen")
const CODE_LINES = [
  { text: 'class Architect(Agent):', color: SKY.cyan, indent: 0 },
  { text: '    def analyze(self, evidence):', color: SKY.muted, indent: 1 },
  { text: '        packets = self.freeze(evidence)', color: SKY.muted, indent: 2 },
  { text: '        return self.score(packets)', color: SKY.cyan, indent: 2 },
  { text: '', color: 'transparent', indent: 0 },
  { text: 'class Skeptic(Agent):', color: SKY.cyan, indent: 0 },
  { text: '    def challenge(self, claim):', color: SKY.muted, indent: 1 },
  { text: '        if not claim.provenance:', color: SKY.muted, indent: 2 },
  { text: '            raise SchemaViolation()', color: '#ff4466', indent: 3 },
  { text: '', color: 'transparent', indent: 0 },
  { text: '# The honest answer IS the product', color: SKY.yellow, indent: 0 },
  { text: 'result = run_benchmark(corpus)', color: SKY.cyan, indent: 0 },
  { text: 'assert result.regressions == 0', color: '#00ff88', indent: 0 },
];

// Floating dust motes in the light cone
const DUST = Array.from({ length: 20 }, (_, i) => ({
  x: 860 + random(`dx${i}`) * 200,
  y: 100 + random(`dy${i}`) * 500,
  size: 1 + random(`ds${i}`) * 2,
  speed: 0.3 + random(`dv${i}`) * 0.5,
  phase: random(`dp${i}`) * Math.PI * 2,
  alpha: 0.1 + random(`da${i}`) * 0.15,
}));

export const Beat14NorthStar = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 45], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(frame, [durationInFrames - 45, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const master = fadeIn * fadeOut;

  // Phases:
  // 0-45: Slow fade in. Desk silhouette. Single overhead light cone.
  // 30-120: Code lines appear one by one on the "screen"
  // 120-160: Screen glow intensifies
  // 160-220: Text: "CURIOSITY AND DISCIPLINE"
  // 220-260: Sub-text
  // 260-300: Slow fade out

  // Light cone breathing
  const lightBreath = 0.85 + 0.15 * Math.sin(frame * 0.04);

  // Code line entries
  const codeEntries = CODE_LINES.map((_, i) => {
    const delay = 35 + i * 7;
    return interpolate(frame, [delay, delay + 12], [0, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    });
  });

  // Screen glow
  const screenGlow = interpolate(frame, [100, 150, 260, 290], [0.3, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Cursor blink
  const cursorOn = Math.sin(frame * 0.15) > 0;

  // Text
  const t1 = Math.min(1, Math.max(0, spring({ frame: frame - 165, fps, config: GENTLE })));
  const t2 = Math.min(1, Math.max(0, spring({ frame: frame - 190, fps, config: GENTLE })));
  const t3 = Math.min(1, Math.max(0, spring({ frame: frame - 225, fps, config: GENTLE })));
  const textOut = interpolate(frame, [durationInFrames - 55, durationInFrames - 20], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: master }}>
      {/* Background — very dark, intimate */}
      <AbsoluteFill style={{
        background: 'radial-gradient(ellipse at 50% 20%, #0c0a10 0%, #040306 40%, #000000 100%)',
      }} />

      {/* Overhead light cone */}
      <div style={{
        position: 'absolute',
        left: 810, top: 0,
        width: 300, height: 600,
        background: `linear-gradient(
          to bottom,
          rgba(255,255,200,${0.06 * lightBreath}) 0%,
          rgba(255,255,200,${0.02 * lightBreath}) 60%,
          transparent 100%
        )`,
        clipPath: 'polygon(40% 0%, 60% 0%, 85% 100%, 15% 100%)',
        pointerEvents: 'none',
      }} />

      {/* Dust motes in light */}
      {DUST.map((d, i) => {
        const px = d.x + Math.sin(frame * 0.005 * d.speed + d.phase) * 30;
        const py = d.y + Math.cos(frame * 0.003 * d.speed + d.phase * 0.7) * 20;
        return (
          <div key={`dm${i}`} style={{
            position: 'absolute', left: px, top: py,
            width: d.size, height: d.size, borderRadius: '50%',
            backgroundColor: '#ffffcc',
            opacity: d.alpha * lightBreath,
          }} />
        );
      })}

      {/* Desk silhouette */}
      <div style={{
        position: 'absolute', left: 660, top: 580,
        width: 600, height: 8, borderRadius: 4,
        backgroundColor: '#1a1a22',
      }} />
      {/* Desk legs */}
      <div style={{
        position: 'absolute', left: 700, top: 588,
        width: 8, height: 120, backgroundColor: '#141418',
      }} />
      <div style={{
        position: 'absolute', left: 1212, top: 588,
        width: 8, height: 120, backgroundColor: '#141418',
      }} />

      {/* Monitor */}
      <div style={{
        position: 'absolute', left: 780, top: 320,
        width: 360, height: 250,
        borderRadius: 8,
        backgroundColor: `rgba(5,8,15,${0.95})`,
        border: `1.5px solid rgba(0,255,255,${0.15 + screenGlow * 0.15})`,
        boxShadow: `0 0 ${20 + screenGlow * 30}px rgba(0,255,255,${0.05 + screenGlow * 0.1})`,
        overflow: 'hidden', padding: '15px 18px',
        fontFamily: '"Courier New", monospace',
      }}>
        {/* Code lines */}
        {CODE_LINES.map((line, i) => (
          <div key={`code${i}`} style={{
            fontSize: 11, letterSpacing: 0.5,
            color: line.color,
            opacity: codeEntries[i],
            marginLeft: line.indent * 0,
            height: line.text ? 16 : 8,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}>
            {line.text}
          </div>
        ))}
        {/* Cursor */}
        <div style={{
          width: 7, height: 13, marginTop: 2,
          backgroundColor: cursorOn ? SKY.cyan : 'transparent',
        }} />
      </div>

      {/* Monitor stand */}
      <div style={{
        position: 'absolute', left: 940, top: 570,
        width: 40, height: 12, borderRadius: 3,
        backgroundColor: '#1a1a22',
      }} />
      <div style={{
        position: 'absolute', left: 955, top: 555,
        width: 10, height: 18,
        backgroundColor: '#181820',
      }} />

      {/* Person silhouette (simple) */}
      {/* Head */}
      <div style={{
        position: 'absolute', left: 940, top: 420,
        width: 40, height: 45, borderRadius: '50% 50% 45% 45%',
        backgroundColor: '#0f0f15',
        border: '1px solid rgba(255,255,255,0.04)',
      }} />
      {/* Shoulders */}
      <div style={{
        position: 'absolute', left: 905, top: 462,
        width: 110, height: 70, borderRadius: '40% 40% 0 0',
        backgroundColor: '#0e0e14',
      }} />

      {/* Text — lower third */}
      <div style={{
        position: 'absolute', bottom: 100, left: 0, right: 0,
        textAlign: 'center', fontFamily: '"Georgia", serif',
      }}>
        <div style={{
          fontSize: 44, fontWeight: 'bold', letterSpacing: 5,
          color: SKY.yellow,
          opacity: t1 * textOut,
          transform: `translateY(${interpolate(t1, [0, 1], [25, 0])}px)`,
          textShadow: '0 0 30px rgba(255,255,0,0.35)',
        }}>
          CURIOSITY AND DISCIPLINE
        </div>
        <div style={{
          fontSize: 30, letterSpacing: 4, marginTop: 14,
          color: SKY.white,
          opacity: t2 * textOut,
          transform: `translateY(${interpolate(t2, [0, 1], [25, 0])}px)`,
        }}>
          OVER QUICK-BUCK AI BUILDING
        </div>
        <div style={{
          fontSize: 22, letterSpacing: 3, marginTop: 18,
          color: SKY.muted,
          opacity: t3 * textOut,
          transform: `translateY(${interpolate(t3, [0, 1], [25, 0])}px)`,
        }}>
          THAT'S THE WHOLE THING
        </div>
      </div>
    </AbsoluteFill>
  );
};

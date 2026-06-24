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
// BEAT 9 — THE CONVERGENCE (independent team)
// Two independent research beams merge into one point.
// Two teams, different methods, same conclusion.
// Emotion: Validation, awe, frontier-level work
// ═══════════════════════════════════════════════════════════

const SKY = {
  yellow: '#ffff00',
  cyan: '#00ffff',
  white: '#ffffff',
  muted: '#cccccc',
};

const GENTLE = { damping: 20, stiffness: 80, mass: 1 };

// Convergence point
const CX = 960;
const CY = 440;

// Beam particles
const BEAM_COUNT = 25;
const leftBeam = Array.from({ length: BEAM_COUNT }, (_, i) => ({
  startX: 80 + random(`lbx${i}`) * 100,
  startY: 300 + random(`lby${i}`) * 280,
  size: 3 + random(`lbs${i}`) * 4,
  speed: 0.4 + random(`lbv${i}`) * 0.6,
  phase: random(`lbp${i}`) * 60,
}));
const rightBeam = Array.from({ length: BEAM_COUNT }, (_, i) => ({
  startX: 1740 + random(`rbx${i}`) * 100,
  startY: 300 + random(`rby${i}`) * 280,
  size: 3 + random(`rbs${i}`) * 4,
  speed: 0.4 + random(`rbv${i}`) * 0.6,
  phase: random(`rbp${i}`) * 60,
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

export const Beat09Convergence = () => {
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
  // 0-30: Two team labels appear on opposite sides
  // 20-160: Beam particles flow from both sides toward center
  // 140-190: Convergence point ignites (yellow glow)
  // 190-250: Text + ripple effect from convergence point
  // 250-300: Fade out

  // Team label entries
  const labelLeft = Math.min(1, Math.max(0, spring({ frame: frame - 15, fps, config: GENTLE })));
  const labelRight = Math.min(1, Math.max(0, spring({ frame: frame - 25, fps, config: GENTLE })));

  // Convergence ignition
  const ignite = interpolate(frame, [145, 170, 240, 270], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const ignitePulse = ignite > 0 ? 0.6 + 0.4 * Math.sin((frame - 145) * 0.3) : 0;

  // Ripple rings
  const ripple1 = interpolate(frame, [165, 250], [0, 300], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const ripple1Op = interpolate(frame, [165, 200, 250], [0.4, 0.2, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const ripple2 = interpolate(frame, [180, 260], [0, 250], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const ripple2Op = interpolate(frame, [180, 215, 260], [0.3, 0.15, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Text
  const t1 = Math.min(1, Math.max(0, spring({ frame: frame - 195, fps, config: GENTLE })));
  const t2 = Math.min(1, Math.max(0, spring({ frame: frame - 212, fps, config: GENTLE })));
  const textOut = interpolate(frame, [durationInFrames - 50, durationInFrames - 18], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Render beam particles
  const renderBeam = (particles, fromLeft, color) => {
    return particles.map((p, i) => {
      if (frame < 20 + p.phase * 0.5) return null;
      const cycleLen = 80 / p.speed;
      const t = ((frame - 20 - p.phase * 0.5) % cycleLen) / cycleLen;
      const px = interpolate(t, [0, 1], [p.startX, CX]);
      const py = interpolate(t, [0, 1], [p.startY, CY]);
      const pOp = interpolate(t, [0, 0.05, 0.85, 1], [0, 0.7, 0.7, 0], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      });
      // After convergence, particles get brighter near center
      const distToCenter = Math.abs(px - CX);
      const nearCenter = distToCenter < 100;
      const finalColor = nearCenter && ignite > 0
        ? interpolateColors(ignite, [0, 1], [color, SKY.yellow])
        : color;
      return (
        <div key={`${fromLeft ? 'l' : 'r'}${i}`} style={{
          position: 'absolute', left: px - p.size / 2, top: py - p.size / 2,
          width: p.size, height: p.size, borderRadius: '50%',
          backgroundColor: finalColor,
          opacity: pOp,
          boxShadow: nearCenter && ignite > 0
            ? `0 0 ${8 * ignite}px ${finalColor}`
            : `0 0 4px ${color}`,
        }} />
      );
    });
  };

  return (
    <AbsoluteFill style={{ opacity: master }}>
      {/* Background */}
      <AbsoluteFill style={{
        background: 'radial-gradient(ellipse at 50% 42%, #14141e 0%, #08080e 55%, #000000 100%)',
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

      {/* Beam particles */}
      {renderBeam(leftBeam, true, SKY.cyan)}
      {renderBeam(rightBeam, false, '#88aaff')}

      {/* Ripple rings */}
      {ripple1Op > 0 && (
        <div style={{
          position: 'absolute',
          left: CX - ripple1, top: CY - ripple1,
          width: ripple1 * 2, height: ripple1 * 2,
          borderRadius: '50%',
          border: `1.5px solid rgba(255,255,0,${ripple1Op})`,
          pointerEvents: 'none',
        }} />
      )}
      {ripple2Op > 0 && (
        <div style={{
          position: 'absolute',
          left: CX - ripple2, top: CY - ripple2,
          width: ripple2 * 2, height: ripple2 * 2,
          borderRadius: '50%',
          border: `1px solid rgba(255,255,0,${ripple2Op})`,
          pointerEvents: 'none',
        }} />
      )}

      {/* Convergence point glow */}
      {ignite > 0 && (
        <div style={{
          position: 'absolute',
          left: CX - 80, top: CY - 80,
          width: 160, height: 160, borderRadius: '50%',
          background: `radial-gradient(circle,
            rgba(255,255,0,${0.35 * ignite * ignitePulse}) 0%,
            rgba(255,255,0,${0.1 * ignite}) 40%,
            transparent 70%)`,
          pointerEvents: 'none',
        }} />
      )}
      {/* Center dot */}
      {ignite > 0 && (
        <div style={{
          position: 'absolute',
          left: CX - 8, top: CY - 8,
          width: 16, height: 16, borderRadius: '50%',
          backgroundColor: SKY.yellow,
          boxShadow: `0 0 ${15 + ignite * 20}px rgba(255,255,0,0.6)`,
          opacity: ignite,
        }} />
      )}

      {/* Team labels */}
      <div style={{
        position: 'absolute', left: 80, top: 200,
        opacity: labelLeft,
        fontFamily: '"Courier New", monospace',
      }}>
        <div style={{ fontSize: 16, fontWeight: 'bold', letterSpacing: 3, color: SKY.cyan }}>
          ARES PROJECT
        </div>
        <div style={{ fontSize: 12, letterSpacing: 2, color: SKY.muted, marginTop: 6 }}>
          Real cybersecurity data
        </div>
        <div style={{ fontSize: 12, letterSpacing: 2, color: SKY.muted, marginTop: 2 }}>
          Mechanistic diagnosis
        </div>
      </div>
      <div style={{
        position: 'absolute', right: 80, top: 200,
        textAlign: 'right',
        opacity: labelRight,
        fontFamily: '"Courier New", monospace',
      }}>
        <div style={{ fontSize: 16, fontWeight: 'bold', letterSpacing: 3, color: '#88aaff' }}>
          INDEPENDENT TEAM
        </div>
        <div style={{ fontSize: 12, letterSpacing: 2, color: SKY.muted, marginTop: 6 }}>
          Synthetic benchmarks
        </div>
        <div style={{ fontSize: 12, letterSpacing: 2, color: SKY.muted, marginTop: 2 }}>
          Independent validation
        </div>
      </div>

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
          textShadow: '0 0 30px rgba(255,255,0,0.4)',
        }}>
          CONVERGENT EVIDENCE
        </div>
        <div style={{
          fontSize: 26, letterSpacing: 3, marginTop: 14,
          color: SKY.muted,
          opacity: t2 * textOut,
          transform: `translateY(${interpolate(t2, [0, 1], [25, 0])}px)`,
        }}>
          THE GOLD STANDARD IN SCIENCE
        </div>
      </div>
    </AbsoluteFill>
  );
};

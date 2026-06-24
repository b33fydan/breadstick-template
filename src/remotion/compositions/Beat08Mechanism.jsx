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
// BEAT 8 — THE MECHANISM (Why Debate Fails)
// Architect confidence collapses 0.92→0.48 under pressure.
// Skeptic stays rigid 0.78-0.85. Commitment bias.
// Emotion: Diagnosis, precision, the honest answer
// ═══════════════════════════════════════════════════════════

const SKY = {
  yellow: '#ffff00',
  cyan: '#00ffff',
  white: '#ffffff',
  muted: '#cccccc',
  green: '#00ff88',
  red: '#ff3344',
};

const GENTLE = { damping: 20, stiffness: 80, mass: 1 };

// Meter dimensions
const METER_W = 300;
const METER_H = 420;

// Dust
const DUST = Array.from({ length: 30 }, (_, i) => ({
  x: random(`dx${i}`) * 1920,
  y: random(`dy${i}`) * 1080,
  size: 1.5 + random(`ds${i}`) * 2.5,
  speed: 0.5 + random(`dv${i}`) * 1,
  phase: random(`dp${i}`) * Math.PI * 2,
  baseAlpha: 0.04 + random(`da${i}`) * 0.06,
}));

export const Beat08Mechanism = () => {
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
  // 0-40: Two meter frames appear
  // 40-80: Both start at high confidence (Architect 0.92, Skeptic 0.85)
  // 80-180: Architect drops to 0.48 (animated drain), Skeptic barely moves (0.78-0.85)
  // 180-230: "COMMITMENT BIAS" label, values flash
  // 230-270: Text appears
  // 270-300: Fade out

  // Meter frame entries
  const meterEntry = Math.min(1, Math.max(0, spring({
    frame: frame - 15, fps, config: GENTLE,
  })));

  // Architect confidence: 0.92 → 0.48
  const archConfidence = interpolate(frame, [45, 60, 85, 180], [0, 0.92, 0.92, 0.48], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

  // Skeptic confidence: 0.85 → 0.78 (barely moves)
  const skeptConfidence = interpolate(frame, [45, 65, 90, 180], [0, 0.85, 0.85, 0.78], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

  // Architect meter shaking during collapse
  const archShake = frame > 100 && frame < 180
    ? Math.sin(frame * 0.8) * interpolate(frame, [100, 140, 180], [0, 3, 0], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      })
    : 0;

  // "COMMITMENT BIAS" entry
  const biasEntry = Math.min(1, Math.max(0, spring({
    frame: frame - 185, fps, config: { damping: 10, stiffness: 120, mass: 0.7 },
  })));

  // Value flash at endpoints
  const valFlash = interpolate(frame, [185, 200, 225, 250], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Text
  const t1 = Math.min(1, Math.max(0, spring({ frame: frame - 218, fps, config: GENTLE })));
  const textOut = interpolate(frame, [durationInFrames - 50, durationInFrames - 18], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Meter bar color based on value
  const archColor = interpolateColors(archConfidence, [0.4, 0.6, 0.9], [SKY.red, SKY.yellow, SKY.green]);
  const archGlow = interpolateColors(archConfidence, [0.4, 0.9], ['rgba(255,51,68,0.3)', 'rgba(0,255,136,0.3)']);

  const renderMeter = (x, label, confidence, color, glow, shake, locked) => {
    const barH = confidence * METER_H;
    return (
      <div style={{
        position: 'absolute', left: x, top: 200,
        width: METER_W,
        opacity: meterEntry,
        transform: `translateX(${shake}px)`,
      }}>
        {/* Label */}
        <div style={{
          textAlign: 'center', marginBottom: 16,
          fontFamily: '"Courier New", monospace',
          fontSize: 16, fontWeight: 'bold', letterSpacing: 4,
          color: color,
        }}>
          {label}
        </div>
        {/* Meter frame */}
        <div style={{
          width: METER_W, height: METER_H,
          borderRadius: 10,
          backgroundColor: 'rgba(10,12,20,0.8)',
          border: `1.5px solid rgba(255,255,255,0.12)`,
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Fill bar (from bottom) */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: barH,
            borderRadius: '0 0 9px 9px',
            backgroundColor: color,
            opacity: 0.25,
            boxShadow: `0 0 20px ${glow}`,
            transition: 'none',
          }} />
          {/* Fill line (top edge of bar) */}
          <div style={{
            position: 'absolute', bottom: barH - 2, left: 0, right: 0,
            height: 3,
            backgroundColor: color,
            boxShadow: `0 0 10px ${glow}`,
          }} />
          {/* Lock icon for Skeptic */}
          {locked && (
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%,-50%)',
              fontSize: 28, color: 'rgba(255,255,255,0.15)',
            }}>
              {'\u{1F512}'}
            </div>
          )}
        </div>
        {/* Value readout */}
        <div style={{
          textAlign: 'center', marginTop: 12,
          fontFamily: '"Georgia", serif',
          fontSize: 42, fontWeight: 'bold',
          color: color,
          textShadow: valFlash > 0 ? `0 0 ${20 * valFlash}px ${glow}` : 'none',
        }}>
          {confidence.toFixed(2)}
        </div>
      </div>
    );
  };

  return (
    <AbsoluteFill style={{ opacity: master }}>
      {/* Background */}
      <AbsoluteFill style={{
        background: 'radial-gradient(ellipse at 50% 50%, #141418 0%, #0a0a0e 55%, #000000 100%)',
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

      {/* Arrow between meters (pressure direction) */}
      {frame > 90 && (
        <svg width={1920} height={1080} style={{ position: 'absolute' }}>
          <defs>
            <marker id="arrowRed" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill={SKY.red} opacity="0.5" />
            </marker>
          </defs>
          {/* Pressure arrow from Skeptic toward Architect */}
          <line
            x1={1100} y1={420} x2={820} y2={420}
            stroke={SKY.red} strokeWidth={2}
            opacity={interpolate(frame, [90, 120, 175, 200], [0, 0.4, 0.4, 0], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            })}
            markerEnd="url(#arrowRed)"
            strokeDasharray="8,4"
          />
        </svg>
      )}

      {/* Architect meter (left) */}
      {renderMeter(480, 'ARCHITECT', archConfidence, archColor, archGlow, archShake, false)}

      {/* Skeptic meter (right) */}
      {renderMeter(1140, 'SKEPTIC', skeptConfidence, SKY.cyan, 'rgba(0,255,255,0.3)', 0, true)}

      {/* COMMITMENT BIAS label */}
      {biasEntry > 0 && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 135,
          textAlign: 'center',
          fontFamily: '"Courier New", monospace',
          fontSize: 22, fontWeight: 'bold', letterSpacing: 6,
          color: SKY.yellow,
          opacity: biasEntry,
          transform: `scale(${0.8 + biasEntry * 0.2})`,
          textShadow: '0 0 20px rgba(255,255,0,0.3)',
        }}>
          COMMITMENT BIAS
        </div>
      )}

      {/* Text */}
      <div style={{
        position: 'absolute', bottom: 80, left: 0, right: 0,
        textAlign: 'center', fontFamily: '"Georgia", serif',
      }}>
        <div style={{
          fontSize: 34, fontWeight: 'bold', letterSpacing: 3,
          color: SKY.white,
          opacity: t1 * textOut,
          transform: `translateY(${interpolate(t1, [0, 1], [25, 0])}px)`,
        }}>
          THREE FIX ATTEMPTS. ZERO NET IMPROVEMENT.
        </div>
      </div>
    </AbsoluteFill>
  );
};

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
// BEAT 6 — THE EXPERIMENT
// 30 sessions. 1,000+ tests. Zero regressions.
// Test suite running, checkmarks cascading, scoreboard.
// Emotion: Momentum, methodical progress
// ═══════════════════════════════════════════════════════════

const SKY = {
  yellow: '#ffff00',
  cyan: '#00ffff',
  white: '#ffffff',
  muted: '#cccccc',
  green: '#00ff88',
};

const GENTLE = { damping: 20, stiffness: 80, mass: 1 };

// Test rows (left side)
const TESTS = Array.from({ length: 18 }, (_, i) => ({
  label: [
    'test_baseline_accuracy', 'test_evidence_schema', 'test_architect_prompt',
    'test_skeptic_rebuttal', 'test_oracle_scoring', 'test_debate_turn_1',
    'test_debate_turn_2', 'test_confidence_calc', 'test_benchmark_01',
    'test_benchmark_02', 'test_benchmark_03', 'test_regression_check',
    'test_evidence_freeze', 'test_provenance_chain', 'test_schema_valid',
    'test_immutability', 'test_hallucination_catch', 'test_score_formula',
  ][i],
  passFrame: 30 + i * 8,
}));

// Counters (right side)
const COUNTERS = [
  { label: 'SESSIONS', target: 30, x: 1400, y: 300 },
  { label: 'TESTS', target: 1000, x: 1400, y: 440 },
  { label: 'REGRESSIONS', target: 0, x: 1400, y: 580 },
];

// Dust
const DUST = Array.from({ length: 30 }, (_, i) => ({
  x: random(`dx${i}`) * 1920,
  y: random(`dy${i}`) * 1080,
  size: 1.5 + random(`ds${i}`) * 2.5,
  speed: 0.5 + random(`dv${i}`) * 1,
  phase: random(`dp${i}`) * Math.PI * 2,
  baseAlpha: 0.04 + random(`da${i}`) * 0.06,
}));

export const Beat06Experiment = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(frame, [durationInFrames - 30, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const master = fadeIn * fadeOut;

  // Test pass progress
  const testsPassed = TESTS.filter(t => frame >= t.passFrame + 10).length;

  // Counter animations
  const counterValues = COUNTERS.map((c, i) => {
    const start = 60 + i * 30;
    const p = interpolate(frame, [start, start + 90], [0, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    });
    return Math.round(p * c.target);
  });

  // "Zero regressions" glow
  const zeroGlow = interpolate(frame, [180, 210, 250, 275], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Progress bar
  const barProgress = interpolate(frame, [30, 200], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // Text
  const t1 = Math.min(1, Math.max(0, spring({ frame: frame - 220, fps, config: GENTLE })));
  const textOut = interpolate(frame, [durationInFrames - 50, durationInFrames - 18], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: master }}>
      {/* Background */}
      <AbsoluteFill style={{
        background: 'radial-gradient(ellipse at 50% 50%, #0f1818 0%, #080e10 55%, #000000 100%)',
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
            backgroundColor: SKY.green, opacity: dOp,
          }} />
        );
      })}

      {/* Test suite header */}
      <div style={{
        position: 'absolute', left: 120, top: 80,
        fontFamily: '"Courier New", monospace',
        fontSize: 14, letterSpacing: 2, color: SKY.muted,
        opacity: interpolate(frame, [10, 30], [0, 0.6], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        }),
      }}>
        $ python -m pytest ares/ --benchmark
      </div>

      {/* Test rows */}
      {TESTS.map((test, i) => {
        const rowY = 120 + i * 38;
        if (rowY > 820) return null;
        const labelOp = interpolate(frame, [test.passFrame - 10, test.passFrame], [0, 0.5], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        const checkOp = interpolate(frame, [test.passFrame, test.passFrame + 8], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        const checkScale = Math.min(1.2, Math.max(0, spring({
          frame: frame - test.passFrame, fps,
          config: { damping: 10, stiffness: 150, mass: 0.5 },
        })));
        return (
          <div key={`test${i}`} style={{
            position: 'absolute', left: 120, top: rowY,
            display: 'flex', alignItems: 'center', gap: 12,
            fontFamily: '"Courier New", monospace', fontSize: 13,
          }}>
            {/* Check / spinner */}
            <div style={{
              width: 20, height: 20, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              color: checkOp > 0.5 ? SKY.green : SKY.muted,
              fontSize: 16, fontWeight: 'bold',
              transform: `scale(${checkOp > 0.5 ? Math.min(1, checkScale) : 1})`,
            }}>
              {checkOp > 0.5 ? '\u2713' : (labelOp > 0 ? '\u25CB' : '')}
            </div>
            <div style={{
              color: checkOp > 0.5 ? SKY.green : SKY.muted,
              opacity: labelOp,
              letterSpacing: 0.5,
            }}>
              {test.label}
            </div>
            {checkOp > 0.5 && (
              <div style={{ color: SKY.green, fontSize: 11, opacity: 0.6 }}>
                PASS
              </div>
            )}
          </div>
        );
      })}

      {/* Counters (right side) */}
      {COUNTERS.map((c, i) => {
        const entryP = Math.min(1, Math.max(0, spring({
          frame: frame - (50 + i * 20), fps, config: GENTLE,
        })));
        const isZeroReg = i === 2;
        const valueColor = isZeroReg
          ? (zeroGlow > 0 ? interpolateColors(zeroGlow, [0, 1], [SKY.cyan, SKY.green]) : SKY.cyan)
          : SKY.cyan;
        const valueGlow = isZeroReg && zeroGlow > 0
          ? `0 0 ${25 * zeroGlow}px rgba(0,255,136,0.4)`
          : 'none';
        return (
          <div key={`counter${i}`} style={{
            position: 'absolute', left: c.x, top: c.y,
            opacity: entryP,
            transform: `translateY(${interpolate(entryP, [0, 1], [20, 0])}px)`,
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: 14, letterSpacing: 4, fontWeight: 'bold',
              color: SKY.muted, fontFamily: '"Courier New", monospace',
              marginBottom: 8,
            }}>
              {c.label}
            </div>
            <div style={{
              fontSize: 64, fontWeight: 'bold', letterSpacing: 2,
              color: valueColor,
              fontFamily: '"Georgia", serif',
              textShadow: valueGlow,
            }}>
              {counterValues[i].toLocaleString()}
            </div>
          </div>
        );
      })}

      {/* Progress bar */}
      <div style={{
        position: 'absolute', left: 1300, top: 720,
        width: 350, height: 8, borderRadius: 4,
        backgroundColor: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${barProgress * 100}%`, height: '100%',
          borderRadius: 4,
          backgroundColor: SKY.green,
          boxShadow: `0 0 10px rgba(0,255,136,0.4)`,
        }} />
      </div>
      <div style={{
        position: 'absolute', left: 1300, top: 738,
        fontSize: 11, letterSpacing: 2,
        color: SKY.muted, fontFamily: '"Courier New", monospace',
      }}>
        {Math.round(barProgress * 100)}% COVERAGE
      </div>

      {/* Text */}
      <div style={{
        position: 'absolute', bottom: 60, left: 0, right: 0,
        textAlign: 'center', fontFamily: '"Georgia", serif',
      }}>
        <div style={{
          fontSize: 38, fontWeight: 'bold', letterSpacing: 5,
          color: SKY.green,
          opacity: t1 * textOut,
          transform: `translateY(${interpolate(t1, [0, 1], [25, 0])}px)`,
          textShadow: '0 0 25px rgba(0,255,136,0.35)',
        }}>
          THE DEBATE BEGINS
        </div>
      </div>
    </AbsoluteFill>
  );
};

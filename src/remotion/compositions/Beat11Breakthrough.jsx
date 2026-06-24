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
// BEAT 11 — THE BREAKTHROUGH (Kill Chain)
// Kill chain stage awareness pushes accuracy to 84.6%.
// Pentest scenarios: 100%. The answer was a concept, not a model.
// Ascending staircase of 4 kill chain stages + gold badge.
// Emotion: Triumph, elegance
// ═══════════════════════════════════════════════════════════

const SKY = {
  yellow: '#ffff00',
  cyan: '#00ffff',
  white: '#ffffff',
  muted: '#cccccc',
  green: '#00ff88',
};

const GENTLE = { damping: 20, stiffness: 80, mass: 1 };

// Kill chain stages (ascending staircase)
const STAGES = [
  { label: 'RECONNAISSANCE', color: '#4488ff', y: 600, desc: 'Looking around' },
  { label: 'VULNERABILITY', color: '#00ccff', y: 460, desc: 'Finding weaknesses' },
  { label: 'EXPLOITATION', color: '#ff8844', y: 320, desc: 'Breaking in' },
  { label: 'POST-EXPLOIT', color: '#ff3344', y: 180, desc: 'After they\'re in' },
];

const STEP_W = 320;
const STAIR_LEFT = 200;

// Dust
const DUST = Array.from({ length: 30 }, (_, i) => ({
  x: random(`dx${i}`) * 1920,
  y: random(`dy${i}`) * 1080,
  size: 1.5 + random(`ds${i}`) * 2,
  speed: 0.5 + random(`dv${i}`) * 1,
  phase: random(`dp${i}`) * Math.PI * 2,
  baseAlpha: 0.04 + random(`da${i}`) * 0.06,
}));

export const Beat11Breakthrough = () => {
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
  // 0-120: Four stages pop in as ascending steps (staggered)
  // 120-160: Connecting lines draw between stages (staircase)
  // 160-200: Gold badge "84.6%" scales in at top-right
  // 200-240: "100% PENTEST" badge appears below
  // 220-260: Text
  // 260-300: Fade out

  // Stage entries
  const stageEntries = STAGES.map((_, i) => {
    const delay = 20 + i * 25;
    return Math.min(1.08, Math.max(0, spring({
      frame: frame - delay, fps, config: { damping: 12, stiffness: 100, mass: 0.8 },
    })));
  });

  // Staircase connector lines
  const connDraw = interpolate(frame, [120, 160], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

  // Gold badge
  const badgeEntry = Math.min(1.1, Math.max(0, spring({
    frame: frame - 165, fps, config: { damping: 10, stiffness: 120, mass: 0.7 },
  })));
  const badgeGlow = interpolate(frame, [175, 200, 250, 275], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const badgePulse = badgeGlow > 0 ? 0.7 + 0.3 * Math.sin((frame - 175) * 0.35) : 0;

  // 100% pentest badge
  const pentestEntry = Math.min(1, Math.max(0, spring({
    frame: frame - 200, fps, config: GENTLE,
  })));

  // Text
  const t1 = Math.min(1, Math.max(0, spring({ frame: frame - 225, fps, config: GENTLE })));
  const textOut = interpolate(frame, [durationInFrames - 50, durationInFrames - 18], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: master }}>
      {/* Background */}
      <AbsoluteFill style={{
        background: 'radial-gradient(ellipse at 40% 50%, #141810 0%, #080a08 55%, #000000 100%)',
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

      {/* Staircase connector lines */}
      {connDraw > 0 && (
        <svg width={1920} height={1080} style={{ position: 'absolute' }}>
          {STAGES.map((stage, i) => {
            if (i === 0) return null;
            const prev = STAGES[i - 1];
            const segDraw = interpolate(connDraw, [(i - 1) / 3, i / 3], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            });
            if (segDraw <= 0) return null;
            // Horizontal then vertical connector
            const x1 = STAIR_LEFT + (i - 1) * STEP_W + STEP_W;
            const y1 = prev.y + 35;
            const x2 = STAIR_LEFT + i * STEP_W;
            const y2 = stage.y + 35;
            return (
              <React.Fragment key={`conn${i}`}>
                <line x1={x1} y1={y1} x2={x1 + (x2 - x1) * segDraw} y2={y1}
                  stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} strokeDasharray="4,4"
                />
                {segDraw > 0.5 && (
                  <line x1={x2} y1={y1} x2={x2} y2={y1 + (y2 - y1) * ((segDraw - 0.5) * 2)}
                    stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} strokeDasharray="4,4"
                  />
                )}
              </React.Fragment>
            );
          })}
        </svg>
      )}

      {/* Kill chain stages */}
      {STAGES.map((stage, i) => {
        const entry = stageEntries[i];
        if (entry <= 0) return null;
        const x = STAIR_LEFT + i * STEP_W;
        return (
          <div key={`stage${i}`} style={{
            position: 'absolute', left: x, top: stage.y,
            width: STEP_W - 20, height: 70,
            borderRadius: 10,
            backgroundColor: 'rgba(10,12,18,0.85)',
            border: `2px solid ${stage.color}`,
            opacity: Math.min(1, entry),
            transform: `scale(${Math.min(1, entry)}) translateY(${interpolate(Math.min(1, entry), [0, 1], [20, 0])}px)`,
            boxShadow: `0 0 15px ${stage.color}33`,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            fontFamily: '"Courier New", monospace',
          }}>
            <div style={{
              fontSize: 14, fontWeight: 'bold', letterSpacing: 3,
              color: stage.color,
            }}>
              {stage.label}
            </div>
            <div style={{
              fontSize: 11, letterSpacing: 1, marginTop: 4,
              color: SKY.muted,
            }}>
              {stage.desc}
            </div>
          </div>
        );
      })}

      {/* Stage number indicators */}
      {STAGES.map((stage, i) => {
        const entry = stageEntries[i];
        if (entry <= 0) return null;
        return (
          <div key={`num${i}`} style={{
            position: 'absolute',
            left: STAIR_LEFT + i * STEP_W - 15,
            top: stage.y - 15,
            width: 28, height: 28, borderRadius: '50%',
            backgroundColor: stage.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 'bold', color: '#000',
            fontFamily: '"Courier New", monospace',
            opacity: Math.min(1, entry),
            transform: `scale(${Math.min(1, entry)})`,
          }}>
            {i + 1}
          </div>
        );
      })}

      {/* 84.6% gold badge */}
      {badgeEntry > 0 && (
        <div style={{
          position: 'absolute', right: 160, top: 160,
          textAlign: 'center',
          opacity: Math.min(1, badgeEntry),
          transform: `scale(${Math.min(1, badgeEntry)})`,
        }}>
          <div style={{
            fontSize: 72, fontWeight: 'bold',
            color: SKY.yellow,
            fontFamily: '"Georgia", serif',
            textShadow: badgeGlow > 0
              ? `0 0 ${35 * badgeGlow * badgePulse}px rgba(255,255,0,0.5)`
              : 'none',
          }}>
            84.6%
          </div>
          <div style={{
            fontSize: 13, letterSpacing: 4, marginTop: 6,
            color: SKY.muted, fontFamily: '"Courier New", monospace',
          }}>
            COMBINED CORPUS
          </div>
        </div>
      )}

      {/* 100% pentest badge */}
      {pentestEntry > 0 && (
        <div style={{
          position: 'absolute', right: 180, top: 290,
          textAlign: 'center',
          opacity: pentestEntry,
          transform: `translateY(${interpolate(pentestEntry, [0, 1], [15, 0])}px)`,
        }}>
          <div style={{
            fontSize: 42, fontWeight: 'bold',
            color: SKY.green,
            fontFamily: '"Georgia", serif',
            textShadow: '0 0 20px rgba(0,255,136,0.4)',
          }}>
            100%
          </div>
          <div style={{
            fontSize: 11, letterSpacing: 4, marginTop: 4,
            color: SKY.green, fontFamily: '"Courier New", monospace',
          }}>
            PENTEST SCENARIOS
          </div>
        </div>
      )}

      {/* Text */}
      <div style={{
        position: 'absolute', bottom: 80, left: 0, right: 0,
        textAlign: 'center', fontFamily: '"Georgia", serif',
      }}>
        <div style={{
          fontSize: 36, fontWeight: 'bold', letterSpacing: 4,
          color: SKY.white,
          opacity: t1 * textOut,
          transform: `translateY(${interpolate(t1, [0, 1], [25, 0])}px)`,
        }}>
          THE ANSWER WAS A CONCEPT, NOT A MODEL
        </div>
      </div>
    </AbsoluteFill>
  );
};

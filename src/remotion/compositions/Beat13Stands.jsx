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
// BEAT 13 — WHERE IT STANDS
// Research paper targeting AISec at CCS. Open-sourcing GPL-3.0.
// "Placing a stone in the river."
// Academic paper + open source badge + river of light.
// Emotion: Legacy, contribution, humility
// ═══════════════════════════════════════════════════════════

const SKY = {
  yellow: '#ffff00',
  cyan: '#00ffff',
  white: '#ffffff',
  muted: '#cccccc',
  green: '#00ff88',
};

const GENTLE = { damping: 20, stiffness: 80, mass: 1 };

// River particles (flowing bottom-left to bottom-right)
const RIVER = Array.from({ length: 40 }, (_, i) => ({
  y: 700 + random(`ry${i}`) * 200,
  size: 3 + random(`rs${i}`) * 5,
  speed: 1.5 + random(`rv${i}`) * 2.5,
  phase: random(`rp${i}`) * 1920,
  yDrift: (random(`rd${i}`) - 0.5) * 30,
  color: random(`rc${i}`) > 0.7 ? SKY.yellow : SKY.cyan,
  alpha: 0.2 + random(`ra${i}`) * 0.3,
}));

// Dust
const DUST = Array.from({ length: 25 }, (_, i) => ({
  x: random(`dx${i}`) * 1920,
  y: random(`dy${i}`) * 600,
  size: 1.5 + random(`ds${i}`) * 2,
  speed: 0.5 + random(`dv${i}`) * 1,
  phase: random(`dp${i}`) * Math.PI * 2,
  baseAlpha: 0.04 + random(`da${i}`) * 0.05,
}));

export const Beat13Stands = () => {
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
  // 0-60: Paper document icon appears center-left
  // 40-80: Paper title text appears
  // 70-110: GPL-3.0 badge appears center-right
  // 100-280: River of light flows across bottom
  // 160-220: Stone drops into river (the metaphor)
  // 200-260: Quote text
  // 260-300: Fade out

  // Paper entry
  const paperEntry = Math.min(1.05, Math.max(0, spring({
    frame: frame - 15, fps, config: GENTLE,
  })));

  // Paper title
  const titleEntry = Math.min(1, Math.max(0, spring({
    frame: frame - 45, fps, config: GENTLE,
  })));

  // GPL badge
  const badgeEntry = Math.min(1.08, Math.max(0, spring({
    frame: frame - 75, fps, config: { damping: 12, stiffness: 100, mass: 0.8 },
  })));

  // River intensity
  const riverOp = interpolate(frame, [80, 120, 260, 290], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Stone drop
  const stoneY = interpolate(frame, [165, 190], [-40, 760], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.in(Easing.cubic),
  });
  const stoneOp = interpolate(frame, [165, 175, 195, 220], [0, 1, 0.8, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const rippleSize = interpolate(frame, [190, 250], [0, 120], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const rippleOp = interpolate(frame, [190, 210, 250], [0.5, 0.3, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Quote text
  const q1 = Math.min(1, Math.max(0, spring({ frame: frame - 205, fps, config: GENTLE })));
  const q2 = Math.min(1, Math.max(0, spring({ frame: frame - 222, fps, config: GENTLE })));
  const textOut = interpolate(frame, [durationInFrames - 50, durationInFrames - 18], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: master }}>
      {/* Background */}
      <AbsoluteFill style={{
        background: 'radial-gradient(ellipse at 50% 35%, #101418 0%, #06080c 55%, #000000 100%)',
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

      {/* River of light */}
      {RIVER.map((p, i) => {
        const x = ((frame * p.speed + p.phase) % 2100) - 100;
        const y = p.y + p.yDrift + Math.sin(frame * 0.02 + i) * 10;
        return (
          <React.Fragment key={`r${i}`}>
            <div style={{
              position: 'absolute',
              left: x - 30, top: y - 1,
              width: 30, height: 2,
              background: `linear-gradient(to right, transparent, ${p.color})`,
              opacity: p.alpha * riverOp * 0.4,
            }} />
            <div style={{
              position: 'absolute',
              left: x - p.size / 2, top: y - p.size / 2,
              width: p.size, height: p.size, borderRadius: '50%',
              backgroundColor: p.color,
              opacity: p.alpha * riverOp,
              boxShadow: `0 0 4px ${p.color}`,
            }} />
          </React.Fragment>
        );
      })}

      {/* Paper document */}
      <div style={{
        position: 'absolute', left: 380, top: 180,
        width: 300, height: 400,
        borderRadius: 10,
        backgroundColor: 'rgba(12,14,22,0.9)',
        border: '1.5px solid rgba(0,255,255,0.3)',
        opacity: Math.min(1, paperEntry),
        transform: `scale(${Math.min(1, paperEntry)})`,
        boxShadow: '0 0 20px rgba(0,255,255,0.1)',
        padding: 25,
        fontFamily: '"Courier New", monospace',
      }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: SKY.muted, marginBottom: 12 }}>
          RESEARCH PAPER
        </div>
        <div style={{
          fontSize: 13, fontWeight: 'bold', color: SKY.cyan,
          lineHeight: 1.5, opacity: titleEntry,
        }}>
          Structured Dialectical Debate Degrades LLM Accuracy in Cybersecurity Threat Analysis
        </div>
        <div style={{ fontSize: 10, color: SKY.muted, marginTop: 12, opacity: titleEntry }}>
          Targeting: AISec at CCS
        </div>
        {/* Fake abstract lines */}
        {Array.from({ length: 10 }, (_, i) => (
          <div key={`al${i}`} style={{
            marginTop: i === 0 ? 20 : 8,
            width: `${60 + random(`aw${i}`) * 35}%`,
            height: 6, borderRadius: 3,
            backgroundColor: 'rgba(255,255,255,0.05)',
            opacity: titleEntry,
          }} />
        ))}
      </div>

      {/* GPL-3.0 badge */}
      <div style={{
        position: 'absolute', left: 1120, top: 280,
        opacity: Math.min(1, badgeEntry),
        transform: `scale(${Math.min(1, badgeEntry)})`,
        textAlign: 'center',
      }}>
        <div style={{
          width: 200, height: 200,
          borderRadius: '50%',
          border: `3px solid ${SKY.green}`,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 0 25px rgba(0,255,136,0.2)`,
          backgroundColor: 'rgba(0,255,136,0.05)',
        }}>
          <div style={{
            fontSize: 14, letterSpacing: 3, fontWeight: 'bold',
            color: SKY.green, fontFamily: '"Courier New", monospace',
          }}>
            OPEN SOURCE
          </div>
          <div style={{
            fontSize: 32, fontWeight: 'bold', marginTop: 8,
            color: SKY.green, fontFamily: '"Georgia", serif',
          }}>
            GPL-3.0
          </div>
        </div>
        <div style={{
          fontSize: 12, letterSpacing: 2, marginTop: 14,
          color: SKY.muted, fontFamily: '"Courier New", monospace',
        }}>
          NOT FOR PROFIT
        </div>
      </div>

      {/* Stone */}
      {stoneOp > 0 && (
        <div style={{
          position: 'absolute',
          left: 960 - 12, top: stoneY,
          width: 24, height: 24, borderRadius: 6,
          backgroundColor: SKY.yellow,
          opacity: stoneOp,
          boxShadow: '0 0 12px rgba(255,255,0,0.5)',
          transform: `rotate(${frame * 2}deg)`,
        }} />
      )}

      {/* Ripple from stone */}
      {rippleOp > 0 && (
        <div style={{
          position: 'absolute',
          left: 960 - rippleSize, top: 760 - rippleSize / 3,
          width: rippleSize * 2, height: rippleSize * 0.6,
          borderRadius: '50%',
          border: `1px solid rgba(255,255,0,${rippleOp})`,
        }} />
      )}

      {/* Quote */}
      <div style={{
        position: 'absolute', bottom: 50, left: 0, right: 0,
        textAlign: 'center', fontFamily: '"Georgia", serif',
      }}>
        <div style={{
          fontSize: 30, fontStyle: 'italic', letterSpacing: 2,
          color: SKY.yellow,
          opacity: q1 * textOut,
          transform: `translateY(${interpolate(q1, [0, 1], [25, 0])}px)`,
          textShadow: '0 0 20px rgba(255,255,0,0.3)',
        }}>
          "Placing a stone in the flow
        </div>
        <div style={{
          fontSize: 30, fontStyle: 'italic', letterSpacing: 2,
          color: SKY.yellow, marginTop: 10,
          opacity: q2 * textOut,
          transform: `translateY(${interpolate(q2, [0, 1], [25, 0])}px)`,
          textShadow: '0 0 20px rgba(255,255,0,0.3)',
        }}>
          of this magnificent river."
        </div>
      </div>
    </AbsoluteFill>
  );
};

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
// BEAT 5 — THE CLOSED WORLD
// Every claim must trace to a frozen EvidencePacket.
// Vault of data cubes. Ghost claim gets rejected.
// Emotion: Rigor, trust, engineering pride
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

// Evidence cubes in a grid layout
const CUBES = Array.from({ length: 12 }, (_, i) => {
  const col = i % 4;
  const row = Math.floor(i / 4);
  return {
    x: 680 + col * 150,
    y: 260 + row * 160,
    label: ['SRC:0x7F', 'PKT:443', 'LOG:AUTH', 'SIG:RSA',
            'NET:TCP', 'DNS:REC', 'TLS:1.3', 'FW:DROP',
            'IDS:ALT', 'CVE:2024', 'HASH:B7', 'PORT:22'][i],
  };
});

// Ghost claim (rejected)
const GHOST = { x: 960, y: 120, label: '???:NULL' };

// Dust
const DUST = Array.from({ length: 35 }, (_, i) => ({
  x: random(`dx${i}`) * 1920,
  y: random(`dy${i}`) * 1080,
  size: 1.5 + random(`ds${i}`) * 2.5,
  speed: 0.5 + random(`dv${i}`) * 1,
  phase: random(`dp${i}`) * Math.PI * 2,
  baseAlpha: 0.05 + random(`da${i}`) * 0.08,
}));

export const Beat05ClosedWorld = () => {
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
  // 0-80: Cubes pop in staggered, each with lock icon
  // 80-130: All cubes glow green (accepted evidence)
  // 130-180: Ghost claim drifts in from top, red/translucent
  // 170-210: Ghost bounces off / gets rejected (red X, shake)
  // 210-260: Text: "IF IT'S NOT IN THE DATA, IT DOESN'T EXIST"
  // 260-300: Fade out

  // Cube entries
  const cubeEntries = CUBES.map((_, i) => {
    const delay = 15 + i * 5;
    return Math.min(1.08, Math.max(0, spring({
      frame: frame - delay, fps, config: { damping: 12, stiffness: 100, mass: 0.8 },
    })));
  });

  // Cube accepted glow
  const acceptedGlow = interpolate(frame, [80, 110], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Ghost entry and rejection
  const ghostEntry = interpolate(frame, [130, 160], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const ghostReject = Math.min(1, Math.max(0, spring({
    frame: frame - 175, fps, config: { damping: 8, stiffness: 200, mass: 0.5 },
  })));
  const ghostShake = frame >= 175 && frame <= 190
    ? Math.sin((frame - 175) * 4) * (190 - frame) * 0.6
    : 0;
  const ghostFadeOut = interpolate(frame, [190, 210], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Text
  const t1 = Math.min(1, Math.max(0, spring({ frame: frame - 215, fps, config: GENTLE })));
  const t2 = Math.min(1, Math.max(0, spring({ frame: frame - 232, fps, config: GENTLE })));
  const textOut = interpolate(frame, [durationInFrames - 50, durationInFrames - 18], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: master }}>
      {/* Background */}
      <AbsoluteFill style={{
        background: 'radial-gradient(ellipse at 50% 50%, #101822 0%, #080c14 55%, #000000 100%)',
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

      {/* Evidence cubes */}
      {CUBES.map((cube, i) => {
        const entry = cubeEntries[i];
        if (entry <= 0) return null;
        const cubeSize = 110;
        const glowColor = acceptedGlow > 0
          ? interpolateColors(acceptedGlow, [0, 1], ['rgba(0,255,255,0.15)', 'rgba(0,255,136,0.3)'])
          : 'rgba(0,255,255,0.15)';
        const borderC = acceptedGlow > 0
          ? interpolateColors(acceptedGlow, [0, 1], ['rgba(0,255,255,0.4)', 'rgba(0,255,136,0.6)'])
          : 'rgba(0,255,255,0.4)';
        return (
          <div key={`cube${i}`} style={{
            position: 'absolute',
            left: cube.x - cubeSize / 2, top: cube.y - cubeSize / 2,
            width: cubeSize, height: cubeSize,
            borderRadius: 10,
            backgroundColor: 'rgba(10,15,25,0.9)',
            border: `1.5px solid ${borderC}`,
            opacity: Math.min(1, entry),
            transform: `scale(${Math.min(1, entry)})`,
            boxShadow: `0 0 12px ${glowColor}`,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            fontFamily: '"Courier New", monospace',
          }}>
            {/* Lock icon */}
            <div style={{
              fontSize: 22, marginBottom: 6,
              color: acceptedGlow > 0
                ? interpolateColors(acceptedGlow, [0, 1], [SKY.cyan, SKY.green])
                : SKY.cyan,
            }}>
              {acceptedGlow > 0.5 ? '\u2713' : '\u{1F512}'}
            </div>
            <div style={{
              fontSize: 11, letterSpacing: 1.5, fontWeight: 'bold',
              color: SKY.cyan,
            }}>
              {cube.label}
            </div>
          </div>
        );
      })}

      {/* Ghost claim (rejected) */}
      {ghostEntry > 0 && ghostFadeOut > 0 && (
        <div style={{
          position: 'absolute',
          left: GHOST.x - 55 + ghostShake,
          top: interpolate(ghostEntry, [0, 1], [-60, GHOST.y]) - (ghostReject * 40),
          width: 110, height: 110,
          borderRadius: 10,
          backgroundColor: 'rgba(255,51,68,0.08)',
          border: `2px dashed ${SKY.red}`,
          opacity: ghostFadeOut * 0.8,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          fontFamily: '"Courier New", monospace',
        }}>
          <div style={{ fontSize: 24, color: SKY.red }}>
            {ghostReject > 0.5 ? '\u2717' : '?'}
          </div>
          <div style={{
            fontSize: 11, letterSpacing: 1.5, fontWeight: 'bold',
            color: SKY.red, marginTop: 4,
          }}>
            {GHOST.label}
          </div>
          {/* REJECTED label */}
          {ghostReject > 0.5 && (
            <div style={{
              position: 'absolute', top: -20,
              fontSize: 10, letterSpacing: 3, fontWeight: 'bold',
              color: SKY.red, opacity: ghostReject,
            }}>
              REJECTED
            </div>
          )}
        </div>
      )}

      {/* Text */}
      <div style={{
        position: 'absolute', bottom: 100, left: 0, right: 0,
        textAlign: 'center', fontFamily: '"Georgia", serif',
      }}>
        <div style={{
          fontSize: 36, fontWeight: 'bold', letterSpacing: 3,
          color: SKY.white,
          opacity: t1 * textOut,
          transform: `translateY(${interpolate(t1, [0, 1], [25, 0])}px)`,
          textShadow: '0 0 20px rgba(0,255,136,0.2)',
        }}>
          IF IT'S NOT IN THE DATA
        </div>
        <div style={{
          fontSize: 42, fontWeight: 'bold', letterSpacing: 5,
          color: SKY.green, marginTop: 14,
          opacity: t2 * textOut,
          transform: `translateY(${interpolate(t2, [0, 1], [25, 0])}px)`,
          textShadow: '0 0 30px rgba(0,255,136,0.4)',
        }}>
          IT DOESN'T EXIST
        </div>
      </div>
    </AbsoluteFill>
  );
};

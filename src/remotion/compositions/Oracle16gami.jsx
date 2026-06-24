import React from 'react';
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Easing,
  Img,
  staticFile,
  AbsoluteFill,
} from 'remotion';

// ═══════════════════════════════════════════════════════════
// 16-GAMI TEST — The Oracle (3-Layer Progressive Reveal)
//
// Layer 0: Temple environment (columns + floor)
// Layer 1: Environment + evidence pedestal
// Layer 2: Full scene with Oracle character
//
// Progressive crossfade: each image materializes on top
// of the previous, giving the illusion of paper layers
// being placed one by one.
// ═══════════════════════════════════════════════════════════

const FOLD_SPRING = { damping: 8, stiffness: 180, mass: 0.6 };
const SLIDE_SPRING = { damping: 14, stiffness: 100, mass: 0.8 };

export const Oracle16gami = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Master fade
  const fadeIn = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(frame, [durationInFrames - 40, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const master = fadeIn * fadeOut;

  // ── Layer 0: Background environment ─────────────────────
  // Fades in with subtle scale (0.95 → 1.0)
  const bgOpacity = interpolate(frame, [10, 50], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const bgScale = interpolate(bgOpacity, [0, 1], [0.95, 1]);

  // ── Layer 1: Pedestal appears ───────────────────────────
  // Crossfades over the BG — pedestal "materializes"
  const pedastalPop = Math.max(0, spring({
    frame: frame - 75, fps, config: FOLD_SPRING,
  }));
  const pedastalOpacity = Math.min(1, pedastalPop);
  const pedastalScale = interpolate(
    Math.min(1.06, pedastalPop), [0, 1.06], [0.97, 1.0]
  );

  // ── Layer 2: Oracle character appears ───────────────────
  // Crossfades over pedestal layer — Oracle "steps into existence"
  const oraclePop = Math.max(0, spring({
    frame: frame - 140, fps, config: { damping: 10, stiffness: 150, mass: 0.7 },
  }));
  const oracleOpacity = Math.min(1, oraclePop);
  const oracleScale = interpolate(
    Math.min(1.05, oraclePop), [0, 1.05], [0.97, 1.0]
  );

  // ── Idle breathing (after all layers settled) ───────────
  const allSettled = frame > 200;
  const idle0 = allSettled ? Math.sin(frame * 0.02) * 2 : 0;
  const idle1 = allSettled ? Math.sin(frame * 0.025 + 0.8) * 2.5 : 0;
  const idle2 = allSettled ? Math.sin(frame * 0.03 + 1.6) * 3 : 0;

  // ── Ambient glow pulse on final layer ───────────────────
  const glowPulse = allSettled
    ? 0.85 + 0.15 * Math.sin(frame * 0.06)
    : 1;

  // Shared image style (cover the full canvas)
  const imgStyle = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  };

  return (
    <AbsoluteFill style={{ opacity: master, backgroundColor: '#0a0a0f' }}>

      {/* Layer 0: Temple environment */}
      <Img
        src={staticFile('oracle_bg.jpg')}
        style={{
          ...imgStyle,
          position: 'absolute',
          opacity: bgOpacity,
          transform: `scale(${bgScale}) translateY(${idle0}px)`,
        }}
      />

      {/* Layer 1: Environment + Pedestal */}
      <Img
        src={staticFile('oracle_pedestal.jpg')}
        style={{
          ...imgStyle,
          position: 'absolute',
          opacity: pedastalOpacity,
          transform: `scale(${pedastalScale}) translateY(${idle1}px)`,
          filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.2))',
        }}
      />

      {/* Layer 2: Full scene with Oracle */}
      <Img
        src={staticFile('oracle_full.png')}
        style={{
          ...imgStyle,
          position: 'absolute',
          opacity: oracleOpacity,
          transform: `scale(${oracleScale}) translateY(${idle2}px)`,
          filter: `drop-shadow(0 15px 30px rgba(0,0,0,0.25)) brightness(${glowPulse})`,
        }}
      />

      {/* Subtle vignette overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at 50% 40%, transparent 50%, rgba(0,0,0,0.4) 100%)',
        pointerEvents: 'none',
      }} />
    </AbsoluteFill>
  );
};

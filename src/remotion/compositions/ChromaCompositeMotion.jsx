import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';

/**
 * Chroma Composite Tier 2 — animated character over slide background.
 *
 * Builds on Tier 1 (static chromakey extract). Tier 1 produces a transparent
 * PNG of the character; Tier 2 animates that PNG over a slide background,
 * with a drop shadow underneath that tracks the character.
 *
 * Props:
 *   backgroundPath   — path to slide background (relative to public/)
 *   characterPath    — path to transparent character PNG (relative to public/)
 *   motion           — { entry, exit, entryDurationS, exitDurationS, holdScale, holdX, holdY }
 *                      entry / exit: 'slide-right' | 'slide-left' | 'fade' | 'zoom' | 'none'
 *                      holdX / holdY: center offset in px (0 = centered)
 *                      holdScale: 0.5..1.5 (character size during the hold)
 *   shadow           — { enabled, blur, offsetY, opacity }
 *
 * Dimensions default to 1080x1350 to match the carousel slide aspect.
 */

function interpolateMotion({ frame, fps, totalDur, entryDur, exitDur, kind, axis }) {
  // Returns an 'amount' in [0..1] where 0 is off-screen (entry/exit) and 1 is seated (hold).
  const entryEnd = entryDur;
  const exitStart = totalDur - exitDur;
  if (frame < entryEnd * fps) {
    return interpolate(frame, [0, entryEnd * fps], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateRight: 'clamp' });
  }
  if (frame > exitStart * fps) {
    return interpolate(frame, [exitStart * fps, totalDur * fps], [1, 0], { easing: Easing.in(Easing.cubic), extrapolateLeft: 'clamp' });
  }
  return 1;
}

export const ChromaCompositeMotion = ({
  backgroundPath,
  characterPath,
  motion,
  shadow,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const totalDur = durationInFrames / fps;

  const m = motion || {};
  const entryKind = m.entry || 'slide-right';
  const exitKind = m.exit || 'slide-left';
  const entryDur = typeof m.entryDurationS === 'number' ? m.entryDurationS : 0.8;
  const exitDur = typeof m.exitDurationS === 'number' ? m.exitDurationS : 0.8;
  const holdScale = typeof m.holdScale === 'number' ? m.holdScale : 1.0;
  const holdX = typeof m.holdX === 'number' ? m.holdX : 0;
  const holdY = typeof m.holdY === 'number' ? m.holdY : 0;

  const sh = shadow || {};
  const shadowEnabled = sh.enabled !== false;
  const shadowBlur = typeof sh.blur === 'number' ? sh.blur : 30;
  const shadowOffsetY = typeof sh.offsetY === 'number' ? sh.offsetY : 20;
  const shadowOpacity = typeof sh.opacity === 'number' ? sh.opacity : 0.5;

  // 'amount' ∈ [0..1] governs how far into the scene the character is.
  const amount = interpolateMotion({ frame, fps, totalDur, entryDur, exitDur });

  // Resolve per-axis transforms based on motion kind.
  // During entry: amount goes 0→1 (off → seated). During exit: amount goes 1→0.
  const phase = frame < entryDur * fps ? 'entry' : frame > (totalDur - exitDur) * fps ? 'exit' : 'hold';
  const kind = phase === 'exit' ? exitKind : entryKind;

  let translateX = 0;
  let translateY = 0;
  let opacity = 1;
  let scale = holdScale;

  switch (kind) {
    case 'slide-right':
      translateX = (1 - amount) * width * 0.6;
      break;
    case 'slide-left':
      translateX = -(1 - amount) * width * 0.6;
      break;
    case 'fade':
      opacity = amount;
      break;
    case 'zoom':
      opacity = amount;
      scale = holdScale * (0.6 + 0.4 * amount);
      break;
    case 'none':
    default:
      // No transition; character is always seated. Good for static compositions.
      break;
  }

  const charWrapStyle = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: `translate(-50%, -50%) translate(${holdX + translateX}px, ${holdY + translateY}px) scale(${scale})`,
    opacity,
    transformOrigin: 'center center',
  };

  const imgFilter = shadowEnabled
    ? `drop-shadow(0px ${shadowOffsetY}px ${shadowBlur}px rgba(0,0,0,${shadowOpacity}))`
    : 'none';

  const bgSrc = backgroundPath ? staticFile(backgroundPath) : null;
  const charSrc = characterPath ? staticFile(characterPath) : null;

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a0f' }}>
      {bgSrc && (
        <Img
          src={bgSrc}
          style={{ position: 'absolute', left: 0, top: 0, width, height, objectFit: 'cover' }}
        />
      )}

      {charSrc && (
        <div style={charWrapStyle}>
          <Img
            src={charSrc}
            style={{
              maxWidth: width * 0.85,
              maxHeight: height * 0.85,
              width: 'auto',
              height: 'auto',
              display: 'block',
              filter: imgFilter,
            }}
          />
        </div>
      )}
    </AbsoluteFill>
  );
};

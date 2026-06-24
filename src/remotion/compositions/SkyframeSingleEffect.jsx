// ─── SkyframeSingleEffect ────────────────────────────────────────────────
// Wraps ONE Skyframe component at full-frame transparent for the duration
// of the comp. Driven by SkyframePickerNode → /api/remotion/skyframe-effect
// → renders a per-effect transparent .webm into public/skyframe/ that the
// Cartesian Composer consumes via its content-pool handle.
//
// Single-effect by design — operator picks the effect + props once, the
// composition runs that effect from 0 to durationInFrames/fps. No audio
// (single-effect = pure visual primitive; audio cues stay a Cartesian /
// FFmpeg concern downstream).
//
// Props shape (from /api/remotion/skyframe-effect body):
// {
//   "effectType": "RayBanIntro" | "KaraokeCard" | "CompactCard"
//                | "Win95Terminal" | "OpusGlisten" | "AsciiPlanet",
//   "props":     { ...component-specific props }
// }
//
// Duration is set on the Composition via calculateMetadata reading
// props.durationInFrames (mirrors SkyframeOverlay's pattern).

import React, { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  RayBanIntro,
  KaraokeCard,
  AppleGlassTile,
  CompactCard,
  Win95Terminal,
  OpusGlisten,
  AsciiPlanet,
  ensureFonts,
} from '../skyframe/index.js';

const COMPONENTS = {
  RayBanIntro,
  KaraokeCard,
  AppleGlassTile,
  CompactCard,
  Win95Terminal,
  OpusGlisten,
  AsciiPlanet,
};

export const SkyframeSingleEffect = ({ effectType, props = {} }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('Loading Skyframe fonts'));
  useEffect(() => {
    ensureFonts().then(() => continueRender(fontHandle));
  }, [fontHandle]);

  const Comp = COMPONENTS[effectType];
  if (!Comp) return null;

  const endSec = durationInFrames / fps;

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <Comp
        frame={frame}
        fps={fps}
        startSec={0}
        endSec={endSec}
        {...props}
      />
    </AbsoluteFill>
  );
};

// ─── SkyframeOverlay ─────────────────────────────────────────────────────
// Generic Skyframe driver — reads `beats[]` and `audioCues` from input props
// and dispatches each beat to its component by `type`. Produced automatically
// by `shortform-cli.js process --overlay skyframe-5beat` from a transcript-
// driven Claude beat plan.
//
// For hand-tuned overlays (more control over per-beat props), copy
// PracticeOverlay009.jsx and edit anchor windows directly. This composition
// is the automated path; that one is the canonical hand-authored path.
//
// Props shape (from skyframe_overlay_props.json):
// {
//   "beats": [
//     { "type": "RayBanIntro", "startSec": 0, "endSec": 3.0,
//       "props": { topWord, heroPhrase, midWord, pixelPhrase, subtitle } },
//     { "type": "KaraokeCard", "startSec": 6.0, "endSec": 12.0,
//       "props": { position, eyebrow, words: [...], heroWord } },
//     { "type": "CompactCard" | "Win95Terminal" | "OpusGlisten" | "AsciiPlanet", ... }
//   ],
//   "audioCues": { "bubbles": [144, 372], "whooshes": [547], "chime": 892 },
//   "durationInFrames": 1450
// }

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
  SkyframeAudioCues,
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

export const SkyframeOverlay = ({ beats = [], audioCues = {} }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('Loading Skyframe fonts'));
  useEffect(() => {
    ensureFonts().then(() => continueRender(fontHandle));
  }, [fontHandle]);

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      {beats.map((beat, i) => {
        const Comp = COMPONENTS[beat.type];
        if (!Comp) return null;
        return (
          <Comp
            key={i}
            frame={frame}
            fps={fps}
            startSec={beat.startSec}
            endSec={beat.endSec}
            {...(beat.props || {})}
          />
        );
      })}
      <SkyframeAudioCues
        bubbles={audioCues.bubbles || []}
        whooshes={audioCues.whooshes || []}
        chime={audioCues.chime}
        chime2={audioCues.chime2 || []}
      />
    </AbsoluteFill>
  );
};

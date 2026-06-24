// ─── PracticeOverlay012 — Build-Day Diary recipe template ────────────────
// Skyframe variant for "I built X today" content. Terminal-heavy, builder
// energy, celebratory not threat-reveal. Uses the new LowerThirdChyron to
// name the tool/feature, then walks through the command and the output.
//
// 5-beat structure (6 timed elements including tail):
//   Beat 1 (HOOK)    0–2.0s     RayBanIntro     "I SHIPPED TODAY / <TOOL NAME>"
//   Beat 2 (SUBJECT) 5–12s      LowerThirdChyron  naming the tool / engine
//   Beat 3 (SUBJECT) 13–20s     CompactCard     "/<command>" with payoff
//   Beat 4 (SUBJECT) 21–28s     Win95Terminal   build output / breakthrough line
//   Tail decoration  29–34s     AsciiPlanet     "system / stack / pipeline" energy
//   Beat 5 (CTA)     34–37s     OpusGlisten     hero impact word
//
// Authoring workflow: copy this file → PracticeOverlay0XX.jsx for each new
// build-day video, swap the placeholder words below for the actual script.
// Register the new composition in Root.jsx with the matching frame count.

import React, { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  useCurrentFrame,
  useVideoConfig,
  Audio,
  Sequence,
  staticFile,
} from 'remotion';
import {
  RayBanIntro,
  LowerThirdChyron,
  CompactCard,
  Win95Terminal,
  AsciiPlanet,
  OpusGlisten,
  SkyframeAudioCues,
  ensureFonts,
} from '../skyframe/index.js';

export const PracticeOverlay012 = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('Loading Skyframe fonts'));
  useEffect(() => {
    ensureFonts().then(() => continueRender(fontHandle));
  }, [fontHandle]);

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      {/* Beat 1 — HOOK (paired with FFmpeg gblur 0–2s for the blurred intro look) */}
      <RayBanIntro
        frame={frame} fps={fps}
        startSec={0} endSec={2.0}
        topWord="I"
        heroPhrase="SHIPPED TODAY"
        midWord="meet"
        pixelPhrase="BREADSTICK"
        subtitle="the endgame substrate."
      />

      {/* Beat 2 — anchor: first mention of the tool name */}
      <LowerThirdChyron
        frame={frame} fps={fps}
        startSec={5.0} endSec={12.0}
        eyebrow="ENGINE"
        name="BREADSTICK"
        subtitle="endgame substrate · ships empty"
      />

      {/* Beat 3 — anchor: command demo */}
      <CompactCard
        frame={frame} fps={fps}
        startSec={13.0} endSec={20.0}
        command="/run"
        subtitle="orchestrates the whole pipeline"
      />

      {/* Beat 4 — anchor: build output / breakthrough */}
      <Win95Terminal
        frame={frame} fps={fps}
        startSec={21.0} endSec={28.0}
        command="/render"
        payoff="Shipped 5 blocks. Endgame ~100%."
      />

      {/* Tail decoration — system / stack / pipeline energy */}
      <AsciiPlanet
        frame={frame} fps={fps}
        startSec={29.0} endSec={34.0}
      />

      {/* Beat 5 — CTA hero word (last replay-worthy word of the script) */}
      <OpusGlisten
        frame={frame} fps={fps}
        startSec={34.0} endSec={37.0}
        word="SHIPPED"
        fontSize={194}
        caretHeight={146}
      />

      {/* Audio cues — 4 bubbles + 1 chime; whooshes locked out (cybersec doctrine
          extended to Build-Day for the same dense-dialog reason) */}
      <SkyframeAudioCues
        bubbles={[0, 150, 390, 630]}
        whooshes={[]}
        chime={1084}
      />

      {/* Build-Day signature — mouse-click on the LowerThirdChyron slide-in */}
      <Sequence from={Math.round(5.0 * fps + 10)} durationInFrames={24}>
        <Audio src={staticFile('sounds/mouse-click.mp3')} />
      </Sequence>
    </AbsoluteFill>
  );
};

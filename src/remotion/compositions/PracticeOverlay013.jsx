// ─── PracticeOverlay013 — Plan-It-Out recipe template ────────────────────
// Skyframe variant for "5 things to do before X" / numbered receipt content.
// Uses StatCallout three times as the load-bearing visual rhythm — each
// item lands as a big number with a label. Save-bait energy, chases the
// ≥20% save-rate north star.
//
// 5-beat structure:
//   Beat 1 (HOOK)    0–2.0s     RayBanIntro       promise of the list
//   Beat 2 (ITEM 1)  5–10s      StatCallout #1
//   Beat 3 (ITEM 2)  11–16s     StatCallout #2
//   Beat 4 (ITEM 3)  17–22s     StatCallout #3
//   Tail decoration  23–27s     AsciiPlanet       global/everywhere energy
//   Beat 5 (CTA)     28–31s     OpusGlisten       save-trigger word
//
// Note: NO Win95Terminal, NO CompactCard, NO KaraokeCard — this is pure
// receipt-stack. The visual cadence is "boom · boom · boom · sparkle."

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
  StatCallout,
  AsciiPlanet,
  OpusGlisten,
  SkyframeAudioCues,
  ensureFonts,
} from '../skyframe/index.js';

export const PracticeOverlay013 = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('Loading Skyframe fonts'));
  useEffect(() => {
    ensureFonts().then(() => continueRender(fontHandle));
  }, [fontHandle]);

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      {/* Beat 1 — HOOK (paired with FFmpeg gblur 0–2s) */}
      <RayBanIntro
        frame={frame} fps={fps}
        startSec={0} endSec={2.0}
        topWord="3"
        heroPhrase="THINGS"
        midWord="before you"
        pixelPhrase="SHIP AI"
        subtitle="that will save your stack."
      />

      {/* Beat 2 — STAT #1 */}
      <StatCallout
        frame={frame} fps={fps}
        startSec={5.0} endSec={10.0}
        value={1}
        prefix="#"
        label="AUDIT THE LOGIC"
        fontSize={280}
      />

      {/* Beat 3 — STAT #2 */}
      <StatCallout
        frame={frame} fps={fps}
        startSec={11.0} endSec={16.0}
        value={2}
        prefix="#"
        label="REMOVE HARDCODED SECRETS"
        fontSize={280}
      />

      {/* Beat 4 — STAT #3 */}
      <StatCallout
        frame={frame} fps={fps}
        startSec={17.0} endSec={22.0}
        value={3}
        prefix="#"
        label="PIN DEPENDENCY VERSIONS"
        fontSize={280}
      />

      {/* Tail decoration */}
      <AsciiPlanet
        frame={frame} fps={fps}
        startSec={23.0} endSec={27.0}
      />

      {/* Beat 5 — CTA save-trigger word */}
      <OpusGlisten
        frame={frame} fps={fps}
        startSec={28.0} endSec={31.0}
        word="CHECKLIST"
        fontSize={170}
        caretHeight={128}
      />

      {/* Audio cues — bubble at each item entry + chime at Opus peak */}
      <SkyframeAudioCues
        bubbles={[0, 150, 330, 510]}
        whooshes={[]}
        chime={Math.round(28.0 * 30) + 64}
      />

      {/* Plan-It-Out signature — digital-click bursts on each StatCallout count-up
          and a chime2 on each landing for the receipt cadence. */}
      {[5.0, 11.0, 17.0].map((startSec, sceneIdx) =>
        [0.35, 0.55].map((offset, i) => (
          <Sequence key={`tick-${sceneIdx}-${i}`}
            from={Math.round((startSec + offset) * 30)}
            durationInFrames={8}>
            <Audio src={staticFile('sounds/digital-click.mp3')} volume={0.5} />
          </Sequence>
        ))
      )}
      {[5.0, 11.0, 17.0].map((startSec, i) => (
        <Sequence key={`land-${i}`}
          from={Math.round((startSec + 1.1) * 30)}
          durationInFrames={36}>
          <Audio src={staticFile('sounds/chime2.mp3')} volume={0.7} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

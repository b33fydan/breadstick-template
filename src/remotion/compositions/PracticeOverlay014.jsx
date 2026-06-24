// ─── PracticeOverlay014 — Hot Take recipe template ──────────────────────
// Skyframe variant for contrarian commentary — "everyone's wrong about X,
// here's why." Uses CircleHighlight to literally circle the wrong opinion,
// then TrashCompactor to compress it, then Win95Terminal for the corrected
// take. The only recipe that legitimately uses whoosh (on TrashCompactor).
//
// 5-beat structure:
//   Beat 1 (HOOK)        0–2.0s    RayBanIntro          contrarian frame
//   Beat 2 (CONVENTIONAL) 5–10s     KaraokeCard          the wrong opinion
//        circle overlay  7–10s     CircleHighlight       wraps the wrong-take hero word
//   Beat 3 (COMPRESS)    10–13s    TrashCompactor       literal "compress the bad take"
//   Beat 4 (TRUTH)       14–22s    Win95Terminal        corrected take typed out
//   Tail decoration      23–26s    (none — quiet tail)
//   Beat 5 (CTA)         24–27s    OpusGlisten          contrarian word
//
// Earned use of whoosh: ONCE on the TrashCompactor wipe. The "compress
// wrong take" beat literally needs the whoosh — anywhere else it's noise.

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
  KaraokeCard,
  CircleHighlight,
  TrashCompactor,
  Win95Terminal,
  OpusGlisten,
  SkyframeAudioCues,
  ensureFonts,
} from '../skyframe/index.js';

export const PracticeOverlay014 = () => {
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
        topWord="EVERYONE'S"
        heroPhrase="WRONG ABOUT"
        midWord="this"
        pixelPhrase="AI TAKE"
        subtitle="and here's why."
      />

      {/* Beat 2 — the conventional wisdom, with hero word "wrong" */}
      <KaraokeCard
        frame={frame} fps={fps}
        startSec={5.0} endSec={10.0}
        position="bottom-left"
        eyebrow="The Take"
        words={['You', 'just', 'need', 'more', 'data.']}
        heroWord="data."
      />

      {/* Circle Highlight wraps the hero word in Beat 2 — operator positions over
          the KaraokeCard hero text. % coords approximate the bottom-left hero word
          position for a 1080×1920 canvas. */}
      <CircleHighlight
        frame={frame} fps={fps}
        startSec={7.5} endSec={10.5}
        x={12} y={70} w={36} h={8}
      />

      {/* Beat 3 — literal "compress the bad take" with whoosh */}
      <TrashCompactor
        frame={frame} fps={fps}
        startSec={10.0} endSec={13.0}
      />

      {/* Beat 4 — the corrected take */}
      <Win95Terminal
        frame={frame} fps={fps}
        startSec={14.0} endSec={22.0}
        command="/think"
        payoff="You need better questions, not more data."
      />

      {/* Beat 5 — CTA contrarian word */}
      <OpusGlisten
        frame={frame} fps={fps}
        startSec={24.0} endSec={27.0}
        word="QUESTIONS"
        fontSize={170}
        caretHeight={128}
      />

      {/* Audio cues — 3 bubbles (intro / Karaoke / Win95), ONE whoosh on Compactor,
          chime at Opus peak */}
      <SkyframeAudioCues
        bubbles={[0, 150, 420]}
        whooshes={[300]}
        chime={Math.round(24.0 * 30) + 64}
      />

      {/* Hot Take signature — chime2 on CircleHighlight completion */}
      <Sequence from={Math.round(7.5 * 30) + 30} durationInFrames={36}>
        <Audio src={staticFile('sounds/chime2.mp3')} volume={0.7} />
      </Sequence>
    </AbsoluteFill>
  );
};

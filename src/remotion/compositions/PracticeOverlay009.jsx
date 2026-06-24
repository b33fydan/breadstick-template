// ─── PracticeOverlay009 ──────────────────────────────────────────────────
// Canonical reference for the Skyframe shortform template.
//
// Source video:    renders/popped/test007.mp4 (48.5s, "Cloud Code limits")
// 5-beat structure:
//   Beat 1 (HOOK)    0–3.0s    RayBanIntro
//   Beat 2 (SUBJECT) 6–12s     KaraokeCard "Keep CLAUDE.md under 40K..."
//   Beat 3 (SUBJECT) 15.5–21s  CompactCard + TrashCompactor
//   Beat 4 (SUBJECT) 21.5–28s  Win95Terminal "/clear" → "Fresh context."
//   Beat 5 (CTA)     34.5–38s  OpusGlisten on the word "Opus" + chime
//   Tail decoration  38–43s    AsciiPlanet ("for the real WORK")
//
// Each effect is anchored to spoken word timestamps from the transcript
// (renders/popped/edit/transcripts/test007.json). For new videos, copy this
// composition to PracticeOverlay010+, change the anchor windows + words,
// and the same visual language ports cleanly.
//
// Skill: skills/breadstick-skyframe-template/SKILL.md
// Components: src/remotion/skyframe/

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
  CompactCard,
  Win95Terminal,
  OpusGlisten,
  AsciiPlanet,
  SkyframeAudioCues,
  ensureFonts,
} from '../skyframe/index.js';

export const PracticeOverlay009 = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('Loading Skyframe fonts'));
  useEffect(() => {
    ensureFonts().then(() => continueRender(fontHandle));
  }, [fontHandle]);

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      {/* Beat 1 — HOOK (always RayBanIntro, 3s, doubles as portrait thumb) */}
      <RayBanIntro
        frame={frame} fps={fps}
        startSec={0} endSec={3.0}
        topWord="You're"
        heroPhrase="BURNING THROUGH"
        midWord="your"
        pixelPhrase="CLOUD CODE"
        subtitle="context is bloated."
      />

      {/* Beat 2 — anchor: "Cloud MD" (7.6–8.3s in transcript) */}
      <KaraokeCard
        frame={frame} fps={fps}
        startSec={6.0} endSec={12.0}
        position="bottom-left"
        eyebrow="Tip 1 · Context"
        words={['Keep', 'CLAUDE.md', 'under', '40K', 'characters']}
        heroWord="CLAUDE.md"
      />

      {/* Beat 3 — anchor: "/compact" (16.6–17.2s) */}
      <CompactCard
        frame={frame} fps={fps}
        startSec={15.5} endSec={21.0}
        command="/compact"
        subtitle="without breaking content"
        sideArt="trashCompactor"
      />

      {/* Beat 4 — anchor: "/clear" (22.1–22.8s) → "fresh contexts, no drift" (24.9–26.8s) */}
      <Win95Terminal
        frame={frame} fps={fps}
        startSec={21.5} endSec={28.0}
        command="/clear"
        payoff="Fresh context. No drift."
      />

      {/* Beat 5 — CTA hero word "Opus" (34.7–36.0s) */}
      <OpusGlisten
        frame={frame} fps={fps}
        startSec={34.5} endSec={38.0}
        word="Opus"
      />

      {/* Tail decoration — anchor: "for the real WORK" (38.1–39.1s) */}
      <AsciiPlanet
        frame={frame} fps={fps}
        startSec={38.0} endSec={43.0}
      />

      {/* Audio cues — keyed to anchor entries.
          bubble = motion graphic appearing
          whoosh = transition / pattern interrupt (Win95 wipe, planet entry)
          chime  = THE signature beat — Opus sparkle peak (one per video) */}
      <SkyframeAudioCues
        bubbles={[0, 144, 372, 516]}     /* intro / Claude.MD / /compact / Win95 entries */
        whooshes={[547, 912]}            /* Win95 /clear wipe / planet entry */
        chime={892}                      /* Opus sparkle peak @ ~37.17s */
      />
    </AbsoluteFill>
  );
};

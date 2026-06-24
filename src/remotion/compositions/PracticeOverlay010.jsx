// ─── PracticeOverlay010 — Cybersec Truth Bomb (parametric) ───────────────
// Canonical reference for the cybersec POV variant of the Skyframe shortform
// template. Refactored 2026-05-12 to accept `beats` + `audioCues` props so the
// shortform-cli `recipe` subcommand can drive it for any video, not just
// cartesiantest001.mp4.
//
// Canonical example (defaultProps below) = the cartesiantest001 lock-pass.
// CLI invocation overrides via --props '{"beats":{...},"audioCues":{...}}'.
//
// 5-beat structure (windows + audio cues all configurable via props):
//   Beat 1 (HOOK)    RayBanIntro
//   Beat 2 (THREAT)  KaraokeCard
//   Beat 3 (BULLETS) KaraokeCard
//   Beat 4 (PIVOT)   Win95Terminal
//   Tail             AsciiPlanet
//   Beat 5 (CTA)     OpusGlisten
//
// Skill: skills/breadstick-cybersec-truth-bomb/SKILL.md
// Recipe: src/canvas/recipes.js → id: cybersec-truth-bomb

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
  Win95Terminal,
  OpusGlisten,
  AsciiPlanet,
  SkyframeAudioCues,
  ensureFonts,
} from '../skyframe/index.js';

// Canonical defaults — match the cartesiantest001 locked render exactly.
// Any composition rendered without overrides reproduces the canonical example.
export const CYBERSEC_TRUTH_BOMB_DEFAULTS = {
  beats: {
    hook: {
      startSec: 0, endSec: 2.0,
      topWord: "You're",
      heroPhrase: 'SHIPPING BLIND',
      midWord: 'with',
      pixelPhrase: 'AI CODE',
      subtitle: "you don't fully understand.",
    },
    threat: {
      startSec: 7.0, endSec: 14.0,
      position: 'bottom-left',
      eyebrow: 'The Threat',
      words: ['No', 'audits.', 'Attackers', 'love', 'that.'],
      heroWord: 'Attackers',
    },
    bullets: {
      startSec: 15.5, endSec: 23.0,
      position: 'bottom-right',
      eyebrow: 'What AI Ships Blind',
      words: ['Broken', 'auth.', 'Hardcoded', 'secrets.', 'Insecure', 'deps.'],
      heroWord: 'secrets.',
    },
    pivot: {
      startSec: 23.5, endSec: 27.5,
      command: '/audit',
      payoff: 'Every line is an attack surface.',
      position: 'top',
    },
    tail: {
      startSec: 30.0, endSec: 35.0,
      position: 'bottom',
    },
    cta: {
      startSec: 34.0, endSec: 37.0,
      word: 'SPACE',
      fontSize: 194,
      caretHeight: 146,
    },
  },
  audioCues: {
    bubbles: [0, 210, 465, 705],
    whooshes: [],
    chime: 1084,
  },
};

export const PracticeOverlay010 = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('Loading Skyframe fonts'));
  useEffect(() => {
    ensureFonts().then(() => continueRender(fontHandle));
  }, [fontHandle]);

  // Per-beat deep merge: each beat falls back to its canonical defaults field
  // by field, so CLI/Claude can return just the words it computed and inherit
  // position, fontSize, position-anchors, etc. from defaults. Shallow spread
  // at the top level would lose default fields the beat-mapper omits.
  const D = CYBERSEC_TRUTH_BOMB_DEFAULTS.beats;
  const pb = props?.beats || {};
  const b = {
    hook:    { ...D.hook,    ...(pb.hook    || {}) },
    threat:  { ...D.threat,  ...(pb.threat  || {}) },
    bullets: { ...D.bullets, ...(pb.bullets || {}) },
    pivot:   { ...D.pivot,   ...(pb.pivot   || {}) },
    tail:    { ...D.tail,    ...(pb.tail    || {}) },
    cta:     { ...D.cta,     ...(pb.cta     || {}) },
  };
  const audioCues = { ...CYBERSEC_TRUTH_BOMB_DEFAULTS.audioCues, ...(props?.audioCues || {}) };

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      {/* Beat 1 — HOOK */}
      <RayBanIntro frame={frame} fps={fps} {...b.hook} />

      {/* Beat 2 — THREAT */}
      <KaraokeCard frame={frame} fps={fps} {...b.threat} />

      {/* Beat 3 — BULLETS */}
      <KaraokeCard frame={frame} fps={fps} {...b.bullets} />

      {/* Beat 4 — PIVOT */}
      <Win95Terminal frame={frame} fps={fps} {...b.pivot} />

      {/* Tail decoration */}
      <AsciiPlanet frame={frame} fps={fps} {...b.tail} />

      {/* Beat 5 — CTA */}
      <OpusGlisten frame={frame} fps={fps} {...b.cta} />

      {/* Audio cues */}
      <SkyframeAudioCues
        bubbles={audioCues.bubbles || []}
        whooshes={audioCues.whooshes || []}
        chime={audioCues.chime}
      />
    </AbsoluteFill>
  );
};

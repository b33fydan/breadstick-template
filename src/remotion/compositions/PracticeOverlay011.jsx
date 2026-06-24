// ─── PracticeOverlay011 ──────────────────────────────────────────────────
// MG Palette Demo — sizzle reel previewing the 3 new motion graphics
// (CircleHighlight, StatCallout, LowerThirdChyron) plus the rapid-tick ASCII
// audio experiment.
//
// Scenes (4s each, 16s total = 480 frames @ 30fps):
//   Scene 1  0–4s   CircleHighlight       sound: chime2
//   Scene 2  4–8s   StatCallout           sounds: digital-click (per digit) + chime2 (landing)
//   Scene 3  8–12s  LowerThirdChyron      sound: mouse-click on entry
//   Scene 4  12–16s Rapid-Tick ASCII      sound: digital-click-rapid-2ms (drone) + chime2 at end
//
// Each scene gets a small persistent slate (top-left) showing the effect name
// + index so the operator knows what they are watching.

import React, { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  continueRender,
  delayRender,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  CircleHighlight,
  StatCallout,
  LowerThirdChyron,
  AsciiPlanet,
  ensureFonts,
  SKYFRAME_PALETTE,
} from '../skyframe/index.js';

const SceneSlate = ({ index, label }) => (
  <div style={{
    position: 'absolute',
    top: 80,
    left: 60,
    fontFamily: 'Inter, Arial, sans-serif',
    fontWeight: 800,
    fontSize: 24,
    letterSpacing: '0.22em',
    color: SKYFRAME_PALETTE.accent,
    textTransform: 'uppercase',
    textShadow: `0 0 14px ${SKYFRAME_PALETTE.accentGlow}`,
  }}>
    <span style={{ color: SKYFRAME_PALETTE.hero, marginRight: 12 }}>
      {String(index).padStart(2, '0')}
    </span>
    {label}
  </div>
);

export const PracticeOverlay011 = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('Loading Skyframe fonts'));
  useEffect(() => {
    ensureFonts().then(() => continueRender(fontHandle));
  }, [fontHandle]);

  // Scene boundaries
  const SCENE = {
    one: { start: 0, end: 4 },
    two: { start: 4, end: 8 },
    three: { start: 8, end: 12 },
    four: { start: 12, end: 16 },
  };

  // Slate visibility — show the slate matching the current scene
  const sec = frame / fps;
  let activeSlate = null;
  if (sec < SCENE.one.end) activeSlate = { idx: 1, label: 'CIRCLE HIGHLIGHT' };
  else if (sec < SCENE.two.end) activeSlate = { idx: 2, label: 'STAT CALLOUT' };
  else if (sec < SCENE.three.end) activeSlate = { idx: 3, label: 'LOWER-THIRD CHYRON' };
  else if (sec < SCENE.four.end) activeSlate = { idx: 4, label: 'RAPID-TICK ASCII' };

  return (
    <AbsoluteFill>
      {/* Built-in dark gradient background so this is a standalone preview */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at 50% 40%, #1a1a28 0%, #08080d 70%, #000000 100%)',
      }} />

      {/* Persistent slate label per scene */}
      {activeSlate && <SceneSlate index={activeSlate.idx} label={activeSlate.label} />}

      {/* ── Scene 1 — CircleHighlight ─────────────────────────────────── */}
      {/* Burn-in caption that the circle will wrap around */}
      {sec >= SCENE.one.start && sec < SCENE.one.end + 0.3 && (
        <div style={{
          position: 'absolute',
          left: '50%', top: '47%',
          transform: 'translate(-50%, -50%)',
          fontFamily: 'Inter, Arial, sans-serif',
          fontWeight: 900,
          fontSize: 100,
          color: '#FFFFFF',
          letterSpacing: '-0.02em',
          textShadow: '0 4px 14px rgba(0,0,0,0.6)',
        }}>
          ATTACK SURFACE
        </div>
      )}
      <CircleHighlight
        frame={frame} fps={fps}
        startSec={SCENE.one.start + 0.4} endSec={SCENE.one.end}
        x={18} y={42} w={64} h={10}
      />

      {/* ── Scene 2 — StatCallout ─────────────────────────────────────── */}
      <StatCallout
        frame={frame} fps={fps}
        startSec={SCENE.two.start + 0.3} endSec={SCENE.two.end}
        value={103000}
        suffix=""
        label="VIEWS · 4 / 18 · POV REEL"
        fontSize={240}
      />

      {/* ── Scene 3 — LowerThirdChyron ────────────────────────────────── */}
      <LowerThirdChyron
        frame={frame} fps={fps}
        startSec={SCENE.three.start + 0.3} endSec={SCENE.three.end}
        eyebrow="ENGINE"
        name="BREADSTICK"
        subtitle="endgame substrate · 2026-05-09"
      />

      {/* ── Scene 4 — Rapid-Tick ASCII ────────────────────────────────── */}
      {/* AsciiPlanet rotates the whole window; the rapid-tick audio runs ON TOP */}
      <AsciiPlanet
        frame={frame} fps={fps}
        startSec={SCENE.four.start} endSec={SCENE.four.end}
      />

      {/* ── Audio cues ────────────────────────────────────────────────── */}
      {/* Scene 1: chime2 hits as the circle completes (~26 frames into the effect) */}
      <Sequence from={Math.round((SCENE.one.start + 0.4 + 26 / 30) * fps)} durationInFrames={48}>
        <Audio src={staticFile('sounds/chime2.mp3')} />
      </Sequence>

      {/* Scene 2: digital-click bursts during the count (4 ticks across 0.8s),
          then chime2 on landing overshoot. */}
      {[0.35, 0.5, 0.65, 0.8].map((offset, i) => (
        <Sequence key={`tick-${i}`}
          from={Math.round((SCENE.two.start + offset) * fps)}
          durationInFrames={8}>
          <Audio src={staticFile('sounds/digital-click.mp3')} volume={0.45} />
        </Sequence>
      ))}
      <Sequence from={Math.round((SCENE.two.start + 1.2) * fps)} durationInFrames={48}>
        <Audio src={staticFile('sounds/chime2.mp3')} />
      </Sequence>

      {/* Scene 3: mouse-click as the chyron slides in */}
      <Sequence from={Math.round((SCENE.three.start + 0.35) * fps)} durationInFrames={24}>
        <Audio src={staticFile('sounds/mouse-click.mp3')} />
      </Sequence>

      {/* Scene 4: rapid-tick audio runs for the full 2s window + chime2 punctuation at end */}
      <Sequence from={Math.round((SCENE.four.start + 0.5) * fps)} durationInFrames={60}>
        <Audio src={staticFile('sounds/digital-click-rapid-2ms.mp3')} volume={0.6} />
      </Sequence>
      <Sequence from={Math.round((SCENE.four.start + 3.0) * fps)} durationInFrames={48}>
        <Audio src={staticFile('sounds/chime2.mp3')} />
      </Sequence>
    </AbsoluteFill>
  );
};

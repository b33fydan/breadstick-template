// ─── SkyframeAudioCues ───────────────────────────────────────────────────
// Declarative audio sidecar — declare bubble/whoosh/chime/chime2 cues by
// absolute frame and the helper renders them as Remotion <Sequence>+<Audio>.
//
// Discipline (do not break):
//   - bubble  = motion graphic appearing (each effect entry)
//   - whoosh  = transition / pattern interrupt (Win95 wipe, planet entry)
//   - chime   = ONE per video, reserved for Opus sparkle peak (signature)
//   - chime2  = secondary chime, fires per AsciiPlanet beat entry
//
// Sounds live in `public/sounds/` — bubble.mp3, whoosh.mp3, chime.mp3, chime2.mp3.

import React from 'react';
import { Audio, Sequence, staticFile } from 'remotion';

export const SkyframeAudioCues = ({
  bubbles = [],
  whooshes = [],
  chime = null,
  chime2 = [],
  bubbleDur = 24,
  whooshDur = 24,
  chimeDur = 48,
  chime2Dur = 48,
}) => (
  <>
    {bubbles.map((f, i) => (
      <Sequence key={`b${i}`} from={f} durationInFrames={bubbleDur}>
        <Audio src={staticFile('sounds/bubble.mp3')} />
      </Sequence>
    ))}
    {whooshes.map((f, i) => (
      <Sequence key={`w${i}`} from={f} durationInFrames={whooshDur}>
        <Audio src={staticFile('sounds/whoosh.mp3')} />
      </Sequence>
    ))}
    {chime !== null && (
      <Sequence from={chime} durationInFrames={chimeDur}>
        <Audio src={staticFile('sounds/chime.mp3')} />
      </Sequence>
    )}
    {chime2.map((f, i) => (
      <Sequence key={`c2-${i}`} from={f} durationInFrames={chime2Dur}>
        <Audio src={staticFile('sounds/chime2.mp3')} />
      </Sequence>
    ))}
  </>
);

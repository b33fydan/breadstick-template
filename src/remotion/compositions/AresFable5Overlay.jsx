// ─── AresFable5Overlay ───────────────────────────────────────────────────
// 5-beat Skyframe overlay ADAPTED to the recorded take (renders/fable5-src.mp4,
// green screen, 1440×2560, 30fps). The take dropped the script's solution/
// doctrine third, so the original 3-term list + AdjudicationMatrix snap are
// out; beats are re-anchored to what the speaker actually says.
//
// Timeline = the CUT take (duplicate benchmark pass removed): keep [0,48.66] +
// [60.68,67.4] → ~55.4s. Beats in the back segment are shifted -12.02s.
//
// Pipeline (green-key → dark bg → overlay), see chat / the composite command:
//   render:  npx remotion render src/remotion/index.jsx AresFable5Overlay \
//              renders/ares-fable5-overlay.webm --codec=vp9 --pixel-format=yuva420p --image-format=png
//   key+mix: chromakey the green, overlay on #0a0a0f, soft-blur subject 0–4.5s,
//            overlay this WebM, amix voice + cue track.
//
// Beat map (CUT-timeline seconds):
//   B1 HOOK      0.3–4.6    RayBanIntro       "Anthropic blocked FABLE 5 / NO ACCESS"
//   B2 IRONY     11–17      LowerThirdChyron  ARES · deep cybersecurity research (gold)
//   B3 THREAT    35–40.5    LowerThirdChyron  PROMPT INJECTION (coral)
//   B4 RECEIPT   42.9–48.5  Win95Terminal     "semantic attacks blocked: 0%" (bottom)
//   B5 CTA       53.5–55.5  OpusGlisten        shimmer on "Substack" + the one chime

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
  LowerThirdChyron,
  Win95Terminal,
  OpusGlisten,
  SkyframeAudioCues,
  ensureFonts,
} from '../skyframe/index.js';

export const AresFable5Overlay = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('Loading Skyframe fonts'));
  useEffect(() => {
    ensureFonts().then(() => continueRender(fontHandle));
  }, [fontHandle]);

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      {/* B1 — HOOK: Anthropic blocks Fable 5 (subject soft-blurred 0–4.5s) */}
      <RayBanIntro
        frame={frame} fps={fps}
        startSec={0.3} endSec={4.6}
        topWord="Anthropic just blocked"
        heroPhrase="FABLE 5"
        midWord=""
        pixelPhrase="NO ACCESS"
        subtitle="their latest model. gone."
      />

      {/* B2 — IRONY: couldn't use it for deep cybersecurity work (ARES) */}
      <LowerThirdChyron
        frame={frame} fps={fps}
        startSec={11.0} endSec={17.0}
        eyebrow="MY PROJECT"
        name="ARES"
        subtitle="too deep in cybersecurity for Fable 5"
      />

      {/* B3 — THREAT: the attack ARES defends against (coral accent) */}
      <LowerThirdChyron
        frame={frame} fps={fps}
        startSec={35.0} endSec={40.5}
        eyebrow="THE THREAT"
        name="PROMPT INJECTION"
        subtitle="hostile instructions hidden in data"
        accentColor="#FF6B4A"
        accentGlow="rgba(255,107,74,0.5)"
        eyebrowColor="#FF8A66"
      />

      {/* B4 — RECEIPT: firewalls catch 0% of semantic attacks (lands on his "0%") */}
      <Win95Terminal
        frame={frame} fps={fps}
        startSec={42.9} endSec={48.5}
        position="bottom"
        title="C:\ARES\firewall.log"
        text="semantic attacks blocked: 0%"
      />

      {/* B5 — CTA: signature shimmer on his final word, pushed to chest to clear face */}
      <OpusGlisten
        frame={frame} fps={fps}
        startSec={53.5} endSec={55.5}
        word="Substack"
        speed={2.0}
        yOffset={400}
      />

      {/* Audio — bubble on intro+terminal, whoosh on each chyron slide, the ONE chime on Substack.
          Frames @30fps (cut timeline): intro 9 · ARES slide 330 · threat slide 1050 ·
          terminal 1287 · Substack sparkle peak ~1636 */}
      <SkyframeAudioCues
        bubbles={[9, 1287]}
        whooshes={[330, 1050]}
        chime={1636}
      />
    </AbsoluteFill>
  );
};

// ─── OpusGlisten ─────────────────────────────────────────────────────────
// THE Skyframe signature beat: serif hero word + lower-left → upper-right
// gold gradient sweep + 4-point sparkle pop in the upper-right corner +
// halo ring radial expansion. Pair with `chime.mp3` audio cue at the
// sparkle peak (frame ~64 of the window, ~37.17s in PracticeOverlay009).
//
// **Discipline rules** (don't break these without a strong reason):
//   - Use ONCE per video, on the Beat 5 CTA emphasis word
//   - Pair with EXACTLY ONE chime — the audio is the load-bearing partner
//   - The single hero word should be the imperative payoff or brand name
//   - Window minimum 3.0s — the shine + sparkle + linger arc needs the room
//   - Don't shine multiple words — kills the signature
//
// Shine animation:
//   frames 8–58:  sweep BL→TR, white center 0%→100%
//   frames 58+:   reset to stable gold (no trailing wash)
// Sparkle:
//   frames 55–82: opacity 0→1→0, scale 0.3→1.6→1.0 (overshoot via EASE_BACK)
// Halo ring:
//   frames 56–78: scale 0.2→2.6 outward, opacity 0→0.85→0
//
// To extend the linger past shine completion, push `endSec` later; the
// container fades over the last 14 frames of whatever window length you set.

import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { EASE_OUT, EASE_BACK, inWindow } from './_helpers.jsx';
import { Sparkle } from './Sparkle.jsx';

export const OpusGlisten = ({
  frame,
  fps,
  startSec,
  endSec,
  word = 'Opus',
  speed = 1.0,
  yOffset = 0,
  fontSize: fontSizeProp,
  caretHeight: caretHeightProp,
}) => {
  if (!inWindow(frame, startSec, endSec, fps)) return null;

  // Timing scale: speed > 1 → faster animation. Default 1.0 preserves the
  // chef's-kissed signature timing. Skyframe-5beat uses 1.7 to fit the
  // chime + sparkle within ~1.5s when the operator cuts before the standard
  // 3.5s arc completes.
  const s = Math.max(0.1, speed);
  const f = (n) => Math.round(n / s);

  // Lowercase descenders ('g','j','p','q','y') break Georgia's visual baseline
  // and make the hero word look like it's spilling past the safe zone —
  // "gitignore" with two g-tails is the canonical failure mode. Auto-uppercase
  // when descenders are present so the word reads on a clean cap-baseline.
  // "Opus" (no descenders) is preserved as the signature mixed-case look.
  const hasDescender = /[gjpqy]/.test(word);
  const displayWord = hasDescender ? word.toUpperCase() : word;

  // Auto-scale for longer words so the hero word never clips the frame.
  // Tighter steps for 8+ chars because uppercase glyphs are wider than
  // lowercase and serif descenders/ascenders eat vertical room.
  const lengthTier = displayWord.length <= 5 ? 1.0
                   : displayWord.length <= 7 ? 0.9
                   : displayWord.length <= 9 ? 0.8
                   : 0.7;
  const fontSize = fontSizeProp ?? Math.round(240 * lengthTier);
  const caretHeight = caretHeightProp ?? Math.round(180 * lengthTier);

  const startF = startSec * fps;
  const endF = endSec * fps;
  const local = frame - startF;
  const total = endF - startF;

  const typeStart = f(4);
  const charPace = Math.max(1, f(5));
  const visibleChars = Math.max(0, Math.min(displayWord.length, Math.floor((local - typeStart) / charPace)));
  const visibleText = displayWord.slice(0, visibleChars);

  const caretPhase = Math.floor(local / 6) % 2;
  const caretOn = visibleChars < displayWord.length || caretPhase === 0;

  const shineProgress = interpolate(local, [f(8), f(58)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });
  const shineActive = local < f(60);
  const shineCenter = shineActive ? (-10 + shineProgress * 110) : 50;

  const containerOpacity = interpolate(
    local, [0, f(8), total - 14, total], [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const wordScale = interpolate(local, [0, f(18)], [0.96, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  const sparkleOp = interpolate(local, [f(55), f(62), f(82)], [0, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });
  const sparkleScale = interpolate(local, [f(55), f(64), f(82)], [0.3, 1.6, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_BACK,
  });
  const sparkleRot = interpolate(local, [f(55), f(82)], [0, 32], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const ringScale = interpolate(local, [f(56), f(78)], [0.2, 2.6], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });
  const ringOp = interpolate(local, [f(56), f(60), f(78)], [0, 0.85, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{
      pointerEvents: 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        opacity: containerOpacity,
        transform: `translateY(${yOffset}px) scale(${wordScale})`,
        position: 'relative',
        display: 'flex', alignItems: 'baseline',
      }}>
        <div style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize, fontWeight: 700,
          letterSpacing: '-0.02em', lineHeight: 1.0,
          backgroundImage: `linear-gradient(45deg,
            #8c5e1f 0%,
            #c98f30 ${Math.max(0, shineCenter - 22)}%,
            #f6dc92 ${Math.max(0, shineCenter - 6)}%,
            #ffffff ${shineCenter}%,
            #f6dc92 ${Math.min(100, shineCenter + 6)}%,
            #c98f30 ${Math.min(100, shineCenter + 22)}%,
            #8c5e1f 100%)`,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          color: 'transparent',
          filter: 'drop-shadow(0 18px 56px rgba(0,0,0,0.85)) drop-shadow(0 24px 64px rgba(255, 200, 80, 0.45)) drop-shadow(0 6px 14px rgba(0, 0, 0, 0.75)) drop-shadow(0 2px 4px rgba(0,0,0,0.9))',
        }}>
          {visibleText || '​'}
        </div>
        <div style={{
          width: 6, height: caretHeight, marginLeft: 14, marginBottom: 14,
          background: 'rgba(255, 240, 200, 0.92)',
          opacity: caretOn ? 0.85 : 0,
          borderRadius: 3,
          boxShadow: '0 0 18px rgba(255, 220, 130, 0.55)',
        }} />

        {/* Halo ring */}
        <div style={{
          position: 'absolute',
          top: -90, right: -130,
          width: 220, height: 220,
          opacity: ringOp,
          transform: `scale(${ringScale})`,
          transformOrigin: 'center',
          borderRadius: '50%',
          border: '4px solid rgba(255, 240, 180, 0.85)',
          boxShadow: '0 0 40px rgba(255, 220, 130, 0.7), inset 0 0 20px rgba(255, 245, 200, 0.5)',
          pointerEvents: 'none',
        }} />

        {/* Sparkle 4-point burst */}
        <div style={{
          position: 'absolute',
          top: -60, right: -90,
          opacity: sparkleOp,
          transform: `scale(${sparkleScale}) rotate(${sparkleRot}deg)`,
          transformOrigin: 'center',
          filter: 'drop-shadow(0 0 32px rgba(255, 245, 200, 0.95)) drop-shadow(0 0 80px rgba(255, 220, 130, 0.75))',
        }}>
          <Sparkle size={200} color="#fff7d6" />
        </div>
      </div>
    </AbsoluteFill>
  );
};

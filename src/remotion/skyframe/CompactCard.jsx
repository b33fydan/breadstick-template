// ─── CompactCard ─────────────────────────────────────────────────────────
// Bottom-centered terminal-style command card with optional side-art SVG.
// Used when the beat's anchor is a slash-command, function call, or any
// "do this thing → get this result" message that benefits from a side
// visualization.
//
// `command` is rendered in monospace bold; `subtitle` is a sans-serif
// supporting line. `sideArt` is any React node (TrashCompactor by default,
// or pass null to render just the card).
//
// The sideArt receives `local` (frames since window start) and `total`
// (window length in frames) so it can synchronize its arc to this card's
// entry/exit envelope.

import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { EASE_OUT, inWindow } from './_helpers.jsx';
import { TrashCompactor } from './TrashCompactor.jsx';

export const CompactCard = ({
  frame,
  fps,
  startSec,
  endSec,
  command,
  subtitle = '',
  sideArt = null,  // null (default) | 'trashCompactor' | React element | render fn
  sideArtProps = {},
}) => {
  if (!inWindow(frame, startSec, endSec, fps)) return null;

  const startF = startSec * fps;
  const endF = endSec * fps;
  const local = frame - startF;
  const total = endF - startF;
  const enterDur = 12;
  const exitStart = total - 14;

  const cardOpacity = interpolate(
    local, [0, enterDur, exitStart, total], [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const cardY = interpolate(local, [0, enterDur], [60, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  // Resolve sideArt
  let sideArtEl = null;
  if (sideArt === 'trashCompactor') {
    sideArtEl = <TrashCompactor local={local} total={total} {...sideArtProps} />;
  } else if (typeof sideArt === 'function') {
    sideArtEl = sideArt({ local, total });
  } else if (sideArt) {
    sideArtEl = sideArt;
  }

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute',
        left: '50%',
        bottom: 220,
        transform: `translateX(-50%) translateY(${cardY}px)`,
        opacity: cardOpacity,
        padding: '24px 48px 28px',
        background: 'rgba(8, 14, 30, 0.78)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 22,
        border: '1.5px solid rgba(0, 138, 255, 0.55)',
        boxShadow: '0 22px 44px rgba(0,0,0,0.50), 0 6px 12px rgba(0,0,0,0.28)',
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: 'Consolas, "Courier New", monospace',
          fontSize: 68, fontWeight: 700, color: '#fff',
          letterSpacing: '0.02em', lineHeight: 1.0, marginBottom: subtitle ? 6 : 0,
        }}>
          {command}
        </div>
        {subtitle && (
          <div style={{
            fontFamily: 'Inter, Arial, sans-serif', fontWeight: 400,
            fontSize: 28, color: 'rgba(255,255,255,0.78)',
            letterSpacing: '0.02em',
          }}>
            {subtitle}
          </div>
        )}
      </div>

      {sideArtEl && (
        <div style={{
          position: 'absolute', right: 30, top: 520,
        }}>
          {sideArtEl}
        </div>
      )}
    </AbsoluteFill>
  );
};

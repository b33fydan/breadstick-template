// ─── AppleGlassTile ──────────────────────────────────────────────────────
// Apple-glass list panel: materializes top→bottom, contour shine traces the
// perimeter, a small particle burst bursts out of the bottom-end corner,
// then 3 single-word bullets stagger in (150ms apart), and the tile wipes
// down to exit. Each bullet click fires `digital-click.mp3` (vol 0.6).
//
// Use for the skyframe-code pack's Beat 3 — a teleprompter-style on-screen
// list the speaker can stand next to and POINT to. The list is the prop;
// the speaker is the deliverer. Single-word bullets (not phrases) keep the
// finger-point unambiguous.
//
// Two-layer drop shadow per motion-craft "card on dark video" scale.
// Glass styling pairs with KaraokeCard (same backdrop-filter family) so the
// skyframe-code pack visually rhymes with skyframe-5beat without copying it.

import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile } from 'remotion';
import { EASE_OUT, EASE_DRAWER, SKYFRAME_PALETTE, inWindow } from './_helpers.jsx';

const POSITIONS = {
  // 1080×1920 portrait. Tile lives left-of-center so the speaker stands
  // RIGHT of the list and points LEFT to each bullet on cue.
  'left':   { left: 60,  textAlign: 'left'   },
  'right':  { left: 500, textAlign: 'left'   },
  'center': { left: 280, textAlign: 'center' },
};

export const AppleGlassTile = ({
  frame,
  fps,
  startSec,
  endSec,
  words = ['ONE', 'TWO', 'THREE'],
  position = 'left',
  tileWidth = 520,
  tileHeight = 580,
  tileTop = 540,
  mute = false,
  clickVolume = 0.6,
  accentColor = SKYFRAME_PALETTE.accent,
}) => {
  if (!inWindow(frame, startSec, endSec, fps)) return null;

  const startF = Math.round(startSec * fps);
  const endF = Math.round(endSec * fps);
  const local = frame - startF;
  const total = endF - startF;

  // ── Phase frames (30 fps reference; scales with fps) ───────────────────
  const materializeDur = Math.round(0.50 * fps);   // ~15f
  const shineStart     = Math.round(0.40 * fps);   // ~12f — overlaps tail of materialize
  const shineDur       = Math.round(0.35 * fps);   // ~10f
  const sparkleStart   = Math.round(0.55 * fps);   // ~16f — after materialize
  const sparkleDur     = Math.round(0.45 * fps);   // ~13f
  const bullet1Start   = Math.round(1.00 * fps);   // 1.0s into the window
  const bulletStagger  = Math.round(1.00 * fps);   // 1.0s between words — deliberate pacing
  const wordShineDelay = Math.round(0.12 * fps);   // ~4f after word lands
  const wordShineDur   = Math.round(0.32 * fps);   // ~10f sweep (slightly slower → stronger read)
  const exitDur        = Math.round(0.70 * fps);   // ~21f
  const exitStart      = total - exitDur;

  // ── Materialize (top→bottom wipe via clip-path inset) ──────────────────
  const materializeProg = interpolate(
    local, [0, materializeDur], [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT }
  );

  // ── Wipe-down exit (top inset grows so the tile collapses downward) ────
  const exitProg = interpolate(
    local, [exitStart, exitStart + exitDur], [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT }
  );

  // Combined clip-path: materialize fills bottom→0, exit pushes top→100
  // inset(<top>% 0 <bottom>% 0). Materialize uses bottom inset; exit uses top.
  const insetTop    = exitProg * 100;
  const insetBottom = (1 - materializeProg) * 100;
  const clipPathStr = `inset(${insetTop}% 0 ${insetBottom}% 0)`;

  // Tile-level entry shadow ramp — shadow fades in WITH the materialize so
  // the tile doesn't pop a full shadow before it's fully revealed.
  const tileOpacity = interpolate(
    local, [0, 4, total - 6, total], [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // ── Contour shine — animated stroke-dashoffset around the perimeter ────
  const perimeter = 2 * (tileWidth + tileHeight);
  const shineSegment = 80;
  const shineProg = interpolate(
    local, [shineStart, shineStart + shineDur], [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT }
  );
  // Start segment offset so the bright bit enters from the top-left and
  // travels clockwise once around.
  const dashOffset = -(shineProg * perimeter);
  const shineOpacity = interpolate(
    local,
    [shineStart, shineStart + 2, shineStart + shineDur - 3, shineStart + shineDur],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // ── Bottom-end corner sparkle burst ─────────────────────────────────────
  // 5 particles fan outward from bottom-right corner. Each particle has its
  // own angle + distance + slight stagger so the burst reads as organic.
  // Sparkle particles. Larger + slightly longer travel reads better on
  // real video than 6-8px dots that get crushed by codec quantization.
  const PARTICLES = [
    { angle: -10, dist: 95,  delay: 0,  size: 12 },
    { angle:  20, dist: 125, delay: 1,  size: 16 },
    { angle:  45, dist: 145, delay: 0,  size: 11 },
    { angle:  70, dist: 125, delay: 2,  size: 14 },
    { angle: 100, dist: 100, delay: 1,  size: 12 },
  ];

  const pos = POSITIONS[position] || POSITIONS['left'];

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {/* Tile + glass surface ------------------------------------------- */}
      <div style={{
        position: 'absolute',
        left: pos.left,
        top: tileTop,
        width: tileWidth,
        height: tileHeight,
        opacity: tileOpacity,
        clipPath: clipPathStr,
        WebkitClipPath: clipPathStr,
        // Two-layer drop shadow (motion-craft: card on dark video)
        // Outer long+soft cushion, inner tight contact. Tinted slightly cool
        // so the shadow doesn't muddy the talking-head skin tones below.
        filter:
          'drop-shadow(0 28px 56px rgba(0,0,0,0.36)) ' +
          'drop-shadow(0 6px 12px rgba(0,0,0,0.24))',
      }}>
        {/* Glass card.
            Note: backdrop-filter can't act on the underlying video when this
            comp is rendered as a transparent overlay (the alpha buffer behind
            it is empty during the render pass). We compensate with a stronger
            translucent white tint + a brighter inner top-light gradient so the
            tile reads as glass-plate even without true backdrop-blur. If
            this comp is ever drawn over a real backdrop in the same render
            pass, backdrop-filter still fires as a free upgrade. */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(255,255,255,0.20)',
          backdropFilter: 'blur(30px) saturate(1.30)',
          WebkitBackdropFilter: 'blur(30px) saturate(1.30)',
          borderRadius: 28,
          border: '1.5px solid rgba(255,255,255,0.55)',
          // Stronger inner top-light gradient — sells the curved-glass read
          // even on a flat-alpha backdrop.
          backgroundImage:
            'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.04) 35%, rgba(255,255,255,0.02) 70%, rgba(255,255,255,0.10) 100%)',
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -1px 0 rgba(255,255,255,0.20)',
          overflow: 'hidden',
        }}>
          {/* Contour shine — SVG rect perimeter trace. Two stacked strokes:
              a wide soft outer glow + a tight bright core. Reads as a metal
              specular highlight sliding around the rim. */}
          <svg
            width={tileWidth}
            height={tileHeight}
            viewBox={`0 0 ${tileWidth} ${tileHeight}`}
            style={{
              position: 'absolute',
              inset: 0,
              opacity: shineOpacity,
              pointerEvents: 'none',
            }}
          >
            <defs>
              <filter id="aglass-shine-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="5" />
              </filter>
            </defs>
            {/* Outer soft glow */}
            <rect
              x={1.5} y={1.5}
              width={tileWidth - 3}
              height={tileHeight - 3}
              rx={26.5}
              ry={26.5}
              fill="none"
              stroke="#ffffff"
              strokeOpacity={0.75}
              strokeWidth={8}
              strokeDasharray={`${shineSegment} ${perimeter - shineSegment}`}
              strokeDashoffset={dashOffset}
              filter="url(#aglass-shine-glow)"
              pathLength={perimeter}
            />
            {/* Tight bright core */}
            <rect
              x={1.5} y={1.5}
              width={tileWidth - 3}
              height={tileHeight - 3}
              rx={26.5}
              ry={26.5}
              fill="none"
              stroke="#ffffff"
              strokeWidth={3}
              strokeDasharray={`${shineSegment} ${perimeter - shineSegment}`}
              strokeDashoffset={dashOffset}
              pathLength={perimeter}
            />
          </svg>

          {/* Bullets ------------------------------------------------------ */}
          <div style={{
            position: 'absolute',
            inset: 0,
            padding: '60px 40px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-evenly',
            alignItems: pos.textAlign === 'center' ? 'center' : 'flex-start',
            textAlign: pos.textAlign,
          }}>
            {words.slice(0, 3).map((word, i) => {
              const bulletStartF = bullet1Start + i * bulletStagger;
              const cl = local - bulletStartF;
              const op = interpolate(cl, [0, 7], [0, 1], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
              });
              const ty = interpolate(cl, [0, 7], [8, 0], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_DRAWER,
              });
              const blur = interpolate(cl, [0, 7], [2, 0], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
              });
              // Per-word baseline shine — small bright glint sweeps the word's
              // lower contour after the word lands.
              const ws = cl - wordShineDelay;
              const wordShineProg = interpolate(ws, [0, wordShineDur], [0, 1], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
              });
              const wordShineOp = interpolate(
                ws, [0, 2, wordShineDur - 2, wordShineDur], [0, 1, 1, 0],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
              );
              // 3D extrusion: white front face, cyan extrusion stack going
              // down-right with progressively darker shades to fake depth.
              // Trailing soft drop for grounding. Paired with a slight forward
              // tilt (perspective + rotateX) so the letters read as lifted off
              // the surface and tipped upward toward the viewer.
              const cyanExtrusion = [
                '1px 1px 0 #1FF6E2',
                '2px 2px 0 #00E0CB',
                '3px 3px 0 #00C5B2',
                '4px 4px 0 #00A99A',
                '5px 5px 0 #008D81',
                '6px 6px 0 #007169',
                '7px 7px 0 #005852',
                '0 12px 22px rgba(0, 60, 54, 0.30)',
              ].join(', ');
              return (
                <div key={i} style={{
                  fontFamily: 'Inter, Arial, sans-serif',
                  fontWeight: 800,
                  fontSize: 76,
                  letterSpacing: '-0.01em',
                  lineHeight: 1.0,
                  color: '#ffffff',
                  opacity: op,
                  transform:
                    `translateY(${ty}px) perspective(900px) rotateX(8deg)`,
                  transformOrigin: 'left center',
                  filter: `blur(${blur}px)`,
                  textShadow: cyanExtrusion,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                }}>
                  {/* Accent square — the per-bullet pointable indicator. */}
                  <span style={{
                    width: 18,
                    height: 18,
                    background: accentColor,
                    borderRadius: 4,
                    boxShadow:
                      `0 0 18px ${SKYFRAME_PALETTE.accentGlow}, ` +
                      `inset 0 1px 0 rgba(255,255,255,0.55)`,
                    flexShrink: 0,
                  }} />
                  {/* Word + lower-contour glint */}
                  <span style={{
                    position: 'relative',
                    display: 'inline-block',
                  }}>
                    {word}
                    <span style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: -10,
                      height: 6,
                      opacity: wordShineOp,
                      overflow: 'visible',
                      pointerEvents: 'none',
                    }}>
                      <span style={{
                        position: 'absolute',
                        top: 0,
                        height: '100%',
                        width: 140,
                        left: `calc(${wordShineProg * 100}% - 70px)`,
                        // Neon yellow bar — saturated centre, glow halos
                        // outward through warm yellow then transparent.
                        background:
                          'linear-gradient(90deg, ' +
                          'rgba(255, 245, 0, 0) 0%, ' +
                          'rgba(255, 245, 0, 0.85) 20%, ' +
                          'rgba(255, 255, 130, 1) 50%, ' +
                          'rgba(255, 245, 0, 0.85) 80%, ' +
                          'rgba(255, 245, 0, 0) 100%)',
                        filter:
                          'blur(0.5px) ' +
                          'drop-shadow(0 0 10px rgba(255, 245, 0, 0.95)) ' +
                          'drop-shadow(0 0 22px rgba(255, 220, 0, 0.7)) ' +
                          'drop-shadow(0 0 36px rgba(255, 200, 0, 0.45))',
                        borderRadius: 3,
                      }} />
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* Bottom-end-corner sparkle particles --------------------------- */}
      {/* Live OUTSIDE the clipped tile wrapper so the burst fans into
          negative space without being clipped to tile bounds. Positions
          are absolute in frame coordinates (anchored to tile's bottom-end
          corner). */}
      {PARTICLES.map((p, i) => {
        const localPS = local - (sparkleStart + p.delay);
        const op = interpolate(localPS, [0, 4, sparkleDur], [0, 1, 0], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        const travel = interpolate(localPS, [0, sparkleDur], [0, p.dist], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
        });
        const rad = (p.angle * Math.PI) / 180;
        const anchorX = pos.left + tileWidth - 8;
        const anchorY = tileTop  + tileHeight - 8;
        const x = anchorX + Math.cos(rad) * travel;
        const y = anchorY + Math.sin(rad) * travel;
        return (
          <div key={`p${i}`} style={{
            position: 'absolute',
            left: x,
            top: y,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: '#ffffff',
            opacity: op,
            filter:
              'drop-shadow(0 0 10px rgba(255,255,255,0.95)) ' +
              'drop-shadow(0 0 20px rgba(255,240,200,0.55))',
            transform: 'translate(-50%, -50%)',
          }} />
        );
      })}

      {/* Per-bullet click audio cues ----------------------------------- */}
      {!mute && words.slice(0, 3).map((_, i) => {
        const cueFrame = startF + bullet1Start + i * bulletStagger;
        // Math.round to align cue with the bullet visual entry frame
        const cueDur = Math.round(0.26 * fps); // ~8f
        return (
          <Sequence
            key={`click-${i}`}
            from={Math.max(0, cueFrame)}
            durationInFrames={cueDur}
          >
            <Audio
              src={staticFile('sounds/digital-click.mp3')}
              volume={clickVolume}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

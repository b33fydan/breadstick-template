import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, Loop, useCurrentFrame, useVideoConfig, staticFile, interpolate, Easing } from 'remotion';

// Soft ease-out used for opacity ramps and entry/exit motion. Matches the
// Apple-grade aesthetic notes in motion-craft — linear ramps over a half-
// second feel mechanical; a 1.6 power curve lands gently without overshoot.
const EASE_OUT = Easing.out(Easing.poly(1.6));

// Per-element-relative slide distance and scale offset for entry/exit motion.
// Distance is `%` of the zone element itself (CSS translate semantic), so a
// small chyron and a big card both feel proportionally lively.
const SLIDE_PCT = 25;     // 25% of the zone size — noticeable but not jarring
const SCALE_OFF = 0.12;   // 1.0 → 0.88 ; subtle pop without flicker

/**
 * Cartesian Composer — timed overlays at exact pixel coordinates over a base video.
 *
 * The composition's width/height match the base video. Zone coordinates and
 * sizes are PERCENTAGES of the frame (0-100), so the same zone list works
 * whether the base is portrait or landscape.
 *
 * Render order: zone array order. Last zone in the list draws on top.
 *
 * Props:
 *   baseVideoPath  string — path under public/ (staged by the server) OR an
 *                  absolute http(s) URL. Falls back to a black background when null.
 *   zones          array of zone defs (see schema below).
 *
 * Zone schema:
 *   {
 *     id:        string                 — stable key
 *     type:      'image' | 'video' | 'text' | 'hyperframes'
 *     x, y:      number (0-100)         — top-left corner as % of frame
 *     w, h:      number (0-100)         — size as % of frame
 *     startSec:  number                  — seconds from base start (inclusive)
 *     endSec:    number                  — seconds from base start (exclusive)
 *
 *     // optional motion (defaults all 0 / 'fade' = hard-cut, opacity-only):
 *     fadeIn:    number seconds          — opacity 0→1 ramp at zone start (eased)
 *     fadeOut:   number seconds          — opacity 1→0 ramp at zone end (eased)
 *     entry:     { kind: 'fade'|'slide-up'|'slide-down'|'slide-left'|'slide-right'|'scale' }
 *     exit:      { kind: 'fade'|'slide-up'|'slide-down'|'slide-left'|'slide-right'|'scale' }
 *
 *     // image / video / hyperframes:
 *     contentUrl:        string          — http(s) URL or staticFile-relative path
 *     contentFit:        'contain'(default) | 'cover'   — contain = fit whole asset (no crop), cover = fill the zone
 *     loop:              boolean          — video/hyperframes only; default true
 *     innerDurationSec:  number seconds   — video/hyperframes only; populated by the
 *                                            server's ffprobe pass. When known, the
 *                                            zone wraps OffthreadVideo in <Loop> for
 *                                            deterministic looping.
 *
 *     // text:
 *     contentText:     string
 *     contentColor:    css color  (default '#ffffff')
 *     contentBg:       css color  (default 'transparent')
 *     contentFontSize: number px  (default 32)
 *     contentAlign:    'left' | 'center' | 'right' (default 'center')
 *   }
 */

const resolveSrc = (path) => {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return staticFile(path);
};

export const CartesianComposer = ({ baseVideoPath, zones, isImage, baseLoop }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const baseSrc = resolveSrc(baseVideoPath);
  const zoneList = Array.isArray(zones) ? zones : [];

  // Detect image-as-base from the path extension as a safety net (the server
  // sets isImage explicitly, but this catches Studio previews where the prop
  // is missing).
  const baseIsImage = isImage || (
    typeof baseVideoPath === 'string' &&
    /\.(jpg|jpeg|png|webp|gif|bmp|tiff?|avif)(\?|#|$)/i.test(baseVideoPath)
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {baseSrc && (baseIsImage ? (
        // Image base — render via <Img> so a still photo can serve as the
        // backdrop for an animated zone composite. <OffthreadVideo> on a
        // JPG/PNG misreports dimensions and produces the 1:1 crop bug.
        <Img
          src={baseSrc}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <OffthreadVideo
          src={baseSrc}
          // Pass-through audio from the base track. Per-zone video clips are
          // muted below so the base voice/music remains the audio bed.
          muted={false}
          // When the comp duration exceeds the base file's real duration,
          // OffthreadVideo's default behavior is to freeze on the last frame.
          // baseLoop=true repeats the base instead — useful when the user
          // intends a short loop to fill a longer composite.
          loop={!!baseLoop}
        />
      ))}

      {zoneList.map((zone) => {
        const start = Number(zone.startSec) || 0;
        const end = Number(zone.endSec);
        if (!Number.isFinite(end) || end <= start) return null;
        if (t < start || t >= end) return null;

        // Fade ramps at the zone's boundaries. fadeIn / fadeOut also drive
        // any entry/exit motion (slide / scale) — the same time window
        // governs both opacity and transform so a chyron's slide-up always
        // arrives at the same moment its opacity finishes ramping in.
        // When both are 0 (default) the zone hard-cuts and no motion runs.
        const fadeIn = Math.max(0, Number(zone.fadeIn) || 0);
        const fadeOut = Math.max(0, Number(zone.fadeOut) || 0);

        // Entry / exit progress: 0 = fully off, 1 = fully on. Eased so the
        // ramp lands gently. We track entry and exit independently because
        // the user can pick different motion kinds for each end.
        let entryProg = 1;
        let exitProg = 1;
        if (fadeIn > 0) {
          const localT = t - start;
          if (localT < fadeIn) {
            entryProg = interpolate(localT, [0, fadeIn], [0, 1], {
              easing: EASE_OUT, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            });
          }
        }
        if (fadeOut > 0) {
          const remaining = end - t;
          if (remaining < fadeOut) {
            exitProg = interpolate(remaining, [0, fadeOut], [0, 1], {
              easing: EASE_OUT, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            });
          }
        }
        const opacity = Math.min(entryProg, exitProg);

        // Resolve entry / exit motion kinds. Default 'fade' = no transform,
        // matching the v1 (opacity-only) behavior. Other kinds layer a slide
        // or scale on top of the opacity ramp, using the same duration.
        const entryKind = (zone.entry && zone.entry.kind) || 'fade';
        const exitKind = (zone.exit && zone.exit.kind) || 'fade';

        // Translate / scale accumulators. Entry and exit are time-disjoint
        // so we can compute each independently and the inactive one
        // contributes its identity (0 translate, 1 scale) automatically.
        let tx = 0, ty = 0, scl = 1;
        if (entryProg < 1 && entryKind !== 'fade') {
          // offset = 1 at entry start, 0 when fully entered. Slide starts
          // off-position by SLIDE_PCT in the kind's direction and resolves
          // to 0; scale starts at (1 - SCALE_OFF) and resolves to 1.
          const off = 1 - entryProg;
          if (entryKind === 'slide-up')    ty += SLIDE_PCT * off;   // start below, rise into place
          if (entryKind === 'slide-down')  ty -= SLIDE_PCT * off;   // start above, drop into place
          if (entryKind === 'slide-left')  tx += SLIDE_PCT * off;   // start to right, slide left into place
          if (entryKind === 'slide-right') tx -= SLIDE_PCT * off;   // start to left, slide right into place
          if (entryKind === 'scale')       scl *= (1 - SCALE_OFF * off);
        }
        if (exitProg < 1 && exitKind !== 'fade') {
          // offset = 0 at exit start, 1 when fully out. Slide leaves toward
          // the kind's direction; scale shrinks back down (mirrors entry).
          const off = 1 - exitProg;
          if (exitKind === 'slide-up')    ty -= SLIDE_PCT * off;    // exit upward
          if (exitKind === 'slide-down')  ty += SLIDE_PCT * off;    // exit downward
          if (exitKind === 'slide-left')  tx -= SLIDE_PCT * off;    // exit toward left
          if (exitKind === 'slide-right') tx += SLIDE_PCT * off;    // exit toward right
          if (exitKind === 'scale')       scl *= (1 - SCALE_OFF * off);
        }
        const transform = (tx === 0 && ty === 0 && scl === 1)
          ? undefined
          : `translate(${tx}%, ${ty}%) scale(${scl})`;

        const style = {
          position: 'absolute',
          left: `${zone.x}%`,
          top: `${zone.y}%`,
          width: `${zone.w}%`,
          height: `${zone.h}%`,
          overflow: 'hidden',
          opacity,
          transform,
          // Anchor scale around the zone's center so a 'scale' entry doesn't
          // drift off-position. Translate is also center-relative — fine
          // because slide distance is a fraction of the element itself.
          transformOrigin: 'center center',
        };

        if (zone.type === 'image' && zone.contentUrl) {
          // Default fit is 'contain' so the whole image is visible inside
          // the zone — no silent cropping when aspect doesn't match. User
          // opts into 'cover' explicitly for fill-the-zone behavior.
          const fit = zone.contentFit || 'contain';
          return (
            <div key={zone.id} style={style}>
              <Img
                src={resolveSrc(zone.contentUrl)}
                style={{ width: '100%', height: '100%', objectFit: fit }}
              />
            </div>
          );
        }

        if ((zone.type === 'video' || zone.type === 'hyperframes') && zone.contentUrl) {
          const fit = zone.contentFit || 'contain';
          // Loop default: true (back-compat for zones authored before the
          // `loop` field existed). Caller can opt out with loop: false to
          // freeze on the last frame instead of repeating.
          const shouldLoop = zone.loop !== false;
          // When the server has probed the inner clip's duration, wrap in
          // <Loop durationInFrames> for a deterministic loop. OffthreadVideo's
          // bare `loop` prop is unreliable when Remotion can't infer the
          // file's duration ahead of render — using <Loop> with an explicit
          // cycle length is the recommended pattern for short-clip-in-long-
          // window cases. If probe failed (innerDurationSec missing), fall
          // back to the bare loop prop.
          const innerSec = Number(zone.innerDurationSec) || 0;
          const innerFrames = innerSec > 0 ? Math.max(1, Math.round(innerSec * fps)) : 0;
          const useExplicitLoop = shouldLoop && innerFrames > 0;
          // Hyperframes-typed assets are always transparent overlays (Skyframe
          // Picker outputs, Hyperframes node outputs, etc.). Without
          // `transparent`, OffthreadVideo's frame-extraction pipeline drops
          // alpha and the empty pixels render as solid black on top of the
          // base. Plain 'video' zones (kling clips, source video) stay opaque.
          const isTransparent = zone.type === 'hyperframes';
          const videoEl = (
            <OffthreadVideo
              src={resolveSrc(zone.contentUrl)}
              muted
              loop={shouldLoop && !useExplicitLoop}
              transparent={isTransparent}
              style={{ width: '100%', height: '100%', objectFit: fit }}
            />
          );
          return (
            <div key={zone.id} style={style}>
              {useExplicitLoop
                ? <Loop durationInFrames={innerFrames}>{videoEl}</Loop>
                : videoEl}
            </div>
          );
        }

        if (zone.type === 'text') {
          const align = zone.contentAlign || 'center';
          const textStyle = {
            ...style,
            display: 'flex',
            alignItems: 'center',
            justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
            textAlign: align,
            color: zone.contentColor || '#ffffff',
            background: zone.contentBg || 'transparent',
            fontSize: `${zone.contentFontSize || 32}px`,
            fontWeight: 700,
            fontFamily: 'Arial Black, Impact, system-ui, sans-serif',
            padding: '12px 16px',
            lineHeight: 1.2,
            wordBreak: 'break-word',
          };
          return (
            <div key={zone.id} style={textStyle}>
              {zone.contentText || ''}
            </div>
          );
        }

        return null;
      })}
    </AbsoluteFill>
  );
};

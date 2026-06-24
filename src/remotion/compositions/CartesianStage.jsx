import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

/**
 * Cartesian Stage — the "paint with your hands" overlay rig.
 *
 * Renders timed shapes at exact pixel coordinates against a transparent (or
 * black) background. You fullscreen this on a reference monitor during the
 * shoot (mirrored for your performer view), then re-render it over the
 * chromakeyed footage in post — positions match exactly.
 *
 * Props:
 *   shapes       — array of shape defs (see below)
 *   mirror       — true to flip horizontally for the performer preview feed
 *   background   — 'black' | 'green' | 'transparent' (post comp uses transparent)
 *   showLabels   — show shape labels + countdowns on the preview feed
 *
 * Shape def (all coordinates in 1920x1080 space):
 *   {
 *     id: 'box1',
 *     type: 'rect' | 'circle' | 'line' | 'text',
 *     x, y, w, h          — bounding box (rect), center+radius (circle uses w as radius)
 *     x1, y1, x2, y2      — line endpoints
 *     text                — for type 'text'
 *     fill, stroke, strokeWidth, opacity, fontSize
 *     start, end          — seconds visible (defaults: 0 .. duration)
 *     fadeIn, fadeOut     — fade duration in seconds (default 0.2)
 *     label               — display label shown near the shape when showLabels
 *   }
 */
const DEFAULT_SHAPES = [
  {id: 'boxA', type: 'rect', x: 200, y: 200, w: 500, h: 400, fill: '#00ffff', opacity: 0.45, start: 1.0, end: 6.0, label: 'Left panel'},
  {id: 'boxB', type: 'rect', x: 1220, y: 200, w: 500, h: 400, fill: '#ff66cc', opacity: 0.45, start: 2.5, end: 6.0, label: 'Right panel'},
  {id: 'circleC', type: 'circle', x: 960, y: 750, w: 180, fill: '#ffff00', opacity: 0.55, start: 4.0, end: 7.5, label: 'Center pop'},
];

const BG_MAP = {
  black: '#000000',
  green: '#00ff00',
  transparent: 'rgba(0,0,0,0)',
};

export const CartesianStage = ({
  shapes = DEFAULT_SHAPES,
  mirror = false,
  background = 'black',
  showLabels = true,
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const tSec = frame / fps;
  const bgColor = BG_MAP[background] ?? background;

  return (
    <AbsoluteFill style={{backgroundColor: bgColor}}>
      <div style={{
        position: 'absolute',
        width,
        height,
        transform: mirror ? 'scaleX(-1)' : 'none',
        transformOrigin: 'center center',
      }}>
        <svg width={width} height={height} style={{position: 'absolute', left: 0, top: 0}}>
          {shapes.map((s) => {
            const start = s.start ?? 0;
            const end = s.end ?? 9999;
            if (tSec < start || tSec > end) return null;
            const fadeIn = s.fadeIn ?? 0.2;
            const fadeOut = s.fadeOut ?? 0.2;
            const inAlpha = fadeIn > 0
              ? interpolate(tSec, [start, start + fadeIn], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
              : 1;
            const outAlpha = fadeOut > 0
              ? interpolate(tSec, [end - fadeOut, end], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
              : 1;
            const alpha = Math.min(inAlpha, outAlpha) * (s.opacity ?? 1);

            if (s.type === 'rect') {
              return (
                <g key={s.id} opacity={alpha}>
                  <rect x={s.x} y={s.y} width={s.w} height={s.h}
                    fill={s.fill ?? '#00ffff'}
                    stroke={s.stroke ?? '#ffffff'}
                    strokeWidth={s.strokeWidth ?? 2} />
                </g>
              );
            }
            if (s.type === 'circle') {
              return (
                <g key={s.id} opacity={alpha}>
                  <circle cx={s.x} cy={s.y} r={s.w}
                    fill={s.fill ?? '#ffff00'}
                    stroke={s.stroke ?? '#ffffff'}
                    strokeWidth={s.strokeWidth ?? 2} />
                </g>
              );
            }
            if (s.type === 'line') {
              return (
                <line key={s.id} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
                  stroke={s.stroke ?? '#ffffff'}
                  strokeWidth={s.strokeWidth ?? 4}
                  opacity={alpha} />
              );
            }
            if (s.type === 'text') {
              return (
                <text key={s.id} x={s.x} y={s.y}
                  fill={s.fill ?? '#ffffff'}
                  fontSize={s.fontSize ?? 48}
                  fontFamily="monospace"
                  opacity={alpha}
                  dominantBaseline="middle">
                  {s.text}
                </text>
              );
            }
            if (s.type === 'path') {
              // Keyframed position: interpolate (x, y) from traced points by time.
              // points: [{t, x, y}, ...] where t is SECONDS from the shape's start.
              // Use Paint tool at /paint.html to author these arrays.
              const pts = (s.points || []).slice().sort((a, b) => a.t - b.t);
              if (pts.length === 0) return null;
              const tRel = tSec - start;
              let cx, cy;
              if (pts.length === 1) {
                cx = pts[0].x;
                cy = pts[0].y;
              } else {
                const times = pts.map((p) => p.t);
                const xs = pts.map((p) => p.x);
                const ys = pts.map((p) => p.y);
                cx = interpolate(tRel, times, xs, {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
                cy = interpolate(tRel, times, ys, {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
              }
              const r = s.radius ?? 30;
              return (
                <g key={s.id} opacity={alpha}>
                  {s.showTrail && pts.length > 1 && (
                    <polyline
                      points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none"
                      stroke={s.stroke ?? '#ffffff'}
                      strokeWidth={s.strokeWidth ?? 2}
                      opacity={0.35}
                      strokeDasharray={s.trailDash ?? '6 6'}
                    />
                  )}
                  <circle cx={cx} cy={cy} r={r}
                    fill={s.fill ?? '#00ffff'}
                    stroke={s.stroke ?? '#ffffff'}
                    strokeWidth={s.strokeWidth ?? 2} />
                </g>
              );
            }
            return null;
          })}
        </svg>

        {/* Performer helper labels — anchor point + id + seconds remaining.
            Counter-mirror so text stays readable when the stage is flipped. */}
        {showLabels && shapes.map((s) => {
          const start = s.start ?? 0;
          const end = s.end ?? 9999;
          const visible = tSec >= start - 0.5 && tSec <= end;
          if (!visible) return null;
          const lx = s.type === 'line' ? s.x1 : s.x;
          const ly = s.type === 'line' ? s.y1 : s.y;
          const pending = tSec < start;
          const remaining = pending ? (start - tSec) : (end - tSec);
          return (
            <div key={`lbl-${s.id}`} style={{
              position: 'absolute',
              left: lx,
              top: Math.max(0, ly - 38),
              transform: mirror ? 'scaleX(-1)' : 'none',
              transformOrigin: 'left top',
              color: pending ? '#ffff00' : '#ffffff',
              fontSize: 16,
              fontFamily: 'monospace',
              backgroundColor: 'rgba(0,0,0,0.7)',
              padding: '3px 7px',
              border: `1px solid ${pending ? '#ffff00' : '#ffffff'}`,
              whiteSpace: 'nowrap',
            }}>
              {s.label ?? s.id} · {pending ? 'in' : 'out'} {remaining.toFixed(1)}s
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

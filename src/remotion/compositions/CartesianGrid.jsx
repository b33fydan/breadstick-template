import React from 'react';
import {AbsoluteFill} from 'remotion';

/**
 * Calibration grid for the Cartesian rig.
 *
 * 1920x1080 landscape canvas with a 10x6 zone grid (A1..J6, each 192x180px)
 * plus a fine 96px grid and coordinate labels at every major intersection.
 * Fullscreen this on the reference monitor while filming so you know where
 * every shape will land before it lands.
 *
 * Props:
 *   mirror   — true to flip horizontally for a mirrored preview feed
 *   opacity  — overall opacity (lower for on-set reference, 1.0 for docs)
 */
const W = 1920;
const H = 1080;
const COLS = 10;
const ROWS = 6;
const CELL_W = W / COLS;
const CELL_H = H / ROWS;
const FINE = 96;
const ZONE_LETTERS = 'ABCDEFGHIJ';

export const CartesianGrid = ({mirror = false, opacity = 1}) => {
  const major = '#00ffff';
  const fine = '#1f4a4a';
  const label = '#ffff00';
  const zoneLabel = '#ff66cc';

  return (
    <AbsoluteFill style={{backgroundColor: '#050510', opacity}}>
      <div style={{
        position: 'absolute',
        width: W,
        height: H,
        transform: mirror ? 'scaleX(-1)' : 'none',
        transformOrigin: 'center center',
      }}>
        <svg width={W} height={H} style={{position: 'absolute', left: 0, top: 0}}>
          {/* Fine grid — every 96px */}
          {Array.from({length: Math.ceil(W / FINE) + 1}, (_, i) => (
            <line key={`fv${i}`} x1={i * FINE} y1={0} x2={i * FINE} y2={H} stroke={fine} strokeWidth={1} />
          ))}
          {Array.from({length: Math.ceil(H / FINE) + 1}, (_, i) => (
            <line key={`fh${i}`} x1={0} y1={i * FINE} x2={W} y2={i * FINE} stroke={fine} strokeWidth={1} />
          ))}

          {/* Major zone grid — 10x6 cells */}
          {Array.from({length: COLS + 1}, (_, i) => (
            <line key={`mv${i}`} x1={i * CELL_W} y1={0} x2={i * CELL_W} y2={H} stroke={major} strokeWidth={2} opacity={0.6} />
          ))}
          {Array.from({length: ROWS + 1}, (_, i) => (
            <line key={`mh${i}`} x1={0} y1={i * CELL_H} x2={W} y2={i * CELL_H} stroke={major} strokeWidth={2} opacity={0.6} />
          ))}

          {/* Center crosshair */}
          <line x1={W / 2 - 40} y1={H / 2} x2={W / 2 + 40} y2={H / 2} stroke="#ffffff" strokeWidth={2} />
          <line x1={W / 2} y1={H / 2 - 40} x2={W / 2} y2={H / 2 + 40} stroke="#ffffff" strokeWidth={2} />
          <circle cx={W / 2} cy={H / 2} r={10} fill="none" stroke="#ffffff" strokeWidth={2} />

          {/* Coordinate labels at major intersections */}
          {Array.from({length: COLS + 1}, (_, col) =>
            Array.from({length: ROWS + 1}, (_, row) => {
              const x = col * CELL_W;
              const y = row * CELL_H;
              return (
                <text key={`coord-${col}-${row}`}
                  x={x + 6} y={y + 18}
                  fill={label} fontSize={14} fontFamily="monospace" opacity={0.85}>
                  {Math.round(x)},{Math.round(y)}
                </text>
              );
            })
          )}

          {/* Zone labels (A1, B2...) in the center of each cell */}
          {Array.from({length: COLS}, (_, col) =>
            Array.from({length: ROWS}, (_, row) => {
              const cx = col * CELL_W + CELL_W / 2;
              const cy = row * CELL_H + CELL_H / 2;
              return (
                <text key={`zone-${col}-${row}`}
                  x={cx} y={cy}
                  fill={zoneLabel} fontSize={72} fontFamily="monospace"
                  fontWeight="bold" textAnchor="middle" dominantBaseline="middle"
                  opacity={0.28}>
                  {ZONE_LETTERS[col]}{row + 1}
                </text>
              );
            })
          )}
        </svg>

        {/* Corner tags — always readable even when mirrored by OBS */}
        <div style={cornerStyle('tl')}>0, 0</div>
        <div style={cornerStyle('tr')}>{W}, 0</div>
        <div style={cornerStyle('bl')}>0, {H}</div>
        <div style={cornerStyle('br')}>{W}, {H}</div>
      </div>

      {/* Mirror indicator — shows which side is which so you trust the feed */}
      <div style={{
        position: 'absolute', top: 16, left: 16,
        color: '#ffff00', fontSize: 18, fontFamily: 'monospace',
        backgroundColor: 'rgba(0,0,0,0.6)', padding: '6px 10px', borderRadius: 4,
      }}>
        {mirror ? 'MIRRORED (preview)' : 'UNMIRRORED (final)'}
      </div>
    </AbsoluteFill>
  );
};

function cornerStyle(corner) {
  const pad = 20;
  const base = {
    position: 'absolute',
    color: '#ffffff',
    fontSize: 16,
    fontFamily: 'monospace',
    backgroundColor: 'rgba(255,255,0,0.15)',
    border: '1px solid #ffff00',
    padding: '4px 8px',
  };
  if (corner === 'tl') return {...base, top: pad, left: pad};
  if (corner === 'tr') return {...base, top: pad, right: pad};
  if (corner === 'bl') return {...base, bottom: pad, left: pad};
  return {...base, bottom: pad, right: pad};
}

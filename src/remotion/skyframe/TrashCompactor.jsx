// ─── TrashCompactor SVG ──────────────────────────────────────────────────
// The "input gets crushed → output number" visualization. Default sideArt
// for the /compact beat, but exported separately so other visualizations
// (file-shrink, budget-bar, queue-drain) can swap in.
//
// Animation arc (frame indices are LOCAL to its parent's window):
//   0–8    press appears at top
//   8–32   press descends + numbers squish vertically
//   30–44  impact sparks burst outward
//   44–60  result number "snaps" in
//   60+    hold, then press lifts on exit
//
// Pass `local` (frames since parent window started) and `total` (window len).

import React from 'react';
import { interpolate } from 'remotion';
import { EASE_OUT, EASE_DRAWER } from './_helpers.jsx';

export const TrashCompactor = ({
  local,
  total,
  inputLabel = '245K',
  inputUnit = 'tokens',
  resultLabel = '40K',
  accentColor = '#FFC233',
}) => {
  const pressY = interpolate(local, [0, 8, 32, 60, total - 6, total],
    [-80, -20, 110, 110, -20, -60],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_DRAWER });

  const stackScaleY = interpolate(local, [8, 32], [1, 0.18], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_DRAWER,
  });
  const stackOp = interpolate(local, [8, 36, 46], [1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const resultOp = interpolate(local, [44, 56], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const resultScale = interpolate(local, [44, 60], [0.7, 1.0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT,
  });

  const sparkProg = interpolate(local, [30, 44], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const sparkOp = interpolate(local, [30, 36, 44], [0, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const containerOp = interpolate(local, [0, 6, total - 14, total],
    [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <svg width={340} height={440} style={{ opacity: containerOp, overflow: 'visible' }}>
      <defs>
        <linearGradient id="tc-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cdd2da" />
          <stop offset="50%" stopColor="#9aa3b0" />
          <stop offset="100%" stopColor="#6a7280" />
        </linearGradient>
        <linearGradient id="tc-edge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a3f48" />
          <stop offset="100%" stopColor="#1a1d22" />
        </linearGradient>
      </defs>

      <rect x={10} y={40} width={12} height={360} fill="url(#tc-edge)" />
      <rect x={318} y={40} width={12} height={360} fill="url(#tc-edge)" />
      <rect x={10} y={394} width={320} height={10} fill="url(#tc-edge)" />

      <g transform={`translate(0, ${pressY})`}>
        <rect x={22} y={120} width={296} height={48} fill="url(#tc-metal)" stroke="#1a1d22" strokeWidth="2" rx="4" />
        <rect x={160} y={66} width={20} height={54} fill="#666" />
        <circle cx={42} cy={144} r="4" fill="#3a3f48" />
        <circle cx={298} cy={144} r="4" fill="#3a3f48" />
      </g>

      <g transform={`translate(170, 210) scale(1, ${stackScaleY})`} style={{ opacity: stackOp, transformOrigin: 'center 100%' }}>
        <text x={0} y={0} fontFamily="Inter, Arial, sans-serif" fontWeight={900} fontSize={56}
          textAnchor="middle" fill="#fff" stroke="#000" strokeWidth="0.6">{inputLabel}</text>
        <text x={0} y={62} fontFamily="Inter, Arial, sans-serif" fontWeight={400} fontSize={24}
          textAnchor="middle" fill="rgba(255,255,255,0.7)">{inputUnit}</text>
        <text x={0} y={120} fontFamily="Inter, Arial, sans-serif" fontWeight={900} fontSize={36}
          textAnchor="middle" fill={accentColor}>↓</text>
      </g>

      <g style={{ opacity: sparkOp }}>
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const angle = (i / 6) * Math.PI * 2 + 0.2;
          const r0 = 12;
          const r1 = 60;
          const r = r0 + (r1 - r0) * sparkProg;
          const x1 = 170 + Math.cos(angle) * r0;
          const y1 = 280 + Math.sin(angle) * r0 * 0.5;
          const x2 = 170 + Math.cos(angle) * r;
          const y2 = 280 + Math.sin(angle) * r * 0.5;
          return (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={accentColor} strokeWidth="3" strokeLinecap="round"
              opacity={1 - sparkProg} />
          );
        })}
      </g>

      <g transform={`translate(170, 360) scale(${resultScale})`} style={{ opacity: resultOp, transformOrigin: 'center' }}>
        <rect x={-100} y={-46} width={200} height={74} rx="14"
          fill="rgba(255, 194, 51, 0.16)" stroke={accentColor} strokeWidth="2" />
        <text x={0} y={11} fontFamily="Inter, Arial, sans-serif" fontWeight={900} fontSize={52}
          textAnchor="middle" fill={accentColor}>{resultLabel}</text>
      </g>
    </svg>
  );
};

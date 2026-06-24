import React from 'react';
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  interpolateColors,
  Easing,
  random,
  AbsoluteFill,
} from 'remotion';

// ═══════════════════════════════════════════════════════════
// BEAT 7 — THE DISCOVERY (Negative Finding)
// Debate makes it WORSE. Single-turn: 72.0%. Multi-turn: 58.0%.
// (Demo placeholder numbers — illustrative only, not real data.)
// Chart with two diverging lines. The honest answer IS the product.
// Emotion: Shock → intellectual honesty → this IS the contribution
// ═══════════════════════════════════════════════════════════

const SKY = {
  yellow: '#ffff00',
  cyan: '#00ffff',
  white: '#ffffff',
  muted: '#cccccc',
  green: '#00ff88',
  red: '#ff3344',
};

const GENTLE = { damping: 20, stiffness: 80, mass: 1 };

// Chart dimensions
const CHART = { left: 360, top: 180, width: 1200, height: 520, bottom: 700 };

// Data points for lines (normalized 0-1 on Y axis where 1 = 100%)
// Single-turn line: starts ~50%, climbs to 72.0% (demo placeholder)
const SINGLE_TURN = [
  { x: 0, y: 0.50 }, { x: 0.15, y: 0.54 }, { x: 0.3, y: 0.60 },
  { x: 0.45, y: 0.64 }, { x: 0.6, y: 0.67 }, { x: 0.75, y: 0.70 },
  { x: 0.9, y: 0.71 }, { x: 1, y: 0.72 },
];
// Multi-turn line: starts ~57%, drops to 58.0% (demo placeholder)
const MULTI_TURN = [
  { x: 0, y: 0.57 }, { x: 0.15, y: 0.56 }, { x: 0.3, y: 0.58 },
  { x: 0.45, y: 0.59 }, { x: 0.6, y: 0.58 }, { x: 0.75, y: 0.57 },
  { x: 0.9, y: 0.58 }, { x: 1, y: 0.58 },
];

const toChartCoords = (pt) => ({
  x: CHART.left + pt.x * CHART.width,
  y: CHART.bottom - pt.y * CHART.height,
});

const makeLinePath = (points, progress) => {
  const visibleCount = Math.ceil(progress * points.length);
  const visible = points.slice(0, visibleCount);
  if (visible.length < 2) return '';
  return visible.map((pt, i) => {
    const c = toChartCoords(pt);
    return `${i === 0 ? 'M' : 'L'}${c.x},${c.y}`;
  }).join(' ');
};

// Dust
const DUST = Array.from({ length: 30 }, (_, i) => ({
  x: random(`dx${i}`) * 1920,
  y: random(`dy${i}`) * 1080,
  size: 1.5 + random(`ds${i}`) * 2,
  speed: 0.5 + random(`dv${i}`) * 1,
  phase: random(`dp${i}`) * Math.PI * 2,
  baseAlpha: 0.04 + random(`da${i}`) * 0.06,
}));

export const Beat07Discovery = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(frame, [durationInFrames - 30, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const master = fadeIn * fadeOut;

  // Phases:
  // 0-30: Chart axes draw
  // 30-150: Both lines draw simultaneously
  // 150-190: Divergence highlighted, labels appear
  // 190-230: Red arrow on multi-turn, percentage callouts
  // 230-260: Text: "DEBATE MAKES IT WORSE"
  // 260-300: Fade out

  // Axes draw
  const axesDraw = interpolate(frame, [10, 40], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

  // Line draw progress
  const lineDraw = interpolate(frame, [35, 150], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // Labels
  const labelEntry = Math.min(1, Math.max(0, spring({
    frame: frame - 155, fps, config: GENTLE,
  })));

  // Percentage callouts
  const pctEntry = Math.min(1, Math.max(0, spring({
    frame: frame - 195, fps, config: { damping: 10, stiffness: 120, mass: 0.7 },
  })));

  // Red arrow pulse
  const arrowPulse = interpolate(frame, [195, 215, 255, 275], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Text
  const t1 = Math.min(1, Math.max(0, spring({ frame: frame - 210, fps, config: GENTLE })));
  const t2 = Math.min(1, Math.max(0, spring({ frame: frame - 228, fps, config: GENTLE })));
  const textOut = interpolate(frame, [durationInFrames - 50, durationInFrames - 18], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // End points for labels
  const singleEnd = toChartCoords(SINGLE_TURN[SINGLE_TURN.length - 1]);
  const multiEnd = toChartCoords(MULTI_TURN[MULTI_TURN.length - 1]);

  return (
    <AbsoluteFill style={{ opacity: master }}>
      {/* Background */}
      <AbsoluteFill style={{
        background: 'radial-gradient(ellipse at 50% 50%, #141418 0%, #0a0a0e 55%, #000000 100%)',
      }} />

      {/* Dust */}
      {DUST.map((d, i) => {
        const px = d.x + Math.sin(frame * 0.008 * d.speed + d.phase) * 20;
        const py = d.y + Math.cos(frame * 0.006 * d.speed + d.phase * 1.3) * 14;
        const dOp = interpolate(frame, [5, 40], [0, d.baseAlpha], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        return (
          <div key={`d${i}`} style={{
            position: 'absolute', left: px, top: py,
            width: d.size, height: d.size, borderRadius: '50%',
            backgroundColor: SKY.cyan, opacity: dOp,
          }} />
        );
      })}

      {/* Chart SVG */}
      <svg width={1920} height={1080} style={{ position: 'absolute' }}>
        <defs>
          <filter id="lineGlow">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Y axis */}
        <line
          x1={CHART.left} y1={CHART.top}
          x2={CHART.left} y2={CHART.top + (CHART.bottom - CHART.top) * axesDraw}
          stroke="rgba(255,255,255,0.2)" strokeWidth={1.5}
        />
        {/* X axis */}
        <line
          x1={CHART.left} y1={CHART.bottom}
          x2={CHART.left + CHART.width * axesDraw} y2={CHART.bottom}
          stroke="rgba(255,255,255,0.2)" strokeWidth={1.5}
        />

        {/* Y-axis labels */}
        {[0, 25, 50, 75, 100].map((pct) => {
          const y = CHART.bottom - (pct / 100) * CHART.height;
          return (
            <React.Fragment key={`y${pct}`}>
              <line
                x1={CHART.left - 8} y1={y} x2={CHART.left} y2={y}
                stroke="rgba(255,255,255,0.15)" strokeWidth={1}
                opacity={axesDraw}
              />
              <text
                x={CHART.left - 15} y={y + 4}
                fill={SKY.muted} fontSize={12}
                textAnchor="end" fontFamily="'Courier New', monospace"
                opacity={axesDraw * 0.6}
              >
                {pct}%
              </text>
              {/* Grid line */}
              <line
                x1={CHART.left} y1={y} x2={CHART.left + CHART.width} y2={y}
                stroke="rgba(255,255,255,0.04)" strokeWidth={0.5}
                opacity={axesDraw}
              />
            </React.Fragment>
          );
        })}

        {/* Single-turn line (green/cyan) */}
        {lineDraw > 0 && (
          <path
            d={makeLinePath(SINGLE_TURN, lineDraw)}
            fill="none" stroke={SKY.green} strokeWidth={3}
            filter="url(#lineGlow)"
          />
        )}

        {/* Multi-turn line (red) */}
        {lineDraw > 0 && (
          <path
            d={makeLinePath(MULTI_TURN, lineDraw)}
            fill="none" stroke={SKY.red} strokeWidth={3}
            filter="url(#lineGlow)"
          />
        )}

        {/* Red downward arrow at multi-turn endpoint */}
        {arrowPulse > 0 && (
          <g opacity={arrowPulse}>
            <line
              x1={multiEnd.x + 40} y1={multiEnd.y - 30}
              x2={multiEnd.x + 40} y2={multiEnd.y + 30}
              stroke={SKY.red} strokeWidth={3}
            />
            <polygon
              points={`${multiEnd.x + 30},${multiEnd.y + 20} ${multiEnd.x + 50},${multiEnd.y + 20} ${multiEnd.x + 40},${multiEnd.y + 40}`}
              fill={SKY.red}
            />
          </g>
        )}
      </svg>

      {/* Line labels */}
      {labelEntry > 0 && (
        <>
          <div style={{
            position: 'absolute',
            left: singleEnd.x + 15, top: singleEnd.y - 12,
            fontFamily: '"Courier New", monospace',
            fontSize: 14, fontWeight: 'bold', letterSpacing: 1,
            color: SKY.green, opacity: labelEntry,
          }}>
            SINGLE-TURN
          </div>
          <div style={{
            position: 'absolute',
            left: multiEnd.x + 65, top: multiEnd.y - 12,
            fontFamily: '"Courier New", monospace',
            fontSize: 14, fontWeight: 'bold', letterSpacing: 1,
            color: SKY.red, opacity: labelEntry,
          }}>
            MULTI-TURN
          </div>
        </>
      )}

      {/* Percentage callouts */}
      {pctEntry > 0 && (
        <>
          <div style={{
            position: 'absolute',
            left: singleEnd.x - 30, top: singleEnd.y - 55,
            fontSize: 36, fontWeight: 'bold',
            color: SKY.green,
            fontFamily: '"Georgia", serif',
            opacity: pctEntry,
            transform: `scale(${0.7 + pctEntry * 0.3})`,
            textShadow: `0 0 15px rgba(0,255,136,0.4)`,
          }}>
            72.0%
          </div>
          <div style={{
            position: 'absolute',
            left: multiEnd.x + 60, top: multiEnd.y - 55,
            fontSize: 36, fontWeight: 'bold',
            color: SKY.red,
            fontFamily: '"Georgia", serif',
            opacity: pctEntry,
            transform: `scale(${0.7 + pctEntry * 0.3})`,
            textShadow: `0 0 15px rgba(255,51,68,0.4)`,
          }}>
            58.0%
          </div>
        </>
      )}

      {/* Text */}
      <div style={{
        position: 'absolute', bottom: 80, left: 0, right: 0,
        textAlign: 'center', fontFamily: '"Georgia", serif',
      }}>
        <div style={{
          fontSize: 44, fontWeight: 'bold', letterSpacing: 4,
          color: SKY.red,
          opacity: t1 * textOut,
          transform: `translateY(${interpolate(t1, [0, 1], [25, 0])}px)`,
          textShadow: '0 0 25px rgba(255,51,68,0.3)',
        }}>
          DEBATE MAKES IT WORSE
        </div>
        <div style={{
          fontSize: 28, letterSpacing: 3, marginTop: 14,
          color: SKY.muted,
          opacity: t2 * textOut,
          transform: `translateY(${interpolate(t2, [0, 1], [25, 0])}px)`,
        }}>
          THE HONEST ANSWER IS THE CONTRIBUTION
        </div>
      </div>
    </AbsoluteFill>
  );
};

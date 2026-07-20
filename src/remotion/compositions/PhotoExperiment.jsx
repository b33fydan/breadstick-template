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
  Img,
  staticFile,
} from 'remotion';

// ═══════════════════════════════════════════════════════════
// PHOTO EXPERIMENT — Layered animation over a static PNG
//
// Technique demo: The PNG is a backdrop. We overlay animated
// elements positioned to match specific regions of the photo:
//   - Monitor screen: scrolling code + scan line
//   - Question mark area: radiating particles
//   - Lightbulb area: pulsing glow
//   - Ambient: floating dust motes
// ═══════════════════════════════════════════════════════════

const SKY = {
  yellow: '#ffff00',
  cyan: '#00ffff',
  white: '#ffffff',
  green: '#00ff88',
};

// ─── Region coordinates (measured from the 1920x1080 render) ──
// These are eyeballed — tweak in Remotion Studio until perfect

const MONITOR = { left: 150, top: 195, width: 530, height: 380 };
const QUESTION_MARK = { cx: 710, cy: 170, radius: 150 };
const LIGHTBULB = { cx: 1300, cy: 600, radius: 90 };

// ─── Fake code lines for the monitor ──────────────────────
const CODE = [
  '$ python run_benchmark.py',
  '',
  'Loading corpus... 33 scenarios',
  'Initializing Architect agent...',
  'Initializing Skeptic agent...',
  'Initializing OracleJudge...',
  '',
  '[ RUN  ] benchmark_baseline_001',
  '[ PASS ] accuracy: 0.720  (72.0%)',
  '[ RUN  ] benchmark_baseline_002',
  '[ PASS ] accuracy: 0.715  (71.5%)',
  '[ RUN  ] benchmark_pentest_001',
  '[ PASS ] accuracy: 1.000  (100%)',
  '',
  'Evidence packets frozen: 247',
  'Schema violations caught: 12',
  'Hallucinations: 0',
  '',
  '═══ RESULTS ═══════════════════',
  'Single-turn accuracy: 72.0%',
  'Multi-turn accuracy:  58.0%',
  'Regressions: 0',
  '',
  'Kill chain awareness: ENABLED',
  'Confidence dynamics: LOGGED',
  '',
  '$ _',
];

// ─── Particles around question mark ───────────────────────
const QM_PARTICLES = Array.from({ length: 25 }, (_, i) => ({
  angle: random(`qa${i}`) * Math.PI * 2,
  dist: 30 + random(`qd${i}`) * 120,
  size: 2 + random(`qs${i}`) * 4,
  speed: 0.3 + random(`qv${i}`) * 0.7,
  phase: random(`qp${i}`) * Math.PI * 2,
  alpha: 0.3 + random(`qo${i}`) * 0.5,
}));

// ─── Ambient floating particles ───────────────────────────
const DUST = Array.from({ length: 30 }, (_, i) => ({
  x: random(`dx${i}`) * 1920,
  y: random(`dy${i}`) * 1080,
  size: 1 + random(`ds${i}`) * 3,
  speed: 0.3 + random(`dv${i}`) * 0.6,
  phase: random(`dp${i}`) * Math.PI * 2,
  alpha: 0.08 + random(`da${i}`) * 0.15,
  isCyan: random(`dc${i}`) > 0.3,
}));

// ═══════════════════════════════════════════════════════════
// COMPOSITION
// ═══════════════════════════════════════════════════════════

export const PhotoExperiment = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Master fade
  const fadeIn = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(frame, [durationInFrames - 30, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const master = fadeIn * fadeOut;

  // ── Monitor: code scroll ────────────────────────────────
  // Scroll the code upward over time
  const lineHeight = 18;
  const totalCodeHeight = CODE.length * lineHeight;
  const scrollOffset = interpolate(frame, [20, 250], [0, totalCodeHeight - MONITOR.height + 40], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

  // Scan line sweeping down the monitor
  const scanY = (frame * 2.5) % (MONITOR.height + 20);

  // Monitor glow intensity
  const monGlow = interpolate(frame, [10, 40, 260, 290], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // ── Question mark: orbiting particles ───────────────────
  const qmIntensity = interpolate(frame, [15, 50, 260, 290], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const qmPulse = 0.7 + 0.3 * Math.sin(frame * 0.08);

  // ── Lightbulb: pulsing glow ─────────────────────────────
  const lbPulse = 0.5 + 0.5 * Math.sin(frame * 0.1);
  const lbIntensity = interpolate(frame, [30, 60, 260, 290], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity: master, backgroundColor: '#000' }}>

      {/* ═══ LAYER 1: Static photo (backdrop) ═══ */}
      <Img
        src={staticFile('deep-ai-questions.png')}
        style={{
          width: 1920, height: 1080,
          objectFit: 'cover',
        }}
      />

      {/* ═══ LAYER 2: Monitor screen overlay ═══ */}
      <div style={{
        position: 'absolute',
        left: MONITOR.left, top: MONITOR.top,
        width: MONITOR.width, height: MONITOR.height,
        overflow: 'hidden',
        // Semi-transparent dark overlay so code is readable over the brain graphic
        backgroundColor: 'rgba(0,5,15,0.65)',
        borderRadius: 4,
      }}>
        {/* Scrolling code */}
        <div style={{
          position: 'absolute',
          left: 14, top: 10 - scrollOffset,
          fontFamily: '"Courier New", monospace',
          fontSize: 13, lineHeight: `${lineHeight}px`,
          whiteSpace: 'pre',
        }}>
          {CODE.map((line, i) => {
            const isResult = line.includes('PASS') || line.includes('100%');
            const isHeader = line.includes('═');
            const isCommand = line.startsWith('$');
            const isKey = line.includes('accuracy') || line.includes('Regressions: 0');
            let color = 'rgba(0,255,255,0.7)';
            if (isResult) color = SKY.green;
            if (isHeader) color = SKY.yellow;
            if (isCommand) color = SKY.white;
            if (isKey) color = SKY.yellow;
            if (line === '') color = 'transparent';

            // Typewriter: line appears when scroll reaches it
            const lineY = i * lineHeight - scrollOffset + 10;
            const visible = lineY > -lineHeight && lineY < MONITOR.height + lineHeight;
            if (!visible) return <div key={i} style={{ height: lineHeight }} />;

            return (
              <div key={i} style={{
                color,
                height: lineHeight,
                opacity: monGlow,
              }}>
                {line}
              </div>
            );
          })}
        </div>

        {/* Scan line */}
        <div style={{
          position: 'absolute',
          left: 0, top: scanY, width: '100%', height: 2,
          backgroundColor: `rgba(0,255,255,${0.15 * monGlow})`,
          boxShadow: `0 0 8px rgba(0,255,255,${0.2 * monGlow})`,
          pointerEvents: 'none',
        }} />

        {/* Screen edge glow */}
        <div style={{
          position: 'absolute', inset: 0,
          border: `1px solid rgba(0,255,255,${0.12 * monGlow})`,
          borderRadius: 4,
          boxShadow: `inset 0 0 30px rgba(0,255,255,${0.06 * monGlow})`,
          pointerEvents: 'none',
        }} />
      </div>

      {/* ═══ LAYER 3: Question mark particles ═══ */}
      {qmIntensity > 0 && QM_PARTICLES.map((p, i) => {
        // Orbit around the question mark center
        const angle = p.angle + frame * 0.008 * p.speed;
        const dist = p.dist + Math.sin(frame * 0.04 + p.phase) * 15;
        const px = QUESTION_MARK.cx + Math.cos(angle) * dist;
        const py = QUESTION_MARK.cy + Math.sin(angle) * dist;
        return (
          <div key={`qp${i}`} style={{
            position: 'absolute',
            left: px - p.size / 2, top: py - p.size / 2,
            width: p.size, height: p.size, borderRadius: '50%',
            backgroundColor: SKY.cyan,
            opacity: p.alpha * qmIntensity * qmPulse,
            boxShadow: `0 0 ${4 + p.size}px rgba(0,255,255,0.5)`,
          }} />
        );
      })}

      {/* Question mark center glow */}
      {qmIntensity > 0 && (
        <div style={{
          position: 'absolute',
          left: QUESTION_MARK.cx - 80, top: QUESTION_MARK.cy - 80,
          width: 160, height: 160, borderRadius: '50%',
          background: `radial-gradient(circle,
            rgba(0,255,255,${0.08 * qmIntensity * qmPulse}) 0%,
            transparent 70%)`,
          pointerEvents: 'none',
        }} />
      )}

      {/* ═══ LAYER 4: Lightbulb glow pulse ═══ */}
      {lbIntensity > 0 && (
        <>
          <div style={{
            position: 'absolute',
            left: LIGHTBULB.cx - 70, top: LIGHTBULB.cy - 70,
            width: 140, height: 140, borderRadius: '50%',
            background: `radial-gradient(circle,
              rgba(255,255,0,${0.12 * lbIntensity * lbPulse}) 0%,
              rgba(255,255,0,${0.04 * lbIntensity * lbPulse}) 40%,
              transparent 70%)`,
            pointerEvents: 'none',
          }} />
          {/* Sparkle ring */}
          <div style={{
            position: 'absolute',
            left: LIGHTBULB.cx - 50, top: LIGHTBULB.cy - 50,
            width: 100, height: 100, borderRadius: '50%',
            border: `1px solid rgba(255,255,0,${0.1 * lbIntensity * lbPulse})`,
            pointerEvents: 'none',
            transform: `scale(${1 + lbPulse * 0.15})`,
          }} />
        </>
      )}

      {/* ═══ LAYER 5: Ambient floating particles ═══ */}
      {DUST.map((d, i) => {
        const px = d.x + Math.sin(frame * 0.006 * d.speed + d.phase) * 25;
        const py = d.y + Math.cos(frame * 0.004 * d.speed + d.phase * 1.3) * 18;
        // Drift upward slowly
        const drift = (frame * 0.15 * d.speed) % 1080;
        const finalY = (py - drift + 1080) % 1080;
        return (
          <div key={`dust${i}`} style={{
            position: 'absolute', left: px, top: finalY,
            width: d.size, height: d.size, borderRadius: '50%',
            backgroundColor: d.isCyan ? SKY.cyan : SKY.yellow,
            opacity: d.alpha * master,
            boxShadow: d.size > 2.5
              ? `0 0 ${d.size * 2}px ${d.isCyan ? 'rgba(0,255,255,0.3)' : 'rgba(255,255,0,0.3)'}`
              : 'none',
          }} />
        );
      })}

      {/* ═══ LAYER 6: Data stream lines (connecting monitor to question mark) ═══ */}
      <svg width={1920} height={1080} style={{ position: 'absolute', pointerEvents: 'none' }}>
        {Array.from({ length: 5 }, (_, i) => {
          // Animated data packets traveling from monitor to question mark
          const speed = 1.5 + i * 0.4;
          const cycleLen = 120 / speed;
          const t = ((frame - 40 - i * 15) % cycleLen) / cycleLen;
          if (frame < 40 + i * 15 || t < 0) return null;

          const startX = MONITOR.left + MONITOR.width;
          const startY = MONITOR.top + 60 + i * 40;
          const endX = QUESTION_MARK.cx;
          const endY = QUESTION_MARK.cy + 50;

          // Curved path
          const ctrlX = (startX + endX) / 2 + (i % 2 === 0 ? 40 : -40);
          const ctrlY = (startY + endY) / 2 - 60;

          // Position along bezier curve
          const mt = 1 - t;
          const px = mt * mt * startX + 2 * mt * t * ctrlX + t * t * endX;
          const py = mt * mt * startY + 2 * mt * t * ctrlY + t * t * endY;

          const pOp = interpolate(t, [0, 0.05, 0.9, 1], [0, 0.7, 0.7, 0], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          }) * monGlow;

          return (
            <circle key={`dp${i}`}
              cx={px} cy={py} r={3}
              fill={SKY.cyan}
              opacity={pOp}
              style={{ filter: 'drop-shadow(0 0 4px rgba(0,255,255,0.6))' }}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

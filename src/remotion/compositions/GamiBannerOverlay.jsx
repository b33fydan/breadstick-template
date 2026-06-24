import React from 'react';
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  AbsoluteFill,
} from 'remotion';

/**
 * 16-GAMI Paper Banner Overlay — Aggressive Edition
 *
 * Paper banners that unfold hard, sit solid, fold back.
 * Composited on top of talking-head video via FFmpeg VP9 alpha.
 *
 * Props:
 *   cues: [{ text, start, end, position?, style? }]
 */

const COLORS = {
  paper: '#F5ECD0',
  paperDark: '#C9B88A',
  paperEdge: '#8B7355',
  text: '#0a0a0a',
  accent: '#C9A227',
  accentBright: '#E8C840',
  pixelBorder: '#6B5535',
  shadow: 'rgba(0,0,0,0.7)',
};

const PaperBanner = ({ text, progress, foldBack, position = 'bottom', style = 'banner' }) => {
  const unfoldAngle = interpolate(progress, [0, 1], [90, 0], { extrapolateRight: 'clamp' });
  const foldAngle = interpolate(foldBack, [0, 1], [0, -90], { extrapolateRight: 'clamp' });
  const angle = foldBack > 0 ? foldAngle : unfoldAngle;

  // Hard opacity — fully visible once unfolded, no fade
  const opacity = foldBack > 0.8 ? interpolate(foldBack, [0.8, 1], [1, 0], { extrapolateRight: 'clamp' })
    : progress < 0.2 ? interpolate(progress, [0, 0.2], [0, 1], { extrapolateRight: 'clamp' })
    : 1;

  const foldShadow = interpolate(Math.abs(angle), [0, 90], [0, 0.7], { extrapolateRight: 'clamp' });

  const isPill = style === 'pill';
  const isCallout = style === 'callout';

  // Positions — pushed further from edges, bigger footprint
  const positionStyles = {
    bottom: { bottom: 180, left: 40, right: 40 },
    top: { top: 120, left: 40, right: 40 },
    center: { top: '38%', left: 50, right: 50 },
    'bottom-left': { bottom: 200, left: 40, right: 'auto', maxWidth: '70%' },
    'bottom-right': { bottom: 200, right: 40, left: 'auto', maxWidth: '70%' },
  };

  return (
    <div
      style={{
        position: 'absolute',
        ...positionStyles[position],
        perspective: 600,
        zIndex: 10,
        opacity,
        pointerEvents: 'none',
      }}
    >
      {/* Heavy drop shadow */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          right: -12,
          bottom: -12,
          background: COLORS.shadow,
          borderRadius: isPill ? 50 : 6,
          filter: 'blur(12px)',
          opacity: interpolate(Math.abs(angle), [0, 45], [0.7, 0], { extrapolateRight: 'clamp' }),
        }}
      />

      {/* Paper body with fold transform */}
      <div
        style={{
          transformOrigin: 'top center',
          transform: `rotateX(${angle}deg)`,
          backfaceVisibility: 'hidden',
        }}
      >
        {/* Outer paper */}
        <div
          style={{
            background: `linear-gradient(170deg, ${COLORS.paper} 0%, ${COLORS.paperDark} 100%)`,
            borderRadius: isPill ? 50 : 6,
            padding: isPill ? '24px 56px' : isCallout ? '20px 32px' : '28px 44px',
            position: 'relative',
            border: `3px solid ${COLORS.pixelBorder}`,
            // Double border pixel effect
            boxShadow: `
              inset 0 0 0 3px ${COLORS.paper},
              inset 0 0 0 5px ${COLORS.pixelBorder},
              0 4px 0 ${COLORS.pixelBorder},
              4px 0 0 ${COLORS.pixelBorder},
              4px 4px 0 ${COLORS.pixelBorder},
              0 8px 24px rgba(0,0,0,0.5)
            `,
            backgroundImage: `linear-gradient(180deg,
              rgba(255,255,255,0.15) 0%,
              rgba(0,0,0,0) 30%,
              rgba(0,0,0,${foldShadow * 0.4}) 50%,
              rgba(0,0,0,0) 70%,
              rgba(139,115,85,${foldShadow * 0.3}) 100%
            )`,
          }}
        >
          {/* Paper grain texture */}
          <div
            style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              opacity: 0.06,
              background: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
              backgroundSize: '128px 128px',
              borderRadius: isPill ? 50 : 6,
              pointerEvents: 'none',
            }}
          />

          {/* Fold crease */}
          <div
            style={{
              position: 'absolute',
              top: '48%', left: 16, right: 16,
              height: 2,
              background: `linear-gradient(90deg, transparent 5%, ${COLORS.paperEdge}66 30%, ${COLORS.paperEdge}66 70%, transparent 95%)`,
              opacity: interpolate(Math.abs(angle), [0, 20], [0.5, 0], { extrapolateRight: 'clamp' }),
            }}
          />

          {/* Gold accent bar — thick and bold */}
          {!isPill && (
            <div
              style={{
                position: 'absolute',
                left: 0, top: 0, bottom: 0,
                width: 8,
                background: `linear-gradient(180deg, ${COLORS.accentBright}, ${COLORS.accent})`,
                borderRadius: '6px 0 0 6px',
                boxShadow: `2px 0 8px ${COLORS.accent}66`,
              }}
            />
          )}

          {/* Text — big and bold */}
          <div
            style={{
              fontFamily: "'Space Mono', 'Courier New', monospace",
              fontSize: isPill ? 36 : isCallout ? 34 : 42,
              fontWeight: 700,
              color: COLORS.text,
              textTransform: 'uppercase',
              letterSpacing: isPill ? 4 : 3,
              textAlign: isPill ? 'center' : 'left',
              paddingLeft: !isPill ? 20 : 0,
              lineHeight: 1.2,
              textShadow: `2px 2px 0 ${COLORS.paperDark}`,
              position: 'relative',
              zIndex: 1,
            }}
          >
            {text}
          </div>

          {/* Pixel corner blocks — bigger */}
          {!isPill && (
            <>
              <div style={{ position: 'absolute', top: -3, right: -3, width: 14, height: 14, background: COLORS.accent }} />
              <div style={{ position: 'absolute', bottom: -3, left: -3, width: 14, height: 14, background: COLORS.accent }} />
              <div style={{ position: 'absolute', top: -3, left: -3, width: 8, height: 8, background: COLORS.pixelBorder }} />
              <div style={{ position: 'absolute', bottom: -3, right: -3, width: 8, height: 8, background: COLORS.pixelBorder }} />
            </>
          )}
        </div>
      </div>
    </div>
  );
};


export const GamiBannerOverlay = ({ cues = [] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const UNFOLD_DURATION = 0.35;
  const FOLD_DURATION = 0.3;

  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
      {cues.map((cue, i) => {
        const unfoldStart = cue.start - 0.05;
        const foldStart = cue.end;

        const unfoldProgress = spring({
          frame: Math.max(0, (currentTime - unfoldStart) * fps),
          fps,
          config: { damping: 12, stiffness: 160, mass: 0.7 },
          durationInFrames: Math.ceil(UNFOLD_DURATION * fps),
        });

        const foldProgress = spring({
          frame: Math.max(0, (currentTime - foldStart) * fps),
          fps,
          config: { damping: 14, stiffness: 180, mass: 0.5 },
          durationInFrames: Math.ceil(FOLD_DURATION * fps),
        });

        if (currentTime < unfoldStart - 0.3 || currentTime > foldStart + 0.8) return null;

        return (
          <PaperBanner
            key={i}
            text={cue.text}
            progress={unfoldProgress}
            foldBack={foldProgress}
            position={cue.position || 'bottom'}
            style={cue.style || 'banner'}
          />
        );
      })}
    </AbsoluteFill>
  );
};

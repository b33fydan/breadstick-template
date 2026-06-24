import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, delayRender, continueRender } from 'remotion';

/**
 * Stage 3: Animated terminal carousel slide.
 *
 * Composites a typing animation OVER the static slide's terminal block. The
 * static slide PNG (rendered by carousels/render.py for terminal_body slides)
 * is the background; an opaque layer at terminalZone covers the static terminal
 * contents and the typing animation draws inside.
 *
 * Slide dimensions: 1080x1350 (Instagram portrait, matches render.py).
 *
 * Required props:
 *   slidePath        path to static slide PNG (relative to public/), e.g.
 *                    'terminal-slides/slide_1.png'
 *   terminalZone     {x, y, w, h} — rectangle to overlay, from zones.json
 *   terminal         {header, subtitle, cwd, prompt, lines: [{kind, text}]}
 *   palette          {bg, text, muted, accent, border} from the slide template
 *
 * Optional timing props (sensible defaults):
 *   charsPerSecond   typing speed (default 40)
 *   linePauseSeconds pause between events (default 0.3)
 *   finalHoldSeconds hold on final frame after typing completes (default 1.5)
 */

// Component-scoped font preload (see useFontPreload hook below). The loader
// MUST live inside the component, not at module scope: a module-scope
// delayRender blocks every other composition rendered from this Root.jsx —
// including CartesianComposer renders that don't need SpaceMono at all.
function useFontPreload() {
  // Lazy initializer: delayRender runs once during the first render of THIS
  // component. Remotion sees the handle and pauses frame capture until the
  // useEffect below clears it. Other comps never trigger this code path.
  const [fontHandle] = useState(() => delayRender('Loading SpaceMono'));
  useEffect(() => {
    let cleared = false;
    const safeContinue = () => {
      if (cleared) return;
      cleared = true;
      continueRender(fontHandle);
    };
    try {
      const fontReg = new FontFace('SpaceMono', `url(${staticFile('fonts/SpaceMono-Regular.ttf')})`);
      const fontBold = new FontFace('SpaceMono', `url(${staticFile('fonts/SpaceMono-Bold.ttf')})`, { weight: 'bold' });
      Promise.all([fontReg.load(), fontBold.load()])
        .then((fonts) => { fonts.forEach((f) => document.fonts.add(f)); safeContinue(); })
        .catch(safeContinue);
    } catch {
      safeContinue();
    }
    // 5s ceiling — if fonts truly never resolve, fall back to system mono
    // rather than hanging the whole render.
    const t = setTimeout(safeContinue, 5000);
    return () => clearTimeout(t);
  }, [fontHandle]);
}

const lighten = (hex, amt) => {
  const c = (hex || '#000').replace('#', '');
  const r = Math.min(255, parseInt(c.slice(0, 2), 16) + amt);
  const g = Math.min(255, parseInt(c.slice(2, 4), 16) + amt);
  const b = Math.min(255, parseInt(c.slice(4, 6), 16) + amt);
  return `rgb(${r}, ${g}, ${b})`;
};

const SUCCESS_GREEN = '#5fd1b8';

// Drawn checkmark (SVG) — matches render.py's manually drawn shape, since
// SpaceMono lacks ✓.
const CheckGlyph = ({ size = 18, color = SUCCESS_GREEN }) => (
  <svg width={size} height={size} viewBox="0 0 18 18" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
    <polyline
      points="2,11 7,16 16,3"
      fill="none"
      stroke={color}
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const TerminalCarouselSlide = ({
  slidePath,
  terminalZone,
  terminal,
  palette,
  charsPerSecond = 40,
  linePauseSeconds = 0.3,
  finalHoldSeconds = 1.5,
}) => {
  useFontPreload();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const slide = slidePath ? staticFile(slidePath) : null;
  const zone = terminalZone || { x: 80, y: 224, w: 920, h: 500 };
  const term = terminal || { header: '', subtitle: '', cwd: '', prompt: '', lines: [] };
  const pal = palette || {
    bg: '#111122', text: '#e8e8e8', muted: '#777799', accent: '#5588ff', border: '#2a2a44',
  };

  const isWin95 = term.style === 'win95' || zone.aspect === 'win95' || zone.aspect === 'win95_msg';
  // Message-only mode: chrome is baked into static slide, only message types
  const messageOnly = zone.aspect === 'terminal_msg' || zone.aspect === 'win95_msg';
  const termBg = zone.term_bg_hex || lighten(pal.bg, 18);
  const titleBarText = term.title_bar === false ? null : (term.title_bar || 'root@192.168.1.2');

  // Build the timed typing schedule — message lines only when chrome is baked
  const events = [];
  let cursor = 0;
  const addEvent = (kind, text, dimColor = false) => {
    if (!text) return;
    const dur = Math.max(0.15, text.length / charsPerSecond);
    events.push({ kind, text, start: cursor, end: cursor + dur, dimColor });
    cursor += dur + linePauseSeconds;
  };

  if (messageOnly) {
    // Only type the script message — chrome (header/boot/prompt) is baked statically
    for (const line of (term.lines || [])) {
      addEvent(line.kind || 'normal', line.text || '');
    }
  } else if (isWin95) {
    // Legacy win95: boot lines first, then prompt+first-line concatenated, then remaining lines
    for (const bl of (term.boot_lines || [])) addEvent('boot', bl);
    const linesArr = term.lines || [];
    if (term.prompt) {
      const first = linesArr[0]?.text || '';
      addEvent('prompt95', `${term.prompt} ${first}`.trim());
    }
    for (const line of linesArr.slice(1)) {
      addEvent('normal', line.text || '');
    }
  } else {
    // Legacy macOS: full chrome typing
    if (term.header) addEvent('header', term.header);
    if (term.subtitle) addEvent('subtitle', term.subtitle, true);
    if (term.cwd) addEvent('cwd', term.cwd, true);
    if (term.prompt) addEvent('prompt', `> ${term.prompt}`);
    for (const line of (term.lines || [])) {
      addEvent(line.kind || 'normal', line.text || '');
    }
  }

  // Compute current visible substring per event
  const renderEvents = events.map(e => {
    if (t < e.start) return { ...e, visible: '', active: false, complete: false };
    if (t >= e.end) return { ...e, visible: e.text, active: false, complete: true };
    const progress = (t - e.start) / (e.end - e.start);
    const charCount = Math.max(1, Math.floor(progress * e.text.length));
    return { ...e, visible: e.text.substring(0, charCount), active: true, complete: false };
  });

  // Cursor blink: visible during odd half-seconds
  const cursorOn = Math.floor(t * 2) % 2 === 0;

  // Layout constants — mirror render.py dimensions for visual parity
  const padInside = 28;

  const colorFor = (kind) => {
    switch (kind) {
      case 'success': return pal.text;
      case 'result': return pal.text;
      case 'task':
      case 'log':
      case 'gray': return pal.muted;
      default: return pal.text;
    }
  };

  return (
    <AbsoluteFill style={{ backgroundColor: pal.bg }}>
      {/* Static slide PNG as background */}
      {slide && (
        <Img
          src={slide}
          style={{ position: 'absolute', top: 0, left: 0, width: 1080, height: 1350 }}
        />
      )}

      {/* Message-only cover layer — chrome is baked into static slide, only
       *  the script message types here. Background matches static terminal bg
       *  exactly (term_bg_hex from zones.json) for seamless overlay. */}
      {messageOnly && (
        <div style={{
          position: 'absolute',
          left: zone.x, top: zone.y, width: zone.w, height: zone.h,
          backgroundColor: termBg,
          boxSizing: 'border-box',
          padding: '4px 24px',
          fontFamily: 'SpaceMono, monospace',
          color: isWin95 ? '#ffffff' : pal.text,
          fontSize: 22,
          lineHeight: '32px',
          overflow: 'hidden',
        }}>
          {renderEvents.map((e, i, arr) => {
            const isLast = i === arr.length - 1;
            const showCursor = (e.active || (isLast && e.complete && t < cursor + finalHoldSeconds)) && cursorOn;
            const isSuccess = e.kind === 'success';
            const isResult = e.kind === 'result';
            const indented = isSuccess || isResult;
            return (
              <div key={i} style={{
                position: 'relative',
                paddingLeft: indented ? 28 : 0,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'break-word',
              }}>
                {isSuccess && e.visible.length > 0 && (
                  <span style={{ position: 'absolute', left: 0, top: 5 }}>
                    <CheckGlyph color={SUCCESS_GREEN} size={14} />
                  </span>
                )}
                {isResult && e.visible.length > 0 && (
                  <span style={{ position: 'absolute', left: 0, top: 0, color: SUCCESS_GREEN }}>
                    →
                  </span>
                )}
                {e.visible}
                {showCursor ? (isWin95 ? '_' : '|') : ''}
              </div>
            );
          })}
        </div>
      )}

      {/* Legacy Win95 cover layer — black inner area, white space mono text, simple */}
      {!messageOnly && isWin95 && (
        <div style={{
          position: 'absolute',
          left: zone.x, top: zone.y, width: zone.w, height: zone.h,
          backgroundColor: '#000',
          boxSizing: 'border-box',
          padding: 18,
          fontFamily: 'SpaceMono, monospace',
          color: '#ffffff',
          fontSize: 26,
          lineHeight: '36px',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
        }}>
          {renderEvents.map((e, i, arr) => {
            const isLast = i === arr.length - 1;
            const showCursor = (e.active || (isLast && e.complete && t < cursor + finalHoldSeconds)) && cursorOn;
            const isPrompt95 = e.kind === 'prompt95';
            return (
              <div key={i} style={{
                fontWeight: isPrompt95 ? 'bold' : 'normal',
                marginBottom: e.kind === 'boot' && i === (term.boot_lines || []).length - 1 ? 12 : 0,
              }}>
                {e.visible}
                {showCursor ? '_' : ''}
              </div>
            );
          })}
        </div>
      )}

      {/* Legacy macOS cover layer (full chrome typing): paints over the static terminal contents */}
      {!messageOnly && !isWin95 && (
      <div
        style={{
          position: 'absolute',
          left: zone.x,
          top: zone.y,
          width: zone.w,
          height: zone.h,
          backgroundColor: termBg,
          borderRadius: 14,
          border: `1px solid ${pal.border}`,
          boxSizing: 'border-box',
          fontFamily: 'SpaceMono, monospace',
          color: pal.text,
          overflow: 'hidden',
        }}
      >
        {/* macOS title bar — 3 traffic dots + centered hostname + divider */}
        {titleBarText && (
          <div style={{
            position: 'relative',
            height: 52,
            borderBottom: `1px solid ${pal.border}`,
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
          }}>
            <div style={{ position: 'absolute', left: 22, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 8 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', backgroundColor: '#ff5f56' }} />
              <div style={{ width: 14, height: 14, borderRadius: '50%', backgroundColor: '#ffbd2e' }} />
              <div style={{ width: 14, height: 14, borderRadius: '50%', backgroundColor: '#27c93f' }} />
            </div>
            <div style={{ flex: 1, textAlign: 'center', fontSize: 20, color: pal.muted }}>
              {titleBarText}
            </div>
          </div>
        )}

        {/* Inner content area (padded) */}
        <div style={{ padding: padInside }}>

        {/* Header strip */}
        {term.header && (
          <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 4 }}>
            <div style={{
              width: 16, height: 16, marginTop: 6, marginRight: 12,
              backgroundColor: pal.accent, borderRadius: 4, flexShrink: 0,
            }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 26, fontWeight: 'bold', lineHeight: '36px', color: pal.text }}>
                {renderEvents.find(e => e.kind === 'header')?.visible || ''}
                {renderEvents.find(e => e.kind === 'header')?.active && cursorOn ? '|' : ''}
              </div>
              {term.subtitle && (
                <div style={{ fontSize: 20, lineHeight: '26px', color: pal.muted }}>
                  {renderEvents.find(e => e.kind === 'subtitle')?.visible || ''}
                  {renderEvents.find(e => e.kind === 'subtitle')?.active && cursorOn ? '|' : ''}
                </div>
              )}
              {term.cwd && (
                <div style={{ fontSize: 20, lineHeight: '26px', color: pal.muted }}>
                  {renderEvents.find(e => e.kind === 'cwd')?.visible || ''}
                  {renderEvents.find(e => e.kind === 'cwd')?.active && cursorOn ? '|' : ''}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Separator (only after header types in) */}
        {term.header && renderEvents.find(e => e.kind === (term.cwd ? 'cwd' : term.subtitle ? 'subtitle' : 'header'))?.complete && (
          <div style={{ height: 1, backgroundColor: pal.border, marginTop: 12, marginBottom: 16 }} />
        )}

        {/* Prompt + output lines.
         *  CSS word-wrap (overflowWrap + whiteSpace: pre-wrap) handles
         *  continuation lines so long output stays inside the terminal.
         *  Indicator (✓/→) is absolutely positioned so wrapped rows naturally
         *  indent under the text, matching render.py's static-slide layout. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          {renderEvents.filter(e => !['header', 'subtitle', 'cwd'].includes(e.kind)).map((e, i, arr) => {
            const isLast = i === arr.length - 1;
            const showCursor = (e.active || (isLast && e.complete && t < cursor + finalHoldSeconds)) && cursorOn;
            const lineColor = e.kind === 'prompt' ? pal.text : colorFor(e.kind);
            const isPrompt = e.kind === 'prompt';
            const isSuccess = e.kind === 'success';
            const isResult = e.kind === 'result';
            const indented = isSuccess || isResult;
            const fontSize = isPrompt ? 26 : 24;
            return (
              <div key={i} style={{
                position: 'relative',
                fontSize,
                lineHeight: '32px',
                fontWeight: isPrompt ? 'bold' : 'normal',
                color: lineColor,
                paddingLeft: indented ? 30 : 0,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'break-word',
                wordBreak: 'normal',
              }}>
                {isSuccess && e.visible.length > 0 && (
                  <span style={{ position: 'absolute', left: 0, top: 7 }}>
                    <CheckGlyph color={SUCCESS_GREEN} />
                  </span>
                )}
                {isResult && e.visible.length > 0 && (
                  <span style={{ position: 'absolute', left: 0, top: 0, color: SUCCESS_GREEN }}>
                    →
                  </span>
                )}
                {e.visible}
                {showCursor ? '|' : ''}
              </div>
            );
          })}
        </div>
        </div>
      </div>
      )}
    </AbsoluteFill>
  );
};

// ─── AudioVisualizer ────────────────────────────────────────────────────────
// Top-level Remotion composition for Suno (or any) audio → ASCII music viz.
// Brand-locked: every render gets the CRT + dither + phosphor-glow stack
// non-negotiably (operator can disable individual layers but defaults are on).
//
// Driven by @remotion/media-utils:
//   - getAudioData(src)  — fetches/decodes the audio once at mount
//   - visualizeAudio()   — returns frequency bins per frame
//
// Composition props:
//   audioUrl:  string   — absolute URL or staticFile() path to the mp3
//   style:     'mirror-columns' | 'pixel-city' | 'spectrum' | 'planet'
//   accent:    hex color — phosphor glow + ASCII fill (e.g. '#FF00FF' magenta brand)
//   bg:        hex color — CRT background (default '#000000')
//   chromaShift: boolean — chromatic aberration toggle (off by default)
//   numberOfSamples: number — FFT bin count (32/64/128). Default 64.
//
// Audio plays via <Audio> so the render output contains both viz + sound.

import React, { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  Audio,
  useCurrentFrame,
  useVideoConfig,
  delayRender,
  continueRender,
} from 'remotion';
import { getAudioData, visualizeAudio } from '@remotion/media-utils';
import {
  CrtFrame,
  CRT_PRESETS,
  MirrorDotColumns,
  PixelCity,
  AsciiSpectrum,
  PulsingAsciiPlanet,
} from '../audio-viz/index.js';
import { ensureFonts } from '../skyframe/_helpers.jsx';

export const AudioVisualizer = ({
  audioUrl,
  style = 'mirror-columns',
  accent,
  preset = 'white',         // 'white' | 'amber' | 'green' | 'magenta' | 'cyan'
  bg = '#000000',
  chromaShift = false,
  scanlines = true,
  dither = true,
  vignette = true,
  numberOfSamples = 64,
  smoothing = true,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Resolve accent: explicit `accent` prop wins, else use preset.
  const resolvedAccent = accent || CRT_PRESETS[preset]?.accent || CRT_PRESETS.white.accent;

  // Async load of audio data + fonts. Block render until both are ready.
  const [audioData, setAudioData] = useState(null);
  const [audioHandle] = useState(() => delayRender('Loading audio data'));
  const [fontHandle] = useState(() => delayRender('Loading fonts'));

  useEffect(() => {
    let cancelled = false;
    if (!audioUrl) {
      continueRender(audioHandle);
      return;
    }

    // getAudioData has NO built-in timeout. If the audio URL is unreachable
    // from inside the headless Chrome (404, CORS, DNS, decode error), the
    // promise can hang forever — delayRender never resolves, the whole
    // render is locked. 60s is generous for fast localhost mp3s, firm
    // enough to fail loud on broken URLs instead of silently hanging.
    const TIMEOUT_MS = 60_000;
    const timeoutHandle = setTimeout(() => {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.error(`[AudioVisualizer] getAudioData timed out after ${TIMEOUT_MS}ms (audioUrl: ${audioUrl}) — proceeding with blank viz`);
      continueRender(audioHandle);
    }, TIMEOUT_MS);

    getAudioData(audioUrl).then((data) => {
      if (cancelled) return;
      clearTimeout(timeoutHandle);
      setAudioData(data);
      continueRender(audioHandle);
    }).catch((err) => {
      if (cancelled) return;
      clearTimeout(timeoutHandle);
      // Audio fetch failed — render the viz blank so the file still produces
      // a usable artifact instead of hanging the render forever.
      // eslint-disable-next-line no-console
      console.error('[AudioVisualizer] getAudioData failed:', err.message);
      continueRender(audioHandle);
    });
    return () => {
      cancelled = true;
      clearTimeout(timeoutHandle);
    };
  }, [audioUrl, audioHandle]);

  useEffect(() => {
    ensureFonts().then(() => continueRender(fontHandle));
  }, [fontHandle]);

  // Per-frame frequency bins. Empty array until audioData lands.
  const bins = audioData
    ? Array.from(visualizeAudio({
        frame,
        audioData,
        fps,
        numberOfSamples,
        smoothing,
      }))
    : [];

  // Dispatch by style
  let viz = null;
  if (style === 'mirror-columns') {
    viz = <MirrorDotColumns bins={bins} accent={resolvedAccent} />;
  } else if (style === 'pixel-city') {
    viz = <PixelCity bins={bins} accent={resolvedAccent} />;
  } else if (style === 'spectrum') {
    viz = <AsciiSpectrum bins={bins} accent={resolvedAccent} />;
  } else if (style === 'planet') {
    viz = (
      <PulsingAsciiPlanet
        bins={bins}
        frame={frame}
        fps={fps}
        durationInFrames={durationInFrames}
        accent={resolvedAccent}
      />
    );
  }

  return (
    <AbsoluteFill>
      <CrtFrame
        bg={bg}
        chromaShift={chromaShift}
        scanlines={scanlines}
        dither={dither}
        vignette={vignette}
      >
        {viz}
      </CrtFrame>
      {audioUrl && <Audio src={audioUrl} />}
    </AbsoluteFill>
  );
};

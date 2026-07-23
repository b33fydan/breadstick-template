import React from 'react';
import {Composition} from 'remotion';
import {PhotoExperiment} from './compositions/PhotoExperiment';
import {Oracle16gami} from './compositions/Oracle16gami';
import {CarouselVideoSlide} from './compositions/CarouselVideoSlide';
import {TerminalCarouselSlide} from './compositions/TerminalCarouselSlide';
import {GamiBannerOverlay} from './compositions/GamiBannerOverlay';
import {CartesianGrid} from './compositions/CartesianGrid';
import {CartesianStage} from './compositions/CartesianStage';
import {ChromaCompositeMotion} from './compositions/ChromaCompositeMotion';
import {CartesianComposer} from './compositions/CartesianComposer';
import {PracticeOverlay007} from './compositions/PracticeOverlay007';
import {PracticeOverlay008} from './compositions/PracticeOverlay008';
import {PracticeOverlay009} from './compositions/PracticeOverlay009';
import {PracticeOverlay010} from './compositions/PracticeOverlay010';
import {PracticeOverlay011} from './compositions/PracticeOverlay011';
import {PracticeOverlay012} from './compositions/PracticeOverlay012';
import {PracticeOverlay013} from './compositions/PracticeOverlay013';
import {PracticeOverlay014} from './compositions/PracticeOverlay014';
import {SkyframeOverlay} from './compositions/SkyframeOverlay';
import {SkyframeSingleEffect} from './compositions/SkyframeSingleEffect';
import {AsciiPlanetShader} from './compositions/AsciiPlanetShader';
import {AudioVisualizer} from './compositions/AudioVisualizer';
import {AreciboTransmission, ARECIBO_FRAMES} from './compositions/AreciboTransmission';
import {
  VisualLabBake,
  DEFAULT_VISUAL_LAB_BAKE_PROPS,
  calculateVisualLabBakeMetadata,
} from './visual-lab/index.js';

const DEFAULTS = {
  durationInFrames: 300,
  fps: 30,
  width: 1920,
  height: 1080,
};

export const RemotionRoot = () => {
  return (
    <>
      <Composition id="PhotoExperiment" component={PhotoExperiment} {...DEFAULTS} />
      <Composition id="Oracle-16gami" component={Oracle16gami} durationInFrames={300} fps={30} width={1080} height={1920} />
      <Composition
        id="VisualLabBake"
        component={VisualLabBake}
        durationInFrames={180}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={DEFAULT_VISUAL_LAB_BAKE_PROPS}
        calculateMetadata={calculateVisualLabBakeMetadata}
      />
      <Composition
        id="CarouselVideoSlide"
        component={CarouselVideoSlide}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1350}
        defaultProps={{
          slidePath: 'carousel-video/slide_2_cutout.png',
          videoPath: 'carousel-video/paper_fold.mp4',
        }}
      />
      <Composition
        id="CartesianComposer"
        component={CartesianComposer}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          baseVideoPath: 'carousel-video/paper_fold.mp4',
          durationSec: 10,
          width: 1920,
          height: 1080,
          fps: 30,
          zones: [
            { id: 'demoText', type: 'text', x: 10, y: 10, w: 35, h: 12, startSec: 0, endSec: 4,
              contentText: 'CARTESIAN COMPOSER', contentColor: '#ffff00', contentBg: 'rgba(0,0,0,0.55)', contentFontSize: 56 },
            { id: 'demoBox',  type: 'text', x: 60, y: 70, w: 30, h: 18, startSec: 2, endSec: 8,
              contentText: 'timed @ 2-8s', contentColor: '#00ffff', contentBg: 'rgba(0,0,0,0.55)', contentFontSize: 40 },
          ],
        }}
        // Composition shape is driven by props at render time — server passes
        // durationSec/width/height/fps probed from the base video. Default
        // fallback (300 frames @ 1920x1080) only matters in Studio when nobody
        // overrides it.
        calculateMetadata={({ props }) => {
          const fps = Number(props.fps) || 30;
          const durationSec = Number(props.durationSec) || 10;
          return {
            durationInFrames: Math.max(1, Math.ceil(durationSec * fps)),
            fps,
            width: Number(props.width) || 1920,
            height: Number(props.height) || 1080,
          };
        }}
      />
      <Composition
        id="TerminalCarouselSlide"
        component={TerminalCarouselSlide}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1350}
        defaultProps={{
          slidePath: 'terminal-slides/sample_slide_1.png',
          terminalZone: { x: 80, y: 331, w: 920, h: 461 },
          terminal: {
            header: 'Claude Code v2.1.87',
            subtitle: 'Opus 4.6 (1M context) - Claude Max',
            cwd: '~/breadstick',
            prompt: '/loop 5m /babysit',
            lines: [
              { kind: 'success', text: 'Loop started - running every 5 minutes' },
              { kind: 'task', text: 'Task: Auto-address code review comments' },
              { kind: 'log', text: '[12:05] Checking PR #247...' },
              { kind: 'result', text: '2 comments addressed, 1 resolved' },
              { kind: 'log', text: '[12:10] Checking PR #247...' },
              { kind: 'result', text: 'Rebased on main, all tests passing' },
              { kind: 'success', text: 'No new comments. PR approved.' },
            ],
          },
          palette: {
            bg: '#111122', text: '#e8e8e8', muted: '#777799',
            accent: '#5588ff', border: '#2a2a44',
          },
        }}
      />
      <Composition
        id="CartesianGrid-Preview"
        component={CartesianGrid}
        durationInFrames={60}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{mirror: true, opacity: 1}}
      />
      <Composition
        id="CartesianGrid-Final"
        component={CartesianGrid}
        durationInFrames={60}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{mirror: false, opacity: 1}}
      />
      <Composition
        id="CartesianStage-Preview"
        component={CartesianStage}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{mirror: true, background: 'black', showLabels: true}}
      />
      <Composition
        id="CartesianStage-Final"
        component={CartesianStage}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{mirror: false, background: 'transparent', showLabels: false}}
      />
      <Composition
        id="CartesianCalibration"
        component={CartesianStage}
        durationInFrames={600}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          mirror: false,
          background: 'transparent',
          showLabels: false,
          shapes: [
            // Traced hand gesture — from paint.html
            {
              id: 'hand1', type: 'path',
              start: 0.00, end: 4.53,
              fadeIn: 0.15, fadeOut: 0.25,
              radius: 40, fill: '#00ffff', opacity: 0.6,
              showTrail: true,
              points: [
                {t: 0, x: 903, y: 669},
                {t: 0.7, x: 1029, y: 852},
                {t: 1.972, x: 1120, y: 848},
                {t: 3.047, x: 1311, y: 1070},
                {t: 4.029, x: 1262, y: 687},
              ],
            },
            // Outer border — canvas edge
            {id: 'outer', type: 'rect', x: 4, y: 4, w: 1912, h: 1072,
              fill: 'none', stroke: '#00ffff', strokeWidth: 8, opacity: 1,
              start: 0, end: 20, fadeIn: 0, fadeOut: 0},
            // Inner square — 50% from outer edge toward center (480, 270 to 1440, 810)
            {id: 'inner', type: 'rect', x: 480, y: 270, w: 960, h: 540,
              fill: 'none', stroke: '#ff66cc', strokeWidth: 8, opacity: 1,
              start: 0, end: 20, fadeIn: 0, fadeOut: 0},
            // Center crosshair
            {id: 'centerH', type: 'line', x1: 940, y1: 540, x2: 980, y2: 540,
              stroke: '#ffff00', strokeWidth: 3, opacity: 1, start: 0, end: 20, fadeIn: 0, fadeOut: 0},
            {id: 'centerV', type: 'line', x1: 960, y1: 520, x2: 960, y2: 560,
              stroke: '#ffff00', strokeWidth: 3, opacity: 1, start: 0, end: 20, fadeIn: 0, fadeOut: 0},
          ],
        }}
      />
      <Composition
        id="ChromaCompositeMotion"
        component={ChromaCompositeMotion}
        durationInFrames={240}
        fps={30}
        width={1080}
        height={1350}
        defaultProps={{
          backgroundPath: '',
          characterPath: '',
          motion: { entry: 'slide-right', exit: 'slide-left', entryDurationS: 0.8, exitDurationS: 0.8, holdScale: 1.0, holdX: 0, holdY: 0 },
          shadow: { enabled: true, blur: 30, offsetY: 20, opacity: 0.5 },
        }}
      />
      <Composition
        id="GamiBannerOverlay"
        component={GamiBannerOverlay}
        durationInFrames={1200}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          cues: [
            { text: 'PROMPT INJECTION', start: 1.1, end: 3.5, position: 'bottom', style: 'banner' },
            { text: 'MALICIOUS INSTRUCTIONS', start: 7.0, end: 10.5, position: 'bottom', style: 'banner' },
            { text: 'AI AGENT', start: 18.0, end: 21.0, position: 'bottom', style: 'callout' },
            { text: 'LEAK YOUR DATA', start: 22.0, end: 25.0, position: 'center', style: 'pill' },
          ],
        }}
        calculateMetadata={({ props }) => {
          const n = Number(props?.durationInFrames);
          return Number.isFinite(n) && n > 0 ? { durationInFrames: n } : {};
        }}
      />
      <Composition
        id="PracticeOverlay007"
        component={PracticeOverlay007}
        durationInFrames={1164}
        fps={24}
        width={1080}
        height={1920}
      />
      <Composition
        id="PracticeOverlay008"
        component={PracticeOverlay008}
        durationInFrames={1164}
        fps={24}
        width={1080}
        height={1920}
      />
      <Composition
        id="PracticeOverlay009"
        component={PracticeOverlay009}
        durationInFrames={1164}
        fps={24}
        width={1080}
        height={1920}
      />
      <Composition
        id="PracticeOverlay010"
        component={PracticeOverlay010}
        durationInFrames={1110}
        fps={30}
        width={1080}
        height={1920}
        calculateMetadata={({ props }) => {
          const n = Number(props?.durationInFrames);
          return Number.isFinite(n) && n > 0 ? { durationInFrames: n } : {};
        }}
      />
      <Composition
        id="PracticeOverlay011"
        component={PracticeOverlay011}
        durationInFrames={480}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="PracticeOverlay012"
        component={PracticeOverlay012}
        durationInFrames={1110}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="PracticeOverlay013"
        component={PracticeOverlay013}
        durationInFrames={930}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="PracticeOverlay014"
        component={PracticeOverlay014}
        durationInFrames={810}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="SkyframeOverlay"
        component={SkyframeOverlay}
        durationInFrames={1500}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          beats: [
            { type: 'RayBanIntro', startSec: 0, endSec: 3.0,
              props: { topWord: "You're", heroPhrase: 'BURNING THROUGH', midWord: 'your', pixelPhrase: 'CLOUD CODE', subtitle: 'context is bloated.' } },
            { type: 'KaraokeCard', startSec: 6, endSec: 12,
              props: { position: 'bottom-left', eyebrow: 'Tip 1 · Context', words: ['Keep','CLAUDE.md','under','40K','characters'], heroWord: 'CLAUDE.md' } },
            { type: 'OpusGlisten', startSec: 30, endSec: 33.5, props: { word: 'Opus' } },
          ],
          audioCues: { bubbles: [0, 180], whooshes: [], chime: 980 },
        }}
        calculateMetadata={({ props }) => {
          const n = Number(props?.durationInFrames);
          return Number.isFinite(n) && n > 0 ? { durationInFrames: n } : {};
        }}
      />
      <Composition
        id="SkyframeSingleEffect"
        component={SkyframeSingleEffect}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          effectType: 'RayBanIntro',
          props: {
            topWord: "You're",
            heroPhrase: 'BURNING THROUGH',
            midWord: 'your',
            pixelPhrase: 'CLOUD CODE',
            subtitle: 'context is bloated.',
          },
        }}
        calculateMetadata={({ props }) => {
          const n = Number(props?.durationInFrames);
          return Number.isFinite(n) && n > 0 ? { durationInFrames: n } : {};
        }}
      />
      <Composition
        id="AsciiPlanetShader"
        component={AsciiPlanetShader}
        durationInFrames={132}
        fps={24}
        width={1080}
        height={1920}
      />
      <Composition
        id="AreciboTransmission"
        component={AreciboTransmission}
        durationInFrames={ARECIBO_FRAMES}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          bits: [],
          sections: {
            counting: {rowStart: 0, rowEnd: 3}, elements: {rowStart: 5, rowEnd: 13},
            rhythm: {rowStart: 15, rowEnd: 24}, operator: {rowStart: 26, rowEnd: 33},
            instrument: {rowStart: 36, rowEnd: 40},
          },
          caption: 'awaiting transmission.',
          weekLabel: '',
          highlight: null,
        }}
      />
      <Composition
        id="AudioVisualizer"
        component={AudioVisualizer}
        durationInFrames={900}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          audioUrl: '',
          style: 'mirror-columns',
          preset: 'white',
          bg: '#000000',
          chromaShift: false,
          scanlines: true,
          dither: true,
          vignette: true,
          numberOfSamples: 64,
          smoothing: true,
        }}
        calculateMetadata={({ props }) => {
          const fps = Number(props.fps) || 30;
          const durationSec = Number(props.durationSec) || 30;
          return {
            durationInFrames: Math.max(30, Math.ceil(durationSec * fps)),
            fps,
            width: Number(props.width) || 1080,
            height: Number(props.height) || 1920,
          };
        }}
      />
    </>
  );
};

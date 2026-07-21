import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { CanvasCtx } from '../CanvasView.jsx';
import { createVisualStage } from '../../lib/visual-lab/createVisualStage.js';
import { interpolateCubeFlameParams } from '../../lib/visual-lab/presets/cubeFlame.js';
import {
  DEFAULT_VISUAL_PARAMS,
  createVisualParamsPacket,
  createVisualScene,
  normalizeVisualParams,
  validateVisualScene,
} from './contracts.js';
import { resolveVisualInputs } from './resolveVisualInputs.js';

const FIELD_ACCENT = '#ff2f8f';
const CONTROL_ACCENT = '#ffb000';
const BAKE_ACCENT = '#71f5ff';
const DEFAULT_SEED = 4317;

const RESOLUTIONS = [
  { id: 'portrait', label: '1080 × 1920', width: 1080, height: 1920 },
  { id: 'landscape', label: '1920 × 1080', width: 1920, height: 1080 },
  { id: 'square', label: '1080 × 1080', width: 1080, height: 1080 },
];

const ASPECTS = {
  '16:9': '16 / 9',
  '9:16': '9 / 16',
  '1:1': '1 / 1',
};

function stopGraphGesture(e) {
  e.stopPropagation();
}

function setAtPath(source, path, value) {
  const parts = path.split('.');
  const next = { ...source };
  let cursor = next;
  let current = source;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    cursor[part] = { ...(current?.[part] || {}) };
    cursor = cursor[part];
    current = current?.[part];
  }
  cursor[parts.at(-1)] = value;
  return next;
}

function DeleteButton({ nodeId }) {
  const { onDeleteNode } = useContext(CanvasCtx);
  return (
    <button
      type="button"
      className="cv-vlab-delete nodrag"
      onPointerDown={stopGraphGesture}
      onClick={(e) => {
        e.stopPropagation();
        onDeleteNode?.(nodeId);
      }}
      title="Delete node"
    >
      ×
    </button>
  );
}

function RangeControl({ label, value, min, max, step, onChange, unit = '', digits = 2 }) {
  const numeric = Number(value);
  const display = Number.isInteger(step)
    ? String(Math.round(numeric))
    : numeric.toFixed(digits);

  return (
    <label className="cv-vlab-control-row nodrag" onPointerDown={stopGraphGesture}>
      <span className="cv-vlab-control-label">{label}</span>
      <span className="cv-vlab-control-value">{display}{unit}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={numeric}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={stopGraphGesture}
        onClick={stopGraphGesture}
        onWheel={stopGraphGesture}
        className="cv-vlab-slider nodrag nowheel"
      />
    </label>
  );
}

function ColorControl({ label, value, onChange }) {
  return (
    <label className="cv-vlab-color-control nodrag" onPointerDown={stopGraphGesture}>
      <span>{label}</span>
      <span className="cv-vlab-color-chip" style={{ '--chip-color': value }}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPointerDown={stopGraphGesture}
          onClick={stopGraphGesture}
          className="nodrag"
        />
      </span>
      <code>{value.toUpperCase()}</code>
    </label>
  );
}

function Section({ title, badge, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`cv-vlab-section ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="cv-vlab-section-toggle nodrag"
        onPointerDown={stopGraphGesture}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <span>{open ? '−' : '+'}</span>
        <strong>{title}</strong>
        {badge && <em>{badge}</em>}
      </button>
      {open && <div className="cv-vlab-section-body">{children}</div>}
    </section>
  );
}

export function VisualControlsNode({ id, data }) {
  const { setChunkOutput, syncNodeData } = useContext(CanvasCtx);
  const [params, setParams] = useState(() => normalizeVisualParams(data?.params || DEFAULT_VISUAL_PARAMS));
  const publishFrameRef = useRef(null);
  const pendingRef = useRef(null);

  const publish = useCallback((next) => {
    const packet = createVisualParamsPacket(next);
    syncNodeData?.(id, { params: next, packet });
    setChunkOutput?.(id, packet);
  }, [id, setChunkOutput, syncNodeData]);

  const queuePublish = useCallback((next) => {
    pendingRef.current = next;
    if (publishFrameRef.current !== null) return;
    publishFrameRef.current = requestAnimationFrame(() => {
      publishFrameRef.current = null;
      const queued = pendingRef.current;
      pendingRef.current = null;
      if (queued) publish(queued);
    });
  }, [publish]);

  const flushPending = useCallback(() => {
    if (publishFrameRef.current !== null) {
      cancelAnimationFrame(publishFrameRef.current);
      publishFrameRef.current = null;
    }
    const queued = pendingRef.current;
    pendingRef.current = null;
    if (queued) publish(queued);
  }, [publish]);

  useEffect(() => () => {
    if (publishFrameRef.current !== null) cancelAnimationFrame(publishFrameRef.current);
  }, []);

  const change = (path, value) => {
    setParams((current) => {
      const next = normalizeVisualParams(setAtPath(current, path, value));
      queuePublish(next);
      return next;
    });
  };

  const changeColor = (index, value) => {
    const colors = [...params.material.colors];
    colors[index] = value;
    change('material.colors', colors);
  };

  const reset = () => {
    const next = normalizeVisualParams(DEFAULT_VISUAL_PARAMS);
    if (publishFrameRef.current !== null) cancelAnimationFrame(publishFrameRef.current);
    publishFrameRef.current = null;
    pendingRef.current = null;
    setParams(next);
    publish(next);
  };

  const dither = params.post.dither;

  return (
    <div
      className="cv-node cv-vlab-node cv-vlab-controls"
      style={{ '--vlab-accent': CONTROL_ACCENT }}
      onPointerUpCapture={flushPending}
    >
      <DeleteButton nodeId={id} />
      <div className="cv-vlab-node-header">
        <span className="cv-vlab-header-glyph">⌁</span>
        <div>
          <strong>Field Controls</strong>
          <span>LIVE PARAMETER BUS</span>
        </div>
        <i className="cv-vlab-live-dot" title="Publishes live settings" />
      </div>

      <div className="cv-vlab-signal-line">
        <span>visual-params@1</span>
        <span>{params.emission.count} cubes</span>
      </div>

      <Section title="Emission" badge="FORM">
        <RangeControl label="Intensity" value={params.emission.intensity} min={0} max={2} step={0.01} onChange={(v) => change('emission.intensity', v)} />
        <RangeControl label="Cube count" value={params.emission.count} min={64} max={1200} step={1} digits={0} onChange={(v) => change('emission.count', v)} />
        <RangeControl label="Spread" value={params.emission.spread} min={0.1} max={2} step={0.01} onChange={(v) => change('emission.spread', v)} />
        <RangeControl label="Cube size" value={params.emission.cubeSize} min={0.01} max={0.18} step={0.001} digits={3} onChange={(v) => change('emission.cubeSize', v)} />
      </Section>

      <Section title="Motion" badge="FLOW">
        <RangeControl label="Rise speed" value={params.motion.riseSpeed} min={0} max={2.5} step={0.01} onChange={(v) => change('motion.riseSpeed', v)} />
        <RangeControl label="Turbulence" value={params.motion.turbulence} min={0} max={2} step={0.01} onChange={(v) => change('motion.turbulence', v)} />
        <RangeControl label="Swirl" value={params.motion.swirl} min={-2} max={2} step={0.01} onChange={(v) => change('motion.swirl', v)} />
        <RangeControl label="Flicker" value={params.motion.flicker} min={0} max={1} step={0.01} onChange={(v) => change('motion.flicker', v)} />
      </Section>

      <Section title="Material" badge="HOLO" defaultOpen={false}>
        <RangeControl label="Opacity" value={params.material.opacity} min={0.05} max={1} step={0.01} onChange={(v) => change('material.opacity', v)} />
        <RangeControl label="Bloom" value={params.material.bloom} min={0} max={1.5} step={0.01} onChange={(v) => change('material.bloom', v)} />
        <RangeControl label="Holo shift" value={params.material.holoShift} min={0} max={1} step={0.01} onChange={(v) => change('material.holoShift', v)} />
        <div className="cv-vlab-color-grid">
          {params.material.colors.map((color, index) => (
            <ColorControl key={index} label={String.fromCharCode(65 + index)} value={color} onChange={(v) => changeColor(index, v)} />
          ))}
        </div>
      </Section>

      <Section title="Dither" badge={dither.enabled ? 'ON' : 'OFF'}>
        <label className="cv-vlab-switch-row nodrag" onPointerDown={stopGraphGesture}>
          <span>Enable pass</span>
          <button
            type="button"
            className={`cv-vlab-switch ${dither.enabled ? 'is-on' : ''}`}
            onPointerDown={stopGraphGesture}
            onClick={(e) => {
              e.stopPropagation();
              change('post.dither.enabled', !dither.enabled);
            }}
          ><span /></button>
        </label>
        <label className="cv-vlab-select-row nodrag" onPointerDown={stopGraphGesture}>
          <span>Pattern</span>
          <select value={dither.mode} onChange={(e) => change('post.dither.mode', e.target.value)} onPointerDown={stopGraphGesture}>
            <option value="bayer4">Bayer 4</option>
            <option value="bayer8">Bayer 8</option>
            <option value="noise">Noise</option>
          </select>
        </label>
        <RangeControl label="Amount" value={dither.amount} min={0} max={1} step={0.01} onChange={(v) => change('post.dither.amount', v)} />
        <RangeControl label="Pixel scale" value={dither.pixelScale} min={1} max={8} step={1} digits={0} onChange={(v) => change('post.dither.pixelScale', v)} />
        <RangeControl label="Posterize" value={dither.posterize} min={2} max={32} step={1} digits={0} onChange={(v) => change('post.dither.posterize', v)} />
      </Section>

      <button type="button" className="cv-vlab-reset nodrag" onPointerDown={stopGraphGesture} onClick={(e) => { e.stopPropagation(); reset(); }}>
        Reset instrument
      </button>

      <div className="cv-vlab-port-label cv-vlab-port-label-right">PARAMS</div>
      <Handle type="source" position={Position.Right} id="params-out" className="cv-vlab-handle cv-vlab-handle-control" />
    </div>
  );
}

export function VisualFieldNode({ id, data }) {
  const { edges, nodeOutputs, nodes, syncNodeData } = useContext(CanvasCtx);
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const paramsRef = useRef(DEFAULT_VISUAL_PARAMS);
  const playingRef = useRef(true);
  const disconnectFrameRef = useRef(null);
  const wasConnectedRef = useRef(false);
  const lastResolvedParamsRef = useRef(DEFAULT_VISUAL_PARAMS);

  const [playing, setPlaying] = useState(data?.playing !== false);
  const [seed, setSeed] = useState(() => Number(data?.seed) || DEFAULT_SEED);
  const [quality, setQuality] = useState(data?.quality || 'live');
  const [backgroundMode, setBackgroundMode] = useState(data?.backgroundMode || 'transparent');
  const [aspect, setAspect] = useState(data?.aspect || '16:9');
  const [stats, setStats] = useState({ fps: 0, visibleCount: 0 });
  const [stageError, setStageError] = useState('');
  const initialStageSettingsRef = useRef({ seed, quality, backgroundMode });

  const localParams = normalizeVisualParams(data?.params || DEFAULT_VISUAL_PARAMS);
  const resolved = resolveVisualInputs({
    targetId: id,
    edges,
    nodeOutputs,
    nodes,
    localParams,
  });
  useLayoutEffect(() => {
    playingRef.current = playing;
    const wasConnected = wasConnectedRef.current;

    if (resolved.connected) {
      if (disconnectFrameRef.current !== null) cancelAnimationFrame(disconnectFrameRef.current);
      disconnectFrameRef.current = null;
      paramsRef.current = resolved.params;
      lastResolvedParamsRef.current = resolved.params;
    } else if (wasConnected) {
      if (disconnectFrameRef.current !== null) cancelAnimationFrame(disconnectFrameRef.current);
      const from = lastResolvedParamsRef.current;
      const to = resolved.params;
      const startedAt = performance.now();
      const animateReturn = (timestamp) => {
        const progress = Math.min(1, (timestamp - startedAt) / 180);
        const next = interpolateCubeFlameParams(from, to, progress);
        paramsRef.current = next;
        lastResolvedParamsRef.current = next;
        if (progress < 1) disconnectFrameRef.current = requestAnimationFrame(animateReturn);
        else disconnectFrameRef.current = null;
      };
      disconnectFrameRef.current = requestAnimationFrame(animateReturn);
    } else if (disconnectFrameRef.current === null) {
      paramsRef.current = resolved.params;
      lastResolvedParamsRef.current = resolved.params;
    }

    wasConnectedRef.current = resolved.connected;
  }, [playing, resolved.connected, resolved.params]);

  useEffect(() => () => {
    if (disconnectFrameRef.current !== null) cancelAnimationFrame(disconnectFrameRef.current);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let disposed = false;

    try {
      const initial = initialStageSettingsRef.current;
      const stage = createVisualStage({
        container: containerRef.current,
        paramsRef,
        seed: initial.seed,
        backgroundMode: initial.backgroundMode,
        quality: initial.quality,
        onStats: (next) => {
          if (!disposed) setStats(next);
        },
      });
      stageRef.current = stage;
      if (playingRef.current) stage.start();

      return () => {
        disposed = true;
        stage.dispose();
        stageRef.current = null;
      };
    } catch (error) {
      const message = error?.message || String(error);
      const errorFrame = requestAnimationFrame(() => {
        if (!disposed) setStageError(message);
      });
      return () => {
        disposed = true;
        cancelAnimationFrame(errorFrame);
      };
    }
  }, []); // WebGL mount/dispose only. Live parameters flow through paramsRef.

  const updateStored = (patch) => syncNodeData?.(id, patch);

  const togglePlaying = () => {
    const next = !playingRef.current;
    playingRef.current = next;
    setPlaying(next);
    updateStored({ playing: next });
    if (next) stageRef.current?.start();
    else stageRef.current?.pause();
  };

  const randomizeSeed = () => {
    const next = Math.floor(1000 + Math.random() * 8999);
    setSeed(next);
    updateStored({ seed: next });
    stageRef.current?.setSeed(next);
    stageRef.current?.restart();
  };

  const changeQuality = (next) => {
    setQuality(next);
    updateStored({ quality: next });
    stageRef.current?.setQuality(next);
  };

  const changeBackground = (next) => {
    setBackgroundMode(next);
    updateStored({ backgroundMode: next });
    stageRef.current?.setBackground(next);
  };

  const changeAspect = (next) => {
    setAspect(next);
    updateStored({ aspect: next });
    requestAnimationFrame(() => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      stageRef.current?.resize(rect.width, rect.height);
    });
  };

  const status = stageError ? 'FALLBACK' : resolved.connected ? 'WIRED' : playing ? 'LIVE' : 'PAUSED';

  return (
    <div className="cv-node cv-vlab-node cv-vlab-field" style={{ '--vlab-accent': FIELD_ACCENT }}>
      <DeleteButton nodeId={id} />
      <Handle type="target" position={Position.Left} id="params-in" className="cv-vlab-handle cv-vlab-handle-field-in" />
      <div className="cv-vlab-port-label cv-vlab-port-label-left">PARAMS</div>

      <div className="cv-vlab-node-header cv-vlab-field-header">
        <span className="cv-vlab-header-glyph cv-vlab-cube-glyph">◇</span>
        <div>
          <strong>Cube Flame Field</strong>
          <span>HOLOGRAPHIC INSTANCED FIELD</span>
        </div>
        <div className="cv-vlab-status-cluster">
          {stats.fps > 0 && <span className="cv-vlab-fps">{Math.round(stats.fps)} FPS</span>}
          <span className={`cv-vlab-status is-${status.toLowerCase()}`}>{status}</span>
        </div>
      </div>

      <div className="cv-vlab-preview-shell" style={{ aspectRatio: ASPECTS[aspect] || ASPECTS['16:9'] }}>
        <div className="cv-vlab-preview-grid" />
        <div ref={containerRef} className="cv-vlab-preview nodrag nowheel" onPointerDown={stopGraphGesture} />
        {stageError && (
          <div className="cv-vlab-preview-fallback">
            <strong>WEBGL FALLBACK</strong>
            <span>{stageError}</span>
          </div>
        )}
        <div className="cv-vlab-preview-vignette" />
        <div className="cv-vlab-preview-caption">
          <span>SEED {seed}</span>
          <span>{resolved.connected ? `CONTROLLED BY ${resolved.sourceId}` : 'LOCAL PRESET'}</span>
          <span>{stats.activeCount || resolved.params.emission.count} INSTANCES</span>
        </div>
      </div>

      {(resolved.error || stageError) && (
        <div className="cv-vlab-inline-error">{resolved.error || stageError}</div>
      )}

      <div className="cv-vlab-transport nodrag" onPointerDown={stopGraphGesture}>
        <button type="button" className="cv-vlab-play" onClick={(e) => { e.stopPropagation(); togglePlaying(); }}>
          {playing ? 'Ⅱ' : '▶'}
        </button>
        <button type="button" onClick={(e) => { e.stopPropagation(); stageRef.current?.restart(); }}>↺ Restart</button>
        <button type="button" onClick={(e) => { e.stopPropagation(); randomizeSeed(); }}>✦ Seed</button>
        <span className="cv-vlab-transport-spacer" />
        <select value={quality} onChange={(e) => changeQuality(e.target.value)} onPointerDown={stopGraphGesture} title="Preview quality">
          <option value="eco">Eco</option>
          <option value="live">Live</option>
          <option value="high">High</option>
        </select>
        <select value={backgroundMode} onChange={(e) => changeBackground(e.target.value)} onPointerDown={stopGraphGesture} title="Preview background">
          <option value="transparent">Transparent</option>
          <option value="black">Black</option>
          <option value="breadstick">Breadstick</option>
        </select>
        <select value={aspect} onChange={(e) => changeAspect(e.target.value)} onPointerDown={stopGraphGesture} title="Preview aspect">
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
          <option value="1:1">1:1</option>
        </select>
      </div>

      <div className="cv-vlab-field-readout">
        <span><i style={{ '--readout-color': resolved.params.material.colors[0] }} /> BASE</span>
        <span><i style={{ '--readout-color': resolved.params.material.colors[1] }} /> BODY</span>
        <span><i style={{ '--readout-color': resolved.params.material.colors[2] }} /> TIP</span>
        <strong>{resolved.params.post.dither.enabled ? `${resolved.params.post.dither.mode.toUpperCase()} DITHER` : 'CLEAN OUTPUT'}</strong>
      </div>

      <div className="cv-vlab-port-label cv-vlab-port-label-right">SCENE</div>
      <Handle type="source" position={Position.Right} id="scene-out" className="cv-vlab-handle cv-vlab-handle-field-out" />
    </div>
  );
}

function resolveSceneForBake({ bakeId, edges, nodes, nodeOutputs }) {
  const edge = (edges || []).find((item) => item.target === bakeId && item.targetHandle === 'scene-in')
    || (edges || []).find((item) => item.target === bakeId);
  if (!edge) return { scene: null, sourceId: '', error: 'Wire a Cube Flame Field into SCENE.' };

  const sourceId = edge.source;
  const sourceNode = (nodes || []).find((item) => item.id === sourceId);
  if (!sourceNode || sourceNode.type !== 'visual-field') {
    return { scene: null, sourceId, error: 'SCENE accepts a Cube Flame Field.' };
  }

  const published = nodeOutputs?.[sourceId];
  if (published?.type === 'visual-scene') {
    const checked = validateVisualScene(published);
    if (checked.ok) return { scene: checked.value, sourceId, error: '' };
    return { scene: null, sourceId, error: checked.error };
  }

  const resolved = resolveVisualInputs({
    targetId: sourceId,
    edges,
    nodeOutputs,
    nodes,
    localParams: sourceNode.data?.params || DEFAULT_VISUAL_PARAMS,
  });

  try {
    const scene = createVisualScene({
      preset: 'cube-flame',
      seed: Number(sourceNode.data?.seed) || DEFAULT_SEED,
      loopDurationSec: Number(sourceNode.data?.loopDurationSec) || 6,
      background: {
        mode: sourceNode.data?.backgroundMode || 'transparent',
        color: sourceNode.data?.backgroundColor || '#000000',
      },
      params: resolved.params,
    });
    return { scene, sourceId, error: resolved.error || '' };
  } catch (error) {
    return { scene: null, sourceId, error: error?.message || String(error) };
  }
}

export function VisualBakeNode({ id, data }) {
  const { edges, nodeOutputs, nodes, mutateNodeOutput, syncNodeData } = useContext(CanvasCtx);
  const [durationSec, setDurationSec] = useState(Number(data?.durationSec) || 6);
  const [fps, setFps] = useState(Number(data?.fps) || 30);
  const [resolutionId, setResolutionId] = useState(data?.resolutionId || 'portrait');
  const [output, setOutput] = useState(data?.output || 'webm-alpha');
  const [quality, setQuality] = useState(data?.bakeQuality || 'production');
  const [copied, setCopied] = useState(false);

  const resolvedScene = resolveSceneForBake({ bakeId: id, edges, nodes, nodeOutputs });
  const resolution = RESOLUTIONS.find((item) => item.id === resolutionId) || RESOLUTIONS[0];
  const result = nodeOutputs?.[id] || {};
  const status = result.status || 'idle';
  const busy = ['queued', 'rendering', 'encoding'].includes(status);
  const asset = Array.isArray(result.assets) ? result.assets[0] : null;
  const url = asset?.url || result.url || '';

  const storeSetting = (patch) => syncNodeData?.(id, patch);

  const bake = async () => {
    if (!resolvedScene.scene || busy) return;
    mutateNodeOutput?.(id, (current) => ({ ...current, status: 'queued', error: '', assets: [] }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15 * 60 * 1000);
    try {
      mutateNodeOutput?.(id, (current) => ({ ...current, status: 'rendering' }));
      const response = await fetch('http://localhost:3001/api/visual-lab/bake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene: resolvedScene.scene,
          durationSec,
          fps,
          width: resolution.width,
          height: resolution.height,
          output,
          quality,
        }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || `Bake failed (${response.status})`);
      const nextAsset = {
        id: `visual-lab-${payload.cacheKey}`,
        label: 'Cube Flame Field',
        type: output === 'webm-alpha' ? 'hyperframes' : 'video',
        url: payload.url,
        width: payload.width,
        height: payload.height,
        durationSec: payload.durationSec,
        fps: payload.fps,
        alpha: output === 'webm-alpha',
        loop: true,
        sourceSpec: 'visual-scene@1',
      };
      mutateNodeOutput?.(id, (current) => ({
        ...current,
        type: 'asset-sequence',
        status: 'done',
        url: payload.url,
        assets: [nextAsset],
        cached: payload.cached,
        cacheKey: payload.cacheKey,
        error: '',
      }));
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'Bake timed out after 15 minutes.' : (error?.message || String(error));
      mutateNodeOutput?.(id, (current) => ({ ...current, status: 'error', error: message, assets: [] }));
    } finally {
      clearTimeout(timeout);
    }
  };

  const copyUrl = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="cv-node cv-vlab-node cv-vlab-bake" style={{ '--vlab-accent': BAKE_ACCENT }}>
      <DeleteButton nodeId={id} />
      <Handle type="target" position={Position.Left} id="scene-in" className="cv-vlab-handle cv-vlab-handle-bake-in" />
      <div className="cv-vlab-port-label cv-vlab-port-label-left">SCENE</div>

      <div className="cv-vlab-node-header">
        <span className="cv-vlab-header-glyph">▧</span>
        <div>
          <strong>Visual Bake</strong>
          <span>DETERMINISTIC RECORDER</span>
        </div>
        <span className={`cv-vlab-status is-${status}`}>{status.toUpperCase()}</span>
      </div>

      <div className={`cv-vlab-bake-source ${resolvedScene.scene ? 'is-ready' : ''}`}>
        <span className="cv-vlab-bake-source-dot" />
        <div>
          <strong>{resolvedScene.scene ? 'Cube Flame Field ready' : 'No visual scene'}</strong>
          <span>{resolvedScene.scene ? `seed ${resolvedScene.scene.seed} · ${resolvedScene.sourceId}` : resolvedScene.error}</span>
        </div>
      </div>

      <div className="cv-vlab-bake-grid nodrag" onPointerDown={stopGraphGesture}>
        <label>
          <span>Duration</span>
          <select value={durationSec} onChange={(e) => { const value = Number(e.target.value); setDurationSec(value); storeSetting({ durationSec: value }); }}>
            {[3, 5, 6, 8, 10].map((value) => <option key={value} value={value}>{value} seconds</option>)}
          </select>
        </label>
        <label>
          <span>Frame rate</span>
          <select value={fps} onChange={(e) => { const value = Number(e.target.value); setFps(value); storeSetting({ fps: value }); }}>
            <option value={30}>30 FPS</option>
            <option value={60}>60 FPS</option>
          </select>
        </label>
        <label>
          <span>Resolution</span>
          <select value={resolutionId} onChange={(e) => { setResolutionId(e.target.value); storeSetting({ resolutionId: e.target.value }); }}>
            {RESOLUTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label>
          <span>Output</span>
          <select value={output} onChange={(e) => { setOutput(e.target.value); storeSetting({ output: e.target.value }); }}>
            <option value="webm-alpha">Transparent WebM</option>
            <option value="mp4-matte">Matted MP4</option>
          </select>
        </label>
        <label className="cv-vlab-bake-quality">
          <span>Quality</span>
          <select value={quality} onChange={(e) => { setQuality(e.target.value); storeSetting({ bakeQuality: e.target.value }); }}>
            <option value="draft">Draft</option>
            <option value="production">Production</option>
          </select>
        </label>
      </div>

      <button
        type="button"
        className="cv-vlab-bake-button nodrag"
        disabled={!resolvedScene.scene || busy}
        onPointerDown={stopGraphGesture}
        onClick={(e) => { e.stopPropagation(); bake(); }}
      >
        <span>{busy ? '◌' : '✦'}</span>
        {busy ? `${status}…` : url ? 'Bake again' : 'Bake visual'}
      </button>

      {result.error && <div className="cv-vlab-inline-error">{result.error}</div>}

      {url && (
        <div className="cv-vlab-bake-output">
          <video src={`http://localhost:3001${url}`} autoPlay loop muted playsInline controls={false} />
          <div>
            <span>{result.cached ? 'CACHE HIT' : 'FRESH BAKE'}</span>
            <strong>{resolution.width}×{resolution.height} · {durationSec}s</strong>
            <button type="button" className="nodrag" onPointerDown={stopGraphGesture} onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
              {copied ? 'Copied' : 'Copy URL'}
            </button>
          </div>
        </div>
      )}

      <div className="cv-vlab-port-label cv-vlab-port-label-right">ASSET</div>
      <Handle type="source" position={Position.Right} id="sequence-out" className="cv-vlab-handle cv-vlab-handle-bake-out" />
    </div>
  );
}

import { useContext, useEffect, useRef, useState, useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';
import { CanvasCtx } from './CanvasView.jsx';
import { createHandTracker } from '../lib/handTracker.js';
import { createFaceTracker } from '../lib/faceTracker.js';
import { createConceptStage } from '../lib/conceptStage.js';
import { createConceptRecorder } from '../lib/conceptRecorder.js';
import { recognize } from '../lib/gestureRecognizer.js';
import { attachWebcam, attachFile } from '../lib/videoSource.js';

const NODE_ACCENT = '#06b6d4';

// Operator-forced output aspect → stage dimensions. 'native' returns the source
// dimensions unchanged. '16:9' and '9:16' force a fixed resolution suitable for
// shortform recording (props re-mount with matching world mapping).
function resolveStageDimensions(aspectMode, nativeW, nativeH) {
  if (aspectMode === '16:9') return { w: 1280, h: 720 };
  if (aspectMode === '9:16') return { w: 720, h: 1280 };
  return { w: nativeW, h: nativeH };
}

export default function ConceptComposerNode({ id, data }) {
  const { onDeleteNode } = useContext(CanvasCtx);
  const videoRef = useRef(null);
  const stageContainerRef = useRef(null);
  const trackerRef = useRef(null);
  const faceTrackerRef = useRef(null);
  const stageRef = useRef(null);
  const recorderRef = useRef(null);
  const elapsedRafRef = useRef(null);
  // sourceRef holds the active video source's dispose() + .stream. Lives
  // outside React state because the trackers' onFrame closures read it and
  // we don't want stale-closure rerenders.
  const sourceRef = useRef(null);
  const fileInputRef = useRef(null);

  const [trackerStatus, setTrackerStatus] = useState('idle'); // idle | starting | running | error
  const [errorMsg, setErrorMsg] = useState(null);
  const [debugOverlayOn, setDebugOverlayOn] = useState(true);
  const [trailMode, setTrailMode] = useState('glow');
  const [renderShape, setRenderShape] = useState('dots');
  const [crossHandLineOn, setCrossHandLineOn] = useState(false);
  const [faceTrackingOn, setFaceTrackingOn] = useState(false);
  const [faceGlowOn, setFaceGlowOn] = useState(false);
  const [recordingState, setRecordingState] = useState('idle'); // idle | recording | uploading
  const [elapsedSec, setElapsedSec] = useState(0);
  const [savedUrl, setSavedUrl] = useState(null);
  const [lastGesture, setLastGesture] = useState({ gesture: 'idle' });
  // Active prop — drives which glyph the stage mounts. The stage tracks
  // activePropName internally, so the onFrame closure pulls the latest
  // value from the stage instead of closing over stale React state.
  const [selectedProp, setSelectedProp] = useState('preview');
  // Video source mode — 'webcam' uses getUserMedia, 'file' plays a chosen
  // local clip. Both feed the same trackers + stage; only the source factory
  // and the mirror/flipX flags differ.
  const [source, setSource] = useState('webcam');
  const [selectedFile, setSelectedFile] = useState(null);
  // Container aspect ratio — driven by the active source's native dimensions
  // so vertical/horizontal/square clips display at their real proportions.
  const [stageAspect, setStageAspect] = useState('16 / 9');
  // Operator-forced output aspect for shortform recording. When set, overrides
  // the source's native dimensions so a 16:9 webcam feed renders into a 9:16
  // stage (or vice versa). 'native' = follow source.
  const [aspectMode, setAspectMode] = useState('native');

  // Initialize stage on mount
  useEffect(() => {
    if (!stageContainerRef.current) return;
    stageRef.current = createConceptStage({ container: stageContainerRef.current });
    return () => {
      if (elapsedRafRef.current) cancelAnimationFrame(elapsedRafRef.current);
      if (recorderRef.current) {
        try { recorderRef.current.stop(); } catch { /* recorder may not be in 'recording' state */ }
        recorderRef.current = null;
      }
      if (stageRef.current) stageRef.current.dispose();
      if (faceTrackerRef.current) faceTrackerRef.current.stop();
      if (trackerRef.current) trackerRef.current.stop();
      if (sourceRef.current) {
        sourceRef.current.dispose();
        sourceRef.current = null;
      }
    };
  }, []);

  // Face tracker lifecycle — runs only when the hand tracker is live AND the
  // face toggle is on. faceTracker shares the videoEl/stream that handTracker
  // owns; it must come up AFTER hand tracker has the camera open, and come
  // down BEFORE the stream is closed. Watching both state values keeps the
  // two trackers in lockstep without cross-callbacks.
  useEffect(() => {
    const shouldRun = trackerStatus === 'running' && faceTrackingOn;
    if (shouldRun && !faceTrackerRef.current) {
      let cancelled = false;
      (async () => {
        try {
          const face = createFaceTracker({
            videoEl: videoRef.current,
            flipX: source === 'webcam',  // match handTracker's flip choice
            onFrame: (faceLandmarks) => {
              if (cancelled) return;
              if (stageRef.current) stageRef.current.updateLandmarks(faceLandmarks);
            },
            onError: (err) => setErrorMsg(`face: ${err.message}`),
          });
          await face.start();
          if (cancelled) {
            face.stop();
            return;
          }
          faceTrackerRef.current = face;
        } catch (err) {
          if (!cancelled) setErrorMsg(`face: ${err.message}`);
        }
      })();
      return () => { cancelled = true; };
    }
    if (!shouldRun && faceTrackerRef.current) {
      faceTrackerRef.current.stop();
      faceTrackerRef.current = null;
      // Clear stale face landmarks from the stage so they don't keep drawing
      // after the tracker is stopped.
      if (stageRef.current) stageRef.current.updateLandmarks({ face: null });
    }
  }, [trackerStatus, faceTrackingOn, source]);

  // Sync the active prop with the stage whenever the operator picks a
  // different glyph. The stage handles dispose-then-mount internally.
  useEffect(() => {
    if (stageRef.current) {
      stageRef.current.setProp(selectedProp);
    }
  }, [selectedProp]);

  const handleStart = useCallback(async () => {
    if (trackerStatus === 'running' || trackerStatus === 'starting') return;
    if (source === 'file' && !selectedFile) {
      setErrorMsg('Pick a video file first.');
      return;
    }
    setTrackerStatus('starting');
    setErrorMsg(null);
    try {
      // 1) Attach source — webcam grabs camera + mic, file loads + loops.
      //    Both populate videoRef.current and resolve with native dimensions.
      const attached = source === 'webcam'
        ? await attachWebcam({ videoEl: videoRef.current })
        : await attachFile({ videoEl: videoRef.current, file: selectedFile });
      sourceRef.current = attached;

      // 2) Resize stage canvases + Three.js camera to match native source
      //    resolution, then sync the container's aspectRatio CSS so vertical
      //    or horizontal clips display at their real proportions. Operator
      //    aspectMode override forces 16:9 or 9:16 regardless of source.
      const { w: nativeW, h: nativeH } = attached.dimensions;
      const { w, h } = resolveStageDimensions(aspectMode, nativeW, nativeH);
      if (stageRef.current) {
        stageRef.current.setStageDimensions(w, h);
        stageRef.current.setMirrorVideo(source === 'webcam');
      }
      setStageAspect(`${w} / ${h}`);

      // 3) Build the hand tracker against the now-playing video element.
      //    flipX matches the mirror choice — both flip together so the
      //    user's apparent left hand maps to leftHand in the recognizer.
      const flipX = source === 'webcam';
      const tracker = createHandTracker({
        videoEl: videoRef.current,
        flipX,
        onFrame: (landmarks) => {
          if (!stageRef.current) return;
          stageRef.current.updateLandmarks(landmarks);
          const propName = stageRef.current.getActivePropName();
          const result = recognize(landmarks, propName === 'preview' ? null : propName);
          stageRef.current.updateGesture(result);
          setLastGesture(result);
        },
        onError: (err) => {
          setErrorMsg(`tracker: ${err.message}`);
          setTrackerStatus('error');
        },
      });
      await tracker.start();
      trackerRef.current = tracker;
      stageRef.current.attachVideo(videoRef.current);
      setTrackerStatus('running');
    } catch (err) {
      setErrorMsg(err.message);
      setTrackerStatus('error');
      // Roll back any partial source attach so a retry starts clean.
      if (sourceRef.current) {
        sourceRef.current.dispose();
        sourceRef.current = null;
      }
    }
  }, [trackerStatus, source, selectedFile, aspectMode]);

  // Live aspect override — when operator toggles 16:9/9:16/native during an
  // active tracking session, resize the stage on the fly. The prop re-mounts
  // automatically inside setStageDimensions so its world mapping picks up
  // the new aspect.
  useEffect(() => {
    if (trackerStatus !== 'running' || !stageRef.current || !sourceRef.current) return;
    const { w: nativeW, h: nativeH } = sourceRef.current.dimensions || { w: 1280, h: 720 };
    const { w, h } = resolveStageDimensions(aspectMode, nativeW, nativeH);
    stageRef.current.setStageDimensions(w, h);
    setStageAspect(`${w} / ${h}`);
  }, [aspectMode, trackerStatus]);

  const handleStop = useCallback(() => {
    if (trackerRef.current) {
      trackerRef.current.stop();
      trackerRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.dispose();
      sourceRef.current = null;
    }
    setTrackerStatus('idle');
  }, []);

  const handleToggleDebug = useCallback(() => {
    setDebugOverlayOn((prev) => {
      const next = !prev;
      if (stageRef.current) stageRef.current.setDebugOverlay(next);
      return next;
    });
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (recordingState !== 'idle' || trackerStatus !== 'running') return;
    // Webcam source carries a MediaStream with the mic audio track; file
    // source is null (the operator records lav audio separately as a wav backup, so
    // we don't bother muxing the video file's audio). conceptRecorder
    // already handles null gracefully.
    const stream = sourceRef.current?.stream || null;
    const canvas = stageRef.current?.getComposedCanvas();
    if (!canvas) {
      setErrorMsg('stage not ready');
      return;
    }
    const recorder = createConceptRecorder({
      canvas,
      audioStream: stream,
      propName: selectedProp || 'preview',
    });
    await recorder.start();
    recorderRef.current = recorder;
    setRecordingState('recording');
    setElapsedSec(0);
    // Tick the elapsed counter
    const tick = () => {
      if (recorderRef.current) {
        setElapsedSec(recorderRef.current.getElapsedSec());
        elapsedRafRef.current = requestAnimationFrame(tick);
      } else {
        elapsedRafRef.current = null;
      }
    };
    tick();
  }, [recordingState, trackerStatus, selectedProp]);

  const handleStopRecording = useCallback(async () => {
    if (recordingState !== 'recording' || !recorderRef.current) return;
    setRecordingState('uploading');
    try {
      const { url } = await recorderRef.current.stop();
      setSavedUrl(url);
      // Update node data so output handle propagates the URL via React Flow
      if (data?.onOutput) data.onOutput(id, { videoUrl: url });
    } catch (err) {
      setErrorMsg(err.message);
    }
    recorderRef.current = null;
    setRecordingState('idle');
  }, [recordingState, data, id]);

  return (
    <div
      style={{
        background: 'var(--bg-panel, #1a1a24)',
        color: '#e8e8e8',
        border: `1.5px solid ${NODE_ACCENT}`,
        borderRadius: 8,
        padding: 12,
        width: 720,
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
          paddingBottom: 8,
          borderBottom: `1px solid ${NODE_ACCENT}`,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            background:
              trackerStatus === 'running'
                ? '#10b981'
                : trackerStatus === 'error'
                  ? '#ef4444'
                  : '#666',
          }}
        />
        <strong style={{ flex: 1 }}>Concept Composer</strong>
        <span style={{ color: NODE_ACCENT, fontSize: 10 }}>ARES PROPS</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDeleteNode(id); }}
          title="Delete node"
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'rgba(231, 76, 60, 0.15)',
            border: '1px solid rgba(231, 76, 60, 0.4)',
            color: '#e74c3c',
            fontSize: 13,
            fontWeight: 'bold',
            cursor: 'pointer',
            padding: 0,
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >×</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label style={{ color: '#888', fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Prop</label>
        <select
          className="nodrag"
          value={selectedProp}
          onChange={(e) => { e.stopPropagation(); setSelectedProp(e.target.value); }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            background: 'var(--bg, #0a0a0f)',
            color: '#e8e8e8',
            border: `1px solid ${NODE_ACCENT}`,
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          <option value="preview">Preview (no prop)</option>
          <option value="cube">✦ Sealed Lattice Cube — Packet Binding</option>
          <option value="disc">◐ Phase Disc — Phase Enforcement</option>
          <option value="wire">⌇ Citation Wire — Evidence Grounding</option>
          <option value="scale">⚖ Verdict Scale — Deterministic Verdicts</option>
          <option value="firewall">⌬ Firewall Gate — Firewall (regex-gate)</option>
          <option value="hotswap">⇄ Hot-Swap Swarm — Hot-Swap (fresh-agent spawn)</option>
          <option value="firewallhud">▣ Firewall HUD — Firewall (readable regex)</option>
          <option value="topologycrystal">◇ Topology Crystal — Evidence Grounding</option>
          <option disabled>── ARES Beats (YouTube 2026-05-14) ──</option>
          <option value="architectwisp">☼ Architect Wisp — amber cloud (BEAT 0/1/3/4)</option>
          <option value="skepticwisp">✻ Skeptic Wisp — magenta cloud (BEAT 0/1/3/6)</option>
          <option value="oraclelattice">⬚ Oracle Lattice — cyan rigid (BEAT 1/3)</option>
          <option value="evidencebox">▦ Evidence Box — 12 facts + SHA shell (BEAT 2/3/6/8)</option>
          <option value="driftdial">⇕ Drift Dial — accuracy-down / confidence-up (BEAT 4)</option>
          <option value="firewallplane">⊟ Firewall Plane — glass wall + attack stream (BEAT 5)</option>
          <option value="hotswapreform">⟳ Hot-Swap Reform — single-palm dissolve (BEAT 6)</option>
          <option value="lightskeptic">∷ Light Skeptic — four-rule deterministic (BEAT 6/8)</option>
          <option value="twinprosebox">⫶⫶ Twin-Prose Box — same facts, two prose (BEAT 7)</option>
          <option value="driftbands">▤ Drift Bands — four-layer drift display (BEAT 7)</option>
          <option disabled>── Sandbox ──</option>
          <option value="stretchtile">▱ Stretch Tile — pinch corners to deform a holo quad</option>
          <option value="tribunal">⚖ Tribunal — Architect vs Skeptic, Oracle adjudicates (Deterministic Verdicts)</option>
          <option disabled>── BEAT 2 — Closed World / Schema Violation ──</option>
          <option value="hallucinationcloud">※ Hallucination Cloud — ASCII chaos at palm (BEAT 2: what we made impossible)</option>
          <option value="hashseal">◉ Hash Seal — fingertips paint the cryptographic shell around an ID (BEAT 2: Fact)</option>
          <option disabled>── Code / Data Aesthetic ──</option>
          <option value="patchheatmap">▦ Patch Heatmap — DINOv3-style green heatmap grid (hand + face heat)</option>
        </select>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label style={{ color: '#888', fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Source</label>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={() => {
              if (trackerStatus === 'running' || trackerStatus === 'starting') return;
              setSource('webcam');
              setSelectedFile(null);
              setErrorMsg(null);
            }}
            disabled={trackerStatus === 'running' || trackerStatus === 'starting'}
            style={btnStyle(source === 'webcam' ? NODE_ACCENT : '#444')}
          >
            {source === 'webcam' ? '⦿' : '○'} Webcam
          </button>
          <button
            type="button"
            onClick={() => {
              if (trackerStatus === 'running' || trackerStatus === 'starting') return;
              setSource('file');
              setErrorMsg(null);
            }}
            disabled={trackerStatus === 'running' || trackerStatus === 'starting'}
            style={btnStyle(source === 'file' ? NODE_ACCENT : '#444')}
          >
            {source === 'file' ? '⦿' : '○'} File
          </button>
        </div>
        {source === 'file' && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setSelectedFile(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={trackerStatus === 'running' || trackerStatus === 'starting'}
              style={btnStyle('#444')}
            >
              {selectedFile ? '↻ Change…' : '📁 Choose video…'}
            </button>
            {selectedFile && (
              <span style={{ color: '#aaa', fontSize: 10, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedFile.name}
              </span>
            )}
          </>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label style={{ color: '#888', fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Aspect</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { value: 'native', label: 'Native' },
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setAspectMode(opt.value)}
              style={btnStyle(aspectMode === opt.value ? NODE_ACCENT : '#444')}
              title={opt.value === '9:16' ? 'Force 9:16 — shortform recording (props re-mount with portrait world mapping)' : opt.value === '16:9' ? 'Force 16:9 — landscape recording' : 'Follow source dimensions'}
            >
              {aspectMode === opt.value ? '⦿' : '○'} {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={stageContainerRef}
        style={{
          width: '100%',
          aspectRatio: stageAspect,
          background: '#000',
          borderRadius: 4,
          overflow: 'hidden',
          marginBottom: 8,
        }}
      >
        <video ref={videoRef} style={{ display: 'none' }} muted playsInline />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {trackerStatus !== 'running' ? (
          <button
            onClick={handleStart}
            disabled={trackerStatus === 'starting' || (source === 'file' && !selectedFile)}
            style={btnStyle(NODE_ACCENT)}
            title={source === 'file' && !selectedFile ? 'Choose a video file first' : 'Start hand tracking'}
          >
            {trackerStatus === 'starting' ? 'Starting…' : '▶ Start tracking'}
          </button>
        ) : (
          <button onClick={handleStop} style={btnStyle('#666')}>
            ■ Stop tracking
          </button>
        )}

        <button onClick={handleToggleDebug} style={btnStyle(debugOverlayOn ? '#22c55e' : '#666')}>
          {debugOverlayOn ? '✓ Landmarks' : '○ Landmarks'}
        </button>

        <select
          className="nodrag"
          value={trailMode}
          onChange={(e) => {
            e.stopPropagation();
            const mode = e.target.value;
            setTrailMode(mode);
            if (stageRef.current) stageRef.current.setTrailMode(mode);
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          title="Trail rendering mode for the landmark overlay"
          style={{
            background: 'var(--bg, #0a0a0f)',
            color: '#e8e8e8',
            border: `1px solid ${NODE_ACCENT}`,
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          <option value="glow">⟿ Glow (camera visible)</option>
          <option value="veil">▮ Veil (dark, no camera)</option>
          <option value="sharp">• Sharp (no trails)</option>
        </select>

        <select
          className="nodrag"
          value={renderShape}
          onChange={(e) => {
            e.stopPropagation();
            const shape = e.target.value;
            setRenderShape(shape);
            if (stageRef.current) stageRef.current.setRenderShape(shape);
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          title="What to draw at each landmark"
          style={{
            background: 'var(--bg, #0a0a0f)',
            color: '#e8e8e8',
            border: `1px solid ${NODE_ACCENT}`,
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          <option value="dots">● Dots</option>
          <option value="ascii">01 ASCII</option>
        </select>

        <button
          onClick={() => {
            const next = !crossHandLineOn;
            setCrossHandLineOn(next);
            if (stageRef.current) stageRef.current.setCrossHandLine(next);
          }}
          title="Yellow glowing line between your two index fingertips"
          style={btnStyle(crossHandLineOn ? '#facc15' : '#666')}
        >
          {crossHandLineOn ? '✓ Bridge' : '○ Bridge'}
        </button>

        <button
          onClick={() => setFaceTrackingOn((v) => !v)}
          title="MediaPipe FaceMesh — 468 landmarks. Loads ~1MB model from CDN on first toggle."
          style={btnStyle(faceTrackingOn ? NODE_ACCENT : '#666')}
        >
          {faceTrackingOn ? '✓ Face' : '○ Face'}
        </button>

        <button
          onClick={() => {
            const next = !faceGlowOn;
            setFaceGlowOn(next);
            if (stageRef.current) stageRef.current.setFaceGlow(next);
          }}
          title="Boost face mesh to pink glow (large radius, big shadow blur)"
          style={btnStyle(faceGlowOn ? '#f0abfc' : '#666')}
        >
          {faceGlowOn ? '✓ Face glow' : '○ Face glow'}
        </button>

        {trackerStatus === 'running' && recordingState === 'idle' && (
          <button onClick={handleStartRecording} style={btnStyle('#dc2626')}>
            ● Record
          </button>
        )}
        {recordingState === 'recording' && (
          <button onClick={handleStopRecording} style={btnStyle('#dc2626')}>
            ■ Stop ({elapsedSec.toFixed(1)}s)
          </button>
        )}
        {recordingState === 'uploading' && <span style={{ alignSelf: 'center' }}>Uploading…</span>}
      </div>

      <div style={{ fontSize: 10, color: '#888' }}>
        Status: {trackerStatus} · Gesture: {lastGesture.gesture}
        {elapsedSec > 60 && recordingState === 'recording' && (
          <span style={{ color: '#f59e0b', marginLeft: 8 }}>⚠ over soft cap (60s)</span>
        )}
      </div>

      {errorMsg && (
        <div
          style={{
            marginTop: 8,
            padding: 6,
            background: '#7f1d1d',
            borderRadius: 4,
            fontSize: 10,
          }}
        >
          {errorMsg}
        </div>
      )}

      {savedUrl && (
        <div style={{ marginTop: 8, fontSize: 10, color: '#22c55e' }}>
          ✓ saved: <code>{savedUrl}</code>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="video-out"
        style={{ background: NODE_ACCENT, width: 12, height: 12 }}
      />
    </div>
  );
}

function btnStyle(accent) {
  return {
    background: `linear-gradient(180deg, ${accent}dd, ${accent}aa)`,
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    padding: '6px 12px',
    fontSize: 11,
    cursor: 'pointer',
    fontWeight: 500,
  };
}

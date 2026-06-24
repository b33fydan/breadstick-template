// Three.js scene + 2D landmark debug overlay + per-prop glyph mount.
//
// Phase 1: empty 3D scene + 2D canvas on top drawing landmark dots.
// Phase 2: setProp('cube') mounts the Sealed Lattice Cube glyph; renderLoop
//          calls its update(landmarks, gesture) every frame. Disc/Wire/Scale
//          plug in here later via the same GLYPH_FACTORIES map.
//
// Lifecycle:
//   const stage = createConceptStage({ container });
//   stage.updateLandmarks({ leftHand, rightHand });    // call every frame
//   stage.updateGesture(gestureResult);                 // call every frame
//   stage.setProp('cube' | 'preview' | ...);            // swap mounted prop
//   stage.setDebugOverlay(true|false);                  // toggle landmark dots
//   stage.getComposedCanvas();                          // for MediaRecorder
//   stage.dispose();                                    // teardown

import * as THREE from 'three';
import { createSealedLatticeCube } from '../concept-glyphs/SealedLatticeCube/index.js';
import { createPhaseDisc } from '../concept-glyphs/PhaseDisc/index.js';
import { createCitationWire } from '../concept-glyphs/CitationWire/index.js';
import { createVerdictScale } from '../concept-glyphs/VerdictScale/index.js';
import { createFirewallGate } from '../concept-glyphs/FirewallGate/index.js';
import { createHotSwapSwarm } from '../concept-glyphs/HotSwapSwarm/index.js';
import { createFirewallHUD } from '../concept-glyphs/FirewallHUD/index.js';
import { createTopologyCrystal } from '../concept-glyphs/TopologyCrystal/index.js';
import { createArchitectWisp } from '../concept-glyphs/ArchitectWisp/index.js';
import { createSkepticWisp } from '../concept-glyphs/SkepticWisp/index.js';
import { createOracleLattice } from '../concept-glyphs/OracleLattice/index.js';
import { createLightSkeptic } from '../concept-glyphs/LightSkeptic/index.js';
import { createEvidenceBox } from '../concept-glyphs/EvidenceBox/index.js';
import { createFirewallPlane } from '../concept-glyphs/FirewallPlane/index.js';
import { createHotSwapReform } from '../concept-glyphs/HotSwapReform/index.js';
import { createDriftDial } from '../concept-glyphs/DriftDial/index.js';
import { createTwinProseBox } from '../concept-glyphs/TwinProseBox/index.js';
import { createDriftBands } from '../concept-glyphs/DriftBands/index.js';
import { createStretchTile } from '../concept-glyphs/StretchTile/index.js';
import { createTribunal } from '../concept-glyphs/Tribunal/index.js';
import { createHallucinationCloud } from '../concept-glyphs/HallucinationCloud/index.js';
import { createHashSeal } from '../concept-glyphs/HashSeal/index.js';
import { createPatchHeatmap } from '../concept-glyphs/PatchHeatmap/index.js';

// Pluggable map — each new ARES prop adds an entry here. The matching gesture
// recognizer registers itself via side-effect import inside the glyph module.
const GLYPH_FACTORIES = {
  cube: createSealedLatticeCube,
  disc: createPhaseDisc,
  wire: createCitationWire,
  scale: createVerdictScale,
  firewall: createFirewallGate,
  hotswap: createHotSwapSwarm,
  firewallhud: createFirewallHUD,
  topologycrystal: createTopologyCrystal,
  architectwisp: createArchitectWisp,
  skepticwisp: createSkepticWisp,
  oraclelattice: createOracleLattice,
  lightskeptic: createLightSkeptic,
  evidencebox: createEvidenceBox,
  firewallplane: createFirewallPlane,
  hotswapreform: createHotSwapReform,
  driftdial: createDriftDial,
  twinprosebox: createTwinProseBox,
  driftbands: createDriftBands,
  stretchtile: createStretchTile,
  tribunal: createTribunal,
  hallucinationcloud: createHallucinationCloud,
  hashseal: createHashSeal,
  patchheatmap: createPatchHeatmap,
};

// Default stage dimensions for the webcam case (we request 1280×720 from
// getUserMedia). For file sources, setStageDimensions(w, h) replaces these
// with the video's native resolution at attach time.
const DEFAULT_W = 1280;
const DEFAULT_H = 720;

// Per-landmark colors for the debug overlay. Color groups read at a glance:
// wrist = white, thumb = gold, index = cyan, middle = violet, ring = red,
// pinky = emerald. Fingertip indices (4, 8, 12, 16, 20) get drawn larger +
// glowier than the interior joints.
const LANDMARK_COLORS = {
  0:  '#ffffff',                                              // wrist
  1:  '#facc15', 2:  '#facc15', 3:  '#facc15', 4:  '#facc15', // thumb
  5:  '#06b6d4', 6:  '#06b6d4', 7:  '#06b6d4', 8:  '#06b6d4', // index
  9:  '#a78bfa', 10: '#a78bfa', 11: '#a78bfa', 12: '#a78bfa', // middle
  13: '#f87171', 14: '#f87171', 15: '#f87171', 16: '#f87171', // ring
  17: '#34d399', 18: '#34d399', 19: '#34d399', 20: '#34d399', // pinky
};
const FINGERTIP_INDICES = new Set([4, 8, 12, 16, 20]);
const TRAIL_FADE_ALPHA = 0.08;   // lower = longer trails; raise to 0.20 for ghosts

// Trail rendering modes — switchable at runtime via stage.setTrailMode().
// Sandbox for visual experimentation; behavior differences:
//
//   'glow'  → destination-out alpha decay. Overlay canvas stays transparent
//             where there are no recent dots, so the camera feed below
//             shows through. Bright glowy trails on a clear background.
//             Default.
//
//   'veil'  → semi-transparent black fill stacks every frame, eventually
//             covering the camera with a near-opaque dark layer that has
//             bright trails living on top. The "I broke it but it looked
//             cool" mode. Different aesthetic — more abstract, no camera.
//
//   'sharp' → full clearRect each frame, no trails. Just the current
//             landmark positions. Use this when the visualization is
//             distracting and you only want point locations.
//
// Face landmarks (468 from @mediapipe/face_mesh) render via the same trail
// + shape substrate. Skipping a full per-landmark palette — at 468 points
// a dense rainbow is visually noisy, and the slate fallback below reads
// cleanly as "scaffold." Face dots use FACE_DOT_RADIUS / FACE_GLOW_BLUR
// (smaller + dimmer than hand dots) so they don't smother the screen.
const TRAIL_MODES = { GLOW: 'glow', VEIL: 'veil', SHARP: 'sharp' };

// Two-tier face styling. The toggle picks between them at runtime.
//
//   off → scaffold: small, slate, low glow. Reads as "structural mesh,"
//         pairs cleanly with hand dots without competing for attention.
//   on  → energized: bigger radius, big shadowBlur, color shifted to pink
//         (#f0abfc) since pink is NOT in the per-finger hand palette
//         (gold/cyan/violet/red/emerald), so a glowing face mesh stays
//         visually distinct from any hand dot it overlaps.
const FACE_DOT_COLOR_SOFT = '#cbd5e1';
const FACE_DOT_RADIUS_SOFT = 1.5;
const FACE_GLOW_BLUR_SOFT = 4;

const FACE_DOT_COLOR_GLOW = '#f0abfc';
const FACE_DOT_RADIUS_GLOW = 2.5;
const FACE_GLOW_BLUR_GLOW = 14;

// Landmark render shape — what we DRAW at each landmark position.
//
//   'dots'  → filled circle, radius 4 (or 6 for fingertips). The default.
//             Reads as joints / nodes.
//
//   'ascii' → a character from ASCII_VOCAB instead of a circle. Combined
//             with a trail mode this looks like Matrix-style binary rain
//             that traces the hand shape. The character at each landmark
//             rotates through the vocab every ASCII_CYCLE_MS for a
//             flicker effect — change ASCII_VOCAB to whatever you want
//             (e.g. 'ARES01' bakes the brand into the rain).
//
// Orthogonal to TRAIL_MODES — any shape can be combined with any trail
// mode. Glow+ASCII = camera-with-binary-rain; Veil+ASCII = pure terminal.
const RENDER_SHAPES = { DOTS: 'dots', ASCII: 'ascii' };
const ASCII_VOCAB = '01';
const ASCII_CYCLE_MS = 250;
const ASCII_FONT_SIZE = 14;

export function createConceptStage({ container }) {
  if (!container) throw new Error('conceptStage: container element is required');

  // Stage dimensions — start at the webcam defaults; setStageDimensions(w, h)
  // swaps them when a file source attaches with different native resolution
  // (e.g. 9:16 portrait clips). The pixel buffer drives recorder output, so
  // these need to match the video's real dimensions.
  let stageW = DEFAULT_W;
  let stageH = DEFAULT_H;

  // Three.js scene (empty in Phase 1)
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, stageW / stageH, 0.1, 1000);
  camera.position.set(0, 0, 3);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(stageW, stageH);
  renderer.setClearColor(0x000000, 0); // transparent so video shows through

  // 2D debug overlay (drawn over the Three.js canvas)
  const overlay = document.createElement('canvas');
  overlay.width = stageW;
  overlay.height = stageH;
  overlay.style.position = 'absolute';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.pointerEvents = 'none';
  const overlayCtx = overlay.getContext('2d');

  // Composed canvas — visible surface AND what MediaRecorder captures.
  // Mirrored webcam + Three render + debug overlay all draw into here.
  // Three's canvas + overlay stay detached scratch surfaces (drawImage works
  // on detached canvases) so the dots aren't double-rendered.
  //
  // Internal pixel buffer stays stageW × stageH (full res for the recorder).
  // CSS width/height: 100% lets the browser scale to whatever the caller's
  // container size is — no transform-scale hacks needed.
  const composed = document.createElement('canvas');
  composed.width = stageW;
  composed.height = stageH;
  composed.style.position = 'absolute';
  composed.style.top = '0';
  composed.style.left = '0';
  composed.style.width = '100%';
  composed.style.height = '100%';
  const composedCtx = composed.getContext('2d');

  container.style.position = 'relative';
  container.appendChild(composed);

  let debugOverlayEnabled = true;
  let trailMode = TRAIL_MODES.GLOW;
  let renderShape = RENDER_SHAPES.DOTS;
  let crossHandLineEnabled = false;  // off by default — toggle on for the bridge effect
  let faceGlowEnabled = false;       // off by default — toggle on for pink-glow face mesh
  let mirrorVideo = true;            // webcam needs mirroring; file mode flips this off
  let lastLandmarks = { leftHand: null, rightHand: null, face: null };
  let lastGesture = null;

  // Active prop state — set via setProp(name); update(landmarks, gesture)
  // called from renderLoop every frame, dispose() when swapped or torn down.
  let activeProp = null;
  let activePropName = 'preview';

  function drawDebugOverlay() {
    if (!debugOverlayEnabled) {
      // Disabled → full clear so no stale trails persist when re-enabled.
      overlayCtx.clearRect(0, 0, stageW, stageH);
      return;
    }

    // Apply trail mode — different ways of handling what was on the
    // canvas BEFORE this frame's new dots are drawn. See the TRAIL_MODES
    // comment block at the top of this file for the three options.
    if (trailMode === TRAIL_MODES.SHARP) {
      // No trails: full clear every frame, only current dots are visible.
      overlayCtx.clearRect(0, 0, stageW, stageH);
    } else if (trailMode === TRAIL_MODES.VEIL) {
      // Veil: stack a semi-transparent black fill every frame. The
      // overlay slowly fills with darkness, leaving only the recent
      // bright trails visible on top. Hides the camera feed underneath.
      overlayCtx.fillStyle = `rgba(0, 0, 0, ${TRAIL_FADE_ALPHA})`;
      overlayCtx.fillRect(0, 0, stageW, stageH);
    } else {
      // Glow (default): destination-out alpha decay. Subtract alpha from
      // existing pixels instead of adding black ones. Overlay stays
      // transparent where no recent dots have been, so the camera feed
      // shows through cleanly behind the glowing trails.
      overlayCtx.globalCompositeOperation = 'destination-out';
      overlayCtx.fillStyle = `rgba(0, 0, 0, ${TRAIL_FADE_ALPHA})`;
      overlayCtx.fillRect(0, 0, stageW, stageH);
      overlayCtx.globalCompositeOperation = 'source-over';
    }

    // Per-landmark render. Color + glow always come from LANDMARK_COLORS
    // + fingertip set. The SHAPE branch (dots vs ascii) is the only thing
    // that differs — color/glow are shape-agnostic so the finger-group
    // palette reads the same way regardless of which shape is selected.
    const useAscii = renderShape === RENDER_SHAPES.ASCII;
    const asciiCycle = Math.floor(performance.now() / ASCII_CYCLE_MS);
    if (useAscii) {
      overlayCtx.font = `${ASCII_FONT_SIZE}px monospace`;
      overlayCtx.textAlign = 'center';
      overlayCtx.textBaseline = 'middle';
    }
    [lastLandmarks.leftHand, lastLandmarks.rightHand].forEach((hand) => {
      if (!hand) return;
      hand.forEach((pt, i) => {
        const color = LANDMARK_COLORS[i] || '#cbd5e1';
        const isFingertip = FINGERTIP_INDICES.has(i);
        overlayCtx.fillStyle = color;
        overlayCtx.shadowColor = color;
        overlayCtx.shadowBlur = isFingertip ? 18 : 10;
        const x = pt.x * stageW;
        const y = pt.y * stageH;
        if (useAscii) {
          // Per-landmark character chosen by (index + time-cycle) so each
          // landmark flicks through the vocab independently. With trails
          // ON, the flicker leaves a fading line of mixed characters.
          const char = ASCII_VOCAB[(i + asciiCycle) % ASCII_VOCAB.length];
          overlayCtx.fillText(char, x, y);
        } else {
          const radius = isFingertip ? 6 : 4;
          overlayCtx.beginPath();
          overlayCtx.arc(x, y, radius, 0, Math.PI * 2);
          overlayCtx.fill();
        }
      });
    });

    // Face landmarks — 468 points (or null when faceTracker isn't running /
    // no face detected). Fill/shadow set ONCE outside the loop because all
    // 468 share the same color; per-iter assignment would 468× the GC.
    // Style picked by faceGlowEnabled: soft scaffold vs energized glow.
    if (lastLandmarks.face) {
      const faceColor = faceGlowEnabled ? FACE_DOT_COLOR_GLOW : FACE_DOT_COLOR_SOFT;
      const faceRadius = faceGlowEnabled ? FACE_DOT_RADIUS_GLOW : FACE_DOT_RADIUS_SOFT;
      const faceBlur = faceGlowEnabled ? FACE_GLOW_BLUR_GLOW : FACE_GLOW_BLUR_SOFT;
      overlayCtx.fillStyle = faceColor;
      overlayCtx.shadowColor = faceColor;
      overlayCtx.shadowBlur = faceBlur;
      lastLandmarks.face.forEach((pt, i) => {
        const x = pt.x * stageW;
        const y = pt.y * stageH;
        if (useAscii) {
          const char = ASCII_VOCAB[(i + asciiCycle) % ASCII_VOCAB.length];
          overlayCtx.fillText(char, x, y);
        } else {
          overlayCtx.beginPath();
          overlayCtx.arc(x, y, faceRadius, 0, Math.PI * 2);
          overlayCtx.fill();
        }
      });
    }

    // Cross-hand connector: yellow glowing line between the two index tips
    // (landmark 8 on each hand). Off by default — toggle on for the bridge
    // effect. The line follows your hands; the trail fade leaves a fading
    // streak behind it as you move.
    if (crossHandLineEnabled && lastLandmarks.leftHand && lastLandmarks.rightHand) {
      const a = lastLandmarks.leftHand[8];
      const b = lastLandmarks.rightHand[8];
      overlayCtx.strokeStyle = '#facc15';
      overlayCtx.shadowColor = '#facc15';
      overlayCtx.shadowBlur = 16;
      overlayCtx.lineWidth = 2;
      overlayCtx.beginPath();
      overlayCtx.moveTo(a.x * stageW, a.y * stageH);
      overlayCtx.lineTo(b.x * stageW, b.y * stageH);
      overlayCtx.stroke();
    }

    // Reset shadow state so it doesn't leak into other ctx operations
    // (e.g., if another part of the system ever draws to this canvas).
    overlayCtx.shadowBlur = 0;
  }

  function composeFrame(videoEl) {
    composedCtx.clearRect(0, 0, stageW, stageH);
    if (videoEl && videoEl.readyState >= 2) {
      // Webcam: mirror so user sees themselves naturally (also matches
      // handTracker.flipX=true). File: pre-recorded video is already in
      // its real orientation; mirroring would scramble the user's mental
      // model of left/right. Mirror flag and tracker.flipX flip together.
      //
      // Aspect handling: when the source aspect doesn't match the stage
      // aspect (e.g. 16:9 webcam into a 9:16 forced shortform stage), we
      // center-crop the video instead of stretching it. Otherwise faces
      // get squashed in portrait mode.
      const vw = videoEl.videoWidth || stageW;
      const vh = videoEl.videoHeight || stageH;
      const videoAspect = vw / vh;
      const stageAspect = stageW / stageH;
      let drawW, drawH, dx, dy;
      if (videoAspect > stageAspect) {
        // Video wider than stage — crop sides.
        drawH = stageH;
        drawW = drawH * videoAspect;
        dx = (stageW - drawW) / 2;
        dy = 0;
      } else {
        // Video taller than stage — crop top/bottom.
        drawW = stageW;
        drawH = drawW / videoAspect;
        dx = 0;
        dy = (stageH - drawH) / 2;
      }
      if (mirrorVideo) {
        composedCtx.save();
        composedCtx.translate(stageW, 0);
        composedCtx.scale(-1, 1);
        composedCtx.drawImage(videoEl, dx, dy, drawW, drawH);
        composedCtx.restore();
      } else {
        composedCtx.drawImage(videoEl, dx, dy, drawW, drawH);
      }
    }
    composedCtx.drawImage(renderer.domElement, 0, 0);
    composedCtx.drawImage(overlay, 0, 0);
  }

  let videoElRef = null;
  let rafId = null;

  function renderLoop() {
    drawDebugOverlay();
    if (activeProp) {
      activeProp.update(lastLandmarks, lastGesture);
    }
    renderer.render(scene, camera);
    if (videoElRef) composeFrame(videoElRef);
    rafId = requestAnimationFrame(renderLoop);
  }

  return {
    updateLandmarks(landmarks) {
      // Merge instead of replace so independent onFrame streams (handTracker
      // and faceTracker, each on its own RAF loop) can each push only their
      // own fields without wiping the other's last-known state. A field
      // explicitly set to null DOES overwrite (that's how we record "no
      // hand/face this frame"). Undefined fields are preserved.
      if (!landmarks) return;
      lastLandmarks = { ...lastLandmarks, ...landmarks };
    },
    updateGesture(gesture) {
      lastGesture = gesture || null;
    },
    setProp(name) {
      const next = name || 'preview';
      if (next === activePropName) return;
      if (activeProp) {
        try { activeProp.dispose(); } catch (err) {
          console.error('[conceptStage] prop dispose failed:', err);
        }
        activeProp = null;
      }
      activePropName = next;
      const factory = GLYPH_FACTORIES[next];
      if (factory) {
        try {
          activeProp = factory({ scene, stageW, stageH });
        } catch (err) {
          console.error(`[conceptStage] failed to mount prop "${next}":`, err);
          activeProp = null;
          activePropName = 'preview';
        }
      }
    },
    getActivePropName() {
      return activePropName;
    },
    setDebugOverlay(on) {
      debugOverlayEnabled = !!on;
    },
    setTrailMode(mode) {
      // Accept 'glow' | 'veil' | 'sharp'. Ignore unknowns silently so a
      // typo in calling code doesn't crash the renderer.
      if (Object.values(TRAIL_MODES).includes(mode)) {
        trailMode = mode;
      }
    },
    getTrailMode() {
      return trailMode;
    },
    setRenderShape(shape) {
      // Accept 'dots' | 'ascii'. Same fail-soft pattern as setTrailMode.
      if (Object.values(RENDER_SHAPES).includes(shape)) {
        renderShape = shape;
      }
    },
    getRenderShape() {
      return renderShape;
    },
    setCrossHandLine(on) {
      crossHandLineEnabled = !!on;
    },
    getCrossHandLine() {
      return crossHandLineEnabled;
    },
    setFaceGlow(on) {
      faceGlowEnabled = !!on;
    },
    getFaceGlow() {
      return faceGlowEnabled;
    },
    setMirrorVideo(on) {
      mirrorVideo = !!on;
    },
    getMirrorVideo() {
      return mirrorVideo;
    },
    setStageDimensions(w, h) {
      // Resize all three internal surfaces + Three.js camera so the next
      // render lands at the new resolution. Called when the source swaps
      // from 1280×720 webcam to a file with different native size, OR when
      // the operator toggles between 16:9 and 9:16 aspect for shortform.
      if (!w || !h) return;
      const changed = w !== stageW || h !== stageH;
      stageW = w;
      stageH = h;
      overlay.width = w;
      overlay.height = h;
      composed.width = w;
      composed.height = h;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      // Re-mount the active prop so its world mapping picks up the new
      // dimensions. Props that don't accept stageW/stageH params ignore them.
      if (changed && activeProp && activePropName && activePropName !== 'preview') {
        const remountName = activePropName;
        try { activeProp.dispose(); } catch (_err) { /* ignore */ }
        activeProp = null;
        const factory = GLYPH_FACTORIES[remountName];
        if (factory) {
          try {
            activeProp = factory({ scene, stageW: w, stageH: h });
          } catch (err) {
            console.error(`[conceptStage] failed to re-mount prop "${remountName}" after resize:`, err);
            activePropName = 'preview';
          }
        }
      }
    },
    getStageDimensions() {
      return { w: stageW, h: stageH };
    },
    attachVideo(videoEl) {
      videoElRef = videoEl;
      if (!rafId) renderLoop();
    },
    getComposedCanvas() {
      return composed;
    },
    getScene() {
      return scene; // direct access for tests + future inline glyphs
    },
    dispose() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (activeProp) {
        try { activeProp.dispose(); } catch { /* best-effort */ }
        activeProp = null;
      }
      renderer.dispose();
      if (composed.parentNode) composed.remove();
    },
  };
}

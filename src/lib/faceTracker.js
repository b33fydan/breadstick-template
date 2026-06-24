// MediaPipe FaceMesh wrapper — pairs with handTracker.js.
//
// Lifecycle:
//   1. createFaceTracker({ videoEl, onFrame }) — sets up MediaPipe FaceMesh
//      and hooks the per-frame callback. Does NOT call getUserMedia; assumes
//      videoEl is already attached to a live MediaStream (typically owned by
//      handTracker). Two trackers competing for the camera will fail.
//   2. tracker.start() — begins the tracking loop. Lazy-loads WASM + model
//      from cdn.jsdelivr.net on first call to .send().
//   3. tracker.stop() — stops the loop and closes the FaceMesh instance.
//      Does NOT touch the stream — handTracker owns it.
//
// Per-frame callback receives:
//   { face: [468 landmarks] | null, timestamp: <ms> }
//
// Each landmark is { x, y, z } in normalized [0..1] coords. x is flipped to
// user-perspective so it matches the mirrored video the user sees (same
// convention as handTracker — left-side-of-screen has lower x).

// face_mesh ships as a UMD bundle that attaches window.FaceMesh on load.
// Side-effect import triggers the script; we late-bind in init() to survive
// Vite/Rolldown's dependency-pre-bundling reshuffles.
import '@mediapipe/face_mesh';

const MODEL_CONFIG = {
  maxNumFaces: 1,
  refineLandmarks: false,    // true adds iris (478 pts) at ~2x cost; off for now
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

export function createFaceTracker({ videoEl, onFrame, onError, flipX = true }) {
  if (!videoEl) throw new Error('faceTracker: videoEl is required');
  if (typeof onFrame !== 'function') throw new Error('faceTracker: onFrame callback is required');

  let faceMesh = null;
  let rafId = null;
  let running = false;

  async function init() {
    const FaceMeshCtor = typeof window !== 'undefined' ? window.FaceMesh : null;
    if (!FaceMeshCtor) {
      throw new Error(
        'MediaPipe FaceMesh global not found on window — confirm @mediapipe/face_mesh ' +
        'loaded (check Network tab) and isn\'t blocked by a browser extension.'
      );
    }
    faceMesh = new FaceMeshCtor({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });
    faceMesh.setOptions(MODEL_CONFIG);
    faceMesh.onResults(handleResults);
  }

  function handleResults(results) {
    let face = null;
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      face = results.multiFaceLandmarks[0].map((pt) => ({
        ...pt,
        x: flipX ? 1 - pt.x : pt.x,
      }));
    }
    onFrame({ face, timestamp: performance.now() });
  }

  async function tick() {
    if (!running) return;
    try {
      await faceMesh.send({ image: videoEl });
    } catch (err) {
      console.error('[faceTracker] faceMesh.send failed:', err);
      running = false;
      if (typeof onError === 'function') onError(err);
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  return {
    async start() {
      if (running) return;
      if (!faceMesh) await init();
      running = true;
      tick();
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (faceMesh) {
        faceMesh.close();
        faceMesh = null;
      }
    },
  };
}

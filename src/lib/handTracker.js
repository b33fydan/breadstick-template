// MediaPipe Hands.js wrapper — model runner only.
//
// Does NOT own the video source. Caller is responsible for putting pixels
// into the videoEl (webcam stream, file playback, anything else) before
// start() is called. See videoSource.js for the source factories.
//
// Lifecycle:
//   1. createHandTracker({ videoEl, onFrame, flipX }) — sets up MediaPipe
//      Hands and hooks the per-frame callback.
//   2. tracker.start() — begins the tracking loop. Lazy-loads WASM + model
//      from cdn.jsdelivr.net on first call to .send().
//   3. tracker.stop() — stops the loop and closes the model instance.
//
// Per-frame callback receives:
//   { leftHand: [21 landmarks] | null,
//     rightHand: [21 landmarks] | null,
//     timestamp: <ms> }
//
// flipX (default true): webcam pixels are mirrored when displayed to the
// user, so handedness AND x-coords need flipping to match (user's left
// hand appears on the left side of the visible video). For pre-recorded
// video that's already in real orientation, pass flipX:false to skip
// both transforms — landmarks then come back in MediaPipe's native frame.

import '@mediapipe/hands';

const MODEL_CONFIG = {
  maxNumHands: 2,
  modelComplexity: 1,        // 0 = light, 1 = full, 2 = heavy. 1 balances accuracy/perf.
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

export function createHandTracker({ videoEl, onFrame, onError, flipX = true }) {
  if (!videoEl) throw new Error('handTracker: videoEl is required');
  if (typeof onFrame !== 'function') throw new Error('handTracker: onFrame callback is required');

  let hands = null;
  let rafId = null;
  let running = false;

  async function init() {
    const HandsCtor = typeof window !== 'undefined' ? window.Hands : null;
    if (!HandsCtor) {
      throw new Error(
        'MediaPipe Hands global not found on window — confirm @mediapipe/hands ' +
        'loaded (check Network tab) and isn\'t blocked by a browser extension.'
      );
    }
    hands = new HandsCtor({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });
    hands.setOptions(MODEL_CONFIG);
    hands.onResults(handleResults);
  }

  function handleResults(results) {
    let leftHand = null;
    let rightHand = null;
    if (results.multiHandLandmarks && results.multiHandedness) {
      results.multiHandedness.forEach((handedness, i) => {
        // When flipX is true (webcam): MediaPipe labels handedness from the
        // camera's perspective AND returns x in camera-space; both need
        // flipping to match the mirrored video shown to the user.
        // When flipX is false (file): video is in real orientation, leave
        // handedness and x untouched.
        const userHand = flipX
          ? (handedness.label === 'Right' ? 'left' : 'right')
          : (handedness.label === 'Right' ? 'right' : 'left');
        const landmarks = results.multiHandLandmarks[i].map((pt) => ({
          ...pt,
          x: flipX ? 1 - pt.x : pt.x,
        }));
        if (userHand === 'left') leftHand = landmarks;
        else rightHand = landmarks;
      });
    }
    onFrame({ leftHand, rightHand, timestamp: performance.now() });
  }

  async function tick() {
    if (!running) return;
    try {
      await hands.send({ image: videoEl });
    } catch (err) {
      console.error('[handTracker] hands.send failed:', err);
      running = false;
      if (typeof onError === 'function') onError(err);
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  return {
    async start() {
      if (running) return;
      if (!hands) await init();
      running = true;
      tick();
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (hands) {
        hands.close();
        hands = null;
      }
    },
  };
}

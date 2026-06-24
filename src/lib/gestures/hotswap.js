// Hot-Swap Swarm gesture recognizer.
//
// Two-hand prop: both palms must be in frame. Computes palm-center distance
// every frame; on a sudden frame-over-frame INCREASE past SNAP_DELTA, fires
// snap = true as a single-frame rising-edge signal. The glyph factory
// consumes snap + the two palm positions to drive its transit state
// machine; this recognizer stays stateless past lastDistance.
//
// Closely mirrors wire.js — the gesture vocabulary is identical
// (sudden-yank-apart) and the result shape parallels Wire's. The semantic
// difference lives in the glyph: Wire reads the yank as a citation break;
// Hot-Swap reads it as agent rebirth.

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17];

// Frame-over-frame normalized-distance increase that registers as a yank.
// 0.08 ≈ 8% of frame width; enough to detect a real pull-apart and ignore
// wobble. Matches wire.js threshold for consistent operator muscle memory.
const SNAP_DELTA = 0.08;

let lastDistance = null;

function computePalmCenter(hand) {
  let x = 0;
  let y = 0;
  for (const i of PALM_INDICES) {
    x += hand[i].x;
    y += hand[i].y;
  }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

export function hotswapRecognizer(landmarks) {
  const result = {
    gesture: 'idle',
    leftPalm: null,
    rightPalm: null,
    distance: null,
    snap: false,
  };
  if (landmarks?.leftHand) result.leftPalm = computePalmCenter(landmarks.leftHand);
  if (landmarks?.rightHand) result.rightPalm = computePalmCenter(landmarks.rightHand);

  if (result.leftPalm && result.rightPalm) {
    const dx = result.leftPalm.x - result.rightPalm.x;
    const dy = result.leftPalm.y - result.rightPalm.y;
    result.distance = Math.hypot(dx, dy);
    if (lastDistance !== null && result.distance - lastDistance > SNAP_DELTA) {
      result.snap = true;
      result.gesture = 'snap';
    } else {
      result.gesture = 'paired';
    }
    lastDistance = result.distance;
  } else {
    lastDistance = null;
  }
  return result;
}

registerPropRecognizer('hotswap', hotswapRecognizer);

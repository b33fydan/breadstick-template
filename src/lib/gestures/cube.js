// Cube-specific gesture recognizer for the Concept Composer.
//
// Computes everything the SealedLatticeCube glyph needs to position + scale
// itself, so the glyph code stays focused on rendering. Registers itself
// with the central gestureRecognizer registry on module load (side-effect
// import from concept-glyphs/SealedLatticeCube/index.js).
//
// Result shape:
//   {
//     gesture: 'idle' | 'push',
//     leftPalm:  { x, y } | null,   // normalized [0..1] user-perspective
//     rightPalm: { x, y } | null,
//     leftScale:  <number>,          // 0.5..1.5 cube radius multiplier
//     rightScale: <number>,
//     palmDistance: <number> | null, // between palms when both tracked
//     push: <boolean>,               // true when palms within PUSH_THRESHOLD
//   }
//
// Anchor convention: palm center is the centroid of the 5 base-of-fingers
// landmarks (0, 5, 9, 13, 17) — wrist + four MCP joints. More stable than
// any single landmark when fingers move.
//
// Thumb-angle proxy: we use distance(thumbTip, indexTip) per hand instead
// of inter-thumb angle. The mentor spec described "angle between the
// thumbs (open hands = bigger packet, closed = smaller)"; this single-hand
// proxy gives equivalent control AND works when only one hand is in frame.

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17]; // wrist + 4 MCP joints
const THUMB_TIP = 4;
const INDEX_TIP = 8;

// Push detection threshold — when palms get this close in normalized space,
// the two cubes are "kissing" and we fire a repel event.
const PUSH_THRESHOLD = 0.18;

// Thumb-to-index distance normalization range (empirical, ~5cm webcam at
// arm's length). Below MIN = closed fist, above MAX = wide spread.
const THUMB_INDEX_MIN = 0.05;
const THUMB_INDEX_MAX = 0.25;
const SCALE_MIN = 0.5;
const SCALE_MAX = 1.5;

function computePalmCenter(handLandmarks) {
  let x = 0;
  let y = 0;
  for (const i of PALM_INDICES) {
    x += handLandmarks[i].x;
    y += handLandmarks[i].y;
  }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

function computeThumbScale(handLandmarks) {
  const t = handLandmarks[THUMB_TIP];
  const i = handLandmarks[INDEX_TIP];
  const d = Math.hypot(t.x - i.x, t.y - i.y);
  const clamped = Math.max(THUMB_INDEX_MIN, Math.min(THUMB_INDEX_MAX, d));
  const ratio = (clamped - THUMB_INDEX_MIN) / (THUMB_INDEX_MAX - THUMB_INDEX_MIN);
  return SCALE_MIN + ratio * (SCALE_MAX - SCALE_MIN);
}

export function cubeRecognizer(landmarks) {
  const result = {
    gesture: 'idle',
    leftPalm: null,
    rightPalm: null,
    leftScale: 1,
    rightScale: 1,
    palmDistance: null,
    push: false,
  };

  if (landmarks?.leftHand) {
    result.leftPalm = computePalmCenter(landmarks.leftHand);
    result.leftScale = computeThumbScale(landmarks.leftHand);
  }
  if (landmarks?.rightHand) {
    result.rightPalm = computePalmCenter(landmarks.rightHand);
    result.rightScale = computeThumbScale(landmarks.rightHand);
  }
  if (result.leftPalm && result.rightPalm) {
    const dx = result.leftPalm.x - result.rightPalm.x;
    const dy = result.leftPalm.y - result.rightPalm.y;
    result.palmDistance = Math.hypot(dx, dy);
    if (result.palmDistance < PUSH_THRESHOLD) {
      result.gesture = 'push';
      result.push = true;
    }
  }
  return result;
}

registerPropRecognizer('cube', cubeRecognizer);

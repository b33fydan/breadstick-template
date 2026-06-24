// Firewall Gate gesture recognizer for the Concept Composer.
//
// Single-hand thumb-scale (reuses cube.js's thumb-index distance logic). The
// Firewall Gate is a single floating ring — only one instance per scene,
// anchored to whichever hand is in frame. Left preferred when both visible
// (arbitrary tiebreaker matching cube.js convention).
//
// Registers itself with the central gestureRecognizer registry on module
// load (side-effect import from concept-glyphs/FirewallGate/index.js).
//
// Result shape:
//   {
//     gesture: 'idle',
//     palm:  { x, y } | null,   // normalized [0..1] user-perspective
//     scale: <number>,          // 0.5..1.5 ring radius multiplier
//     hand:  'left' | 'right' | null,
//   }
//
// Anchor convention matches cube.js: palm center = centroid of the 5
// base-of-fingers landmarks (0, 5, 9, 13, 17). Thumb-scale: distance from
// THUMB_TIP (4) to INDEX_TIP (8), normalized.

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17];
const THUMB_TIP = 4;
const INDEX_TIP = 8;

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

export function firewallRecognizer(landmarks) {
  const result = {
    gesture: 'idle',
    palm: null,
    scale: 1,
    hand: null,
  };
  if (landmarks?.leftHand) {
    result.palm = computePalmCenter(landmarks.leftHand);
    result.scale = computeThumbScale(landmarks.leftHand);
    result.hand = 'left';
  } else if (landmarks?.rightHand) {
    result.palm = computePalmCenter(landmarks.rightHand);
    result.scale = computeThumbScale(landmarks.rightHand);
    result.hand = 'right';
  }
  return result;
}

registerPropRecognizer('firewall', firewallRecognizer);

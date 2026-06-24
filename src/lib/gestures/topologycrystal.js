// Topology Crystal gesture recognizer.
//
// Single-hand wrist-roll past a 35° threshold while the hand is open.
// Captures a baseline roll on the first open-hand frame so the threshold
// is measured against the operator's natural neutral pose, not absolute
// screen orientation.
//
// Roll-angle math mirrors Phase Disc: atan2 of the thumb→pinky chord in
// screen space. As the wrist rotates, the chord's angle in 2D image
// space rotates 1:1, giving a clean proxy for the actual palm-normal
// roll without needing per-frame 3D pose estimation.
//
// Result shape:
//   {
//     gesture:           'idle' | 'open' | 'rolling',
//     palm:              { x, y } | null,                    // anchor hand
//     hand:              'left' | 'right' | null,            // anchor hand identity
//     rollAngle:         <number>          // raw atan2, radians
//     deviation:         <number>          // signed delta from baseline, radians, wrapped [-π,π]
//     rollPastThreshold: <boolean>         // |deviation| > 0.611 rad (≈35°)
//     handOpen:          <boolean>         // thumb↔pinky spread above threshold
//     otherFingertip:    { x, y } | null,                    // second hand's index tip, normalized
//     otherHand:         'left' | 'right' | null,            // second hand identity
//   }
//
// Two-hand convention: anchor = left if visible, else right. Other = the
// non-anchor hand if both are in frame. Baseline resets on anchor-loss
// or anchor-close so each fresh open captures its own neutral.

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17];
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const PINKY_TIP = 20;

const ROLL_THRESHOLD = (35 * Math.PI) / 180;     // 0.611 rad
const OPEN_HAND_MIN_SPREAD = 0.13;                // normalized [0..1] image space

let baselineAngle = null;
let baselineHandKey = null;

function computePalmCenter(hand) {
  let x = 0;
  let y = 0;
  for (const i of PALM_INDICES) {
    x += hand[i].x;
    y += hand[i].y;
  }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

function computeWristRoll(hand) {
  const t = hand[THUMB_TIP];
  const p = hand[PINKY_TIP];
  return Math.atan2(p.y - t.y, p.x - t.x);
}

function isHandOpen(hand) {
  const t = hand[THUMB_TIP];
  const p = hand[PINKY_TIP];
  const spread = Math.hypot(t.x - p.x, t.y - p.y);
  return spread > OPEN_HAND_MIN_SPREAD;
}

function wrapAngle(a) {
  let r = a;
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r < -Math.PI) r += 2 * Math.PI;
  return r;
}

export function topologycrystalRecognizer(landmarks) {
  const result = {
    gesture: 'idle',
    palm: null,
    hand: null,
    rollAngle: 0,
    deviation: 0,
    rollPastThreshold: false,
    handOpen: false,
    otherFingertip: null,
    otherHand: null,
  };

  // Anchor = left if visible, else right. Other = the non-anchor hand
  // when both are in frame.
  let hand = null;
  let handKey = null;
  let other = null;
  let otherKey = null;
  if (landmarks?.leftHand) {
    hand = landmarks.leftHand;
    handKey = 'left';
    if (landmarks?.rightHand) {
      other = landmarks.rightHand;
      otherKey = 'right';
    }
  } else if (landmarks?.rightHand) {
    hand = landmarks.rightHand;
    handKey = 'right';
  }

  if (other) {
    result.otherFingertip = { x: other[INDEX_TIP].x, y: other[INDEX_TIP].y };
    result.otherHand = otherKey;
  }

  if (!hand) {
    baselineAngle = null;
    baselineHandKey = null;
    return result;
  }

  result.hand = handKey;
  result.palm = computePalmCenter(hand);
  result.rollAngle = computeWristRoll(hand);
  result.handOpen = isHandOpen(hand);

  if (!result.handOpen) {
    // Closed hand → drop baseline so the next open re-arms fresh.
    baselineAngle = null;
    baselineHandKey = null;
    result.gesture = 'idle';
    return result;
  }

  // Capture baseline once per open-hand-per-hand session.
  if (baselineAngle === null || baselineHandKey !== handKey) {
    baselineAngle = result.rollAngle;
    baselineHandKey = handKey;
  }

  result.deviation = wrapAngle(result.rollAngle - baselineAngle);
  result.rollPastThreshold = Math.abs(result.deviation) > ROLL_THRESHOLD;
  result.gesture = result.rollPastThreshold ? 'rolling' : 'open';
  return result;
}

registerPropRecognizer('topologycrystal', topologycrystalRecognizer);

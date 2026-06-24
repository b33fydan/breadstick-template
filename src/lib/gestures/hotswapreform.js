// Hot-Swap Reform gesture recognizer.
//
// Single-palm variant of HotSwapSwarm. Anchors to LEFT palm by default,
// falls back to RIGHT. The trigger is a rising-edge fist closure on the
// anchor hand — each fist-pump dissolves the current cloud and reforms
// a fresh one.

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17];
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const FIST_THRESHOLD = 0.06;

function palmCenter(hand) {
  let x = 0, y = 0;
  for (const i of PALM_INDICES) { x += hand[i].x; y += hand[i].y; }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

function isFist(hand) {
  const d = Math.hypot(hand[THUMB_TIP].x - hand[INDEX_TIP].x, hand[THUMB_TIP].y - hand[INDEX_TIP].y);
  return d < FIST_THRESHOLD;
}

export function hotSwapReformRecognizer(landmarks) {
  const result = { leftPalm: null, rightPalm: null, leftFist: false, rightFist: false };
  if (landmarks?.leftHand) {
    result.leftPalm = palmCenter(landmarks.leftHand);
    result.leftFist = isFist(landmarks.leftHand);
  }
  if (landmarks?.rightHand) {
    result.rightPalm = palmCenter(landmarks.rightHand);
    result.rightFist = isFist(landmarks.rightHand);
  }
  return result;
}

registerPropRecognizer('hotswapreform', hotSwapReformRecognizer);

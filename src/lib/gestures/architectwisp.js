// Architect Wisp gesture recognizer.
//
// Returns palm centers + fist state per hand. The Architect wisp anchors to
// the LEFT palm by default (per BEAT 1 — amber left, magenta right). Fist
// closure (small thumb-index distance) freezes the breathing motion — used
// in BEAT 0 ("the system can see the lie").

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17];
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const FIST_THRESHOLD = 0.07; // thumb-to-index distance under this = fist

function palmCenter(hand) {
  let x = 0, y = 0;
  for (const i of PALM_INDICES) { x += hand[i].x; y += hand[i].y; }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

function isFist(hand) {
  const d = Math.hypot(hand[THUMB_TIP].x - hand[INDEX_TIP].x, hand[THUMB_TIP].y - hand[INDEX_TIP].y);
  return d < FIST_THRESHOLD;
}

export function architectWispRecognizer(landmarks) {
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

registerPropRecognizer('architectwisp', architectWispRecognizer);

// Firewall Plane gesture recognizer.
//
// Returns palm centers + a rising-edge "burst" flag tied to RIGHT-fist
// closure. Each rising edge of right-fist = emit a burst of attack
// particles. The glyph cycles through three modes (red direct / orange
// propagation / white framing) one burst at a time.

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17];
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const FIST_THRESHOLD = 0.07;

function palmCenter(hand) {
  let x = 0, y = 0;
  for (const i of PALM_INDICES) { x += hand[i].x; y += hand[i].y; }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

function isFist(hand) {
  const d = Math.hypot(hand[THUMB_TIP].x - hand[INDEX_TIP].x, hand[THUMB_TIP].y - hand[INDEX_TIP].y);
  return d < FIST_THRESHOLD;
}

export function firewallPlaneRecognizer(landmarks) {
  const result = {
    leftPalm: null, rightPalm: null,
    rightFist: false,
  };
  if (landmarks?.leftHand) result.leftPalm = palmCenter(landmarks.leftHand);
  if (landmarks?.rightHand) {
    result.rightPalm = palmCenter(landmarks.rightHand);
    result.rightFist = isFist(landmarks.rightHand);
  }
  return result;
}

registerPropRecognizer('firewallplane', firewallPlaneRecognizer);

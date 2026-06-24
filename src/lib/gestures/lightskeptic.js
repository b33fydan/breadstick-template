// Light Skeptic gesture recognizer.
//
// Anchor palm = the palm with an OPEN hand (thumb-index spread). The OTHER
// hand's index fingertip is the "tester" — it traces over the 4 rule dots.
// We return both palm centers + the right-index fingertip world position so
// the glyph can hit-test against its dot layout. Open-handed detection
// disambiguates which palm carries the rule lattice when both are in frame.

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17];
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const OPEN_THRESHOLD = 0.10; // thumb-index distance >= this = open

function palmCenter(hand) {
  let x = 0, y = 0;
  for (const i of PALM_INDICES) { x += hand[i].x; y += hand[i].y; }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

function thumbIndexDist(hand) {
  return Math.hypot(hand[THUMB_TIP].x - hand[INDEX_TIP].x, hand[THUMB_TIP].y - hand[INDEX_TIP].y);
}

export function lightSkepticRecognizer(landmarks) {
  const result = {
    leftPalm: null, rightPalm: null,
    leftOpen: false, rightOpen: false,
    leftIndex: null, rightIndex: null,
  };
  if (landmarks?.leftHand) {
    result.leftPalm = palmCenter(landmarks.leftHand);
    result.leftOpen = thumbIndexDist(landmarks.leftHand) >= OPEN_THRESHOLD;
    result.leftIndex = { x: landmarks.leftHand[INDEX_TIP].x, y: landmarks.leftHand[INDEX_TIP].y };
  }
  if (landmarks?.rightHand) {
    result.rightPalm = palmCenter(landmarks.rightHand);
    result.rightOpen = thumbIndexDist(landmarks.rightHand) >= OPEN_THRESHOLD;
    result.rightIndex = { x: landmarks.rightHand[INDEX_TIP].x, y: landmarks.rightHand[INDEX_TIP].y };
  }
  return result;
}

registerPropRecognizer('lightskeptic', lightSkepticRecognizer);

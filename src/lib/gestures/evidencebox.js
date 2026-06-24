// Evidence Box gesture recognizer.
//
// Anchor = LEFT palm by default (the locked evidence box). The OTHER
// hand's index fingertip is the "claim pointer." Returns palm centers
// and both fingertip positions so the glyph can hit-test against its
// 12 Fact-dots and the surrounding test volume.

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17];
const INDEX_TIP = 8;

function palmCenter(hand) {
  let x = 0, y = 0;
  for (const i of PALM_INDICES) { x += hand[i].x; y += hand[i].y; }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

export function evidenceBoxRecognizer(landmarks) {
  const result = {
    leftPalm: null, rightPalm: null,
    leftIndex: null, rightIndex: null,
  };
  if (landmarks?.leftHand) {
    result.leftPalm = palmCenter(landmarks.leftHand);
    result.leftIndex = { x: landmarks.leftHand[INDEX_TIP].x, y: landmarks.leftHand[INDEX_TIP].y };
  }
  if (landmarks?.rightHand) {
    result.rightPalm = palmCenter(landmarks.rightHand);
    result.rightIndex = { x: landmarks.rightHand[INDEX_TIP].x, y: landmarks.rightHand[INDEX_TIP].y };
  }
  return result;
}

registerPropRecognizer('evidencebox', evidenceBoxRecognizer);

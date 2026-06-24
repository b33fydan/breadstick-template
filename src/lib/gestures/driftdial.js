// Drift Dial gesture recognizer.
//
// Returns palm centers AND a per-hand altitude in [0..1] where 0 = top of
// frame, 1 = bottom of frame. The Drift Dial glyph maps left-hand altitude
// to ACCURACY (dropping = bad) and right-hand altitude to CONFIDENCE
// (rising = bad — when accuracy is also dropping, it's the failure mode).

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17];

function palmCenter(hand) {
  let x = 0, y = 0;
  for (const i of PALM_INDICES) { x += hand[i].x; y += hand[i].y; }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

export function driftDialRecognizer(landmarks) {
  const result = {
    leftPalm: null, rightPalm: null,
    leftAltitude: 0.5, rightAltitude: 0.5,
  };
  if (landmarks?.leftHand) {
    result.leftPalm = palmCenter(landmarks.leftHand);
    result.leftAltitude = result.leftPalm.y;
  }
  if (landmarks?.rightHand) {
    result.rightPalm = palmCenter(landmarks.rightHand);
    result.rightAltitude = result.rightPalm.y;
  }
  return result;
}

registerPropRecognizer('driftdial', driftDialRecognizer);

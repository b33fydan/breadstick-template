// Twin-Prose Box gesture recognizer.
//
// The Twin-Prose Box is mostly static — same 12 facts inside two
// side-by-side boxes wrapped in different colored prose ribbons.
// We return both palm centers so the glyph can anchor to LEFT (default)
// or RIGHT, but no gesture surface beyond presence.

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17];

function palmCenter(hand) {
  let x = 0, y = 0;
  for (const i of PALM_INDICES) { x += hand[i].x; y += hand[i].y; }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

export function twinProseBoxRecognizer(landmarks) {
  const result = { leftPalm: null, rightPalm: null };
  if (landmarks?.leftHand) result.leftPalm = palmCenter(landmarks.leftHand);
  if (landmarks?.rightHand) result.rightPalm = palmCenter(landmarks.rightHand);
  return result;
}

registerPropRecognizer('twinprosebox', twinProseBoxRecognizer);

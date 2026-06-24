// Stretch Tile gesture recognizer.
//
// Per-hand pinch detection. A "pinch" = thumb tip and index tip close
// together. We compute the PINCH POINT (midpoint of thumb-tip + index-tip)
// because that's where the operator's mental "grip point" feels like it
// is — not on the thumb, not on the index, but between them.
//
// Returns per-hand { x, y, pinching }. The glyph handles all grab/drag
// state — this recognizer is stateless.

import { registerPropRecognizer } from '../gestureRecognizer.js';

const THUMB_TIP = 4;
const INDEX_TIP = 8;

// Pinch threshold in normalized [0..1] space. Empirically a closed
// thumb-index gap is ~0.03-0.04 at typical webcam distance; open is 0.10+.
// 0.05 sits in the middle — closes cleanly, opens cleanly.
const PINCH_THRESHOLD = 0.05;

function pinchPoint(hand) {
  const t = hand[THUMB_TIP];
  const i = hand[INDEX_TIP];
  return {
    x: (t.x + i.x) / 2,
    y: (t.y + i.y) / 2,
    pinching: Math.hypot(t.x - i.x, t.y - i.y) < PINCH_THRESHOLD,
  };
}

export function stretchTileRecognizer(landmarks) {
  const result = { leftPinch: null, rightPinch: null };
  if (landmarks?.leftHand) result.leftPinch = pinchPoint(landmarks.leftHand);
  if (landmarks?.rightHand) result.rightPinch = pinchPoint(landmarks.rightHand);
  return result;
}

registerPropRecognizer('stretchtile', stretchTileRecognizer);

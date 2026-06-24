// Hash Seal recognizer.
//
// Exposes ALL fingertip positions (thumb / index / middle / ring / pinky)
// for whichever hands are visible. Stateless — the glyph owns the seal
// accumulation state. Both hands work independently; the glyph can paint
// with any combination of fingertips, up to 10 simultaneous painters.
//
// Result shape:
//   {
//     gesture:         'idle' | 'sealing',
//     leftFingertips:  Array<{ x, y }> | null,     // 5 entries when present
//     rightFingertips: Array<{ x, y }> | null,
//     anyHand:         boolean,
//   }

import { registerPropRecognizer } from '../gestureRecognizer.js';

// MediaPipe fingertip landmark indices: thumb, index, middle, ring, pinky.
const FINGERTIP_INDICES = [4, 8, 12, 16, 20];

function tipsFromHand(hand) {
  return FINGERTIP_INDICES.map((i) => ({ x: hand[i].x, y: hand[i].y }));
}

export function hashsealRecognizer(landmarks) {
  const result = {
    gesture: 'idle',
    leftFingertips: null,
    rightFingertips: null,
    anyHand: false,
  };

  if (landmarks?.leftHand) {
    result.leftFingertips = tipsFromHand(landmarks.leftHand);
    result.anyHand = true;
  }
  if (landmarks?.rightHand) {
    result.rightFingertips = tipsFromHand(landmarks.rightHand);
    result.anyHand = true;
  }
  if (result.anyHand) result.gesture = 'sealing';
  return result;
}

registerPropRecognizer('hashseal', hashsealRecognizer);

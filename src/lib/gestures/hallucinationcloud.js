// Hallucination Cloud recognizer.
//
// Single-hand prop — works with either hand raised. No gestural trigger;
// the cloud appears whenever a hand is visible and follows the palm.
// "Works in both" per spec — prefer left if visible, else right.
//
// Result shape:
//   {
//     gesture: 'idle' | 'visible',
//     palm:    { x, y } | null,           // normalized [0..1]; anchor for the cloud
//     hand:    'left' | 'right' | null,   // which hand is active
//     visible: boolean,                   // any hand currently in frame
//   }

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17];

function computePalmCenter(hand) {
  let x = 0;
  let y = 0;
  for (const i of PALM_INDICES) {
    x += hand[i].x;
    y += hand[i].y;
  }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

export function hallucinationcloudRecognizer(landmarks) {
  const result = {
    gesture: 'idle',
    palm: null,
    hand: null,
    visible: false,
  };

  let hand = null;
  let handKey = null;
  if (landmarks?.leftHand) {
    hand = landmarks.leftHand;
    handKey = 'left';
  } else if (landmarks?.rightHand) {
    hand = landmarks.rightHand;
    handKey = 'right';
  }
  if (!hand) return result;

  result.visible = true;
  result.hand = handKey;
  result.palm = computePalmCenter(hand);
  result.gesture = 'visible';
  return result;
}

registerPropRecognizer('hallucinationcloud', hallucinationcloudRecognizer);

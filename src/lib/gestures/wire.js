// Citation Wire gesture recognizer.
//
// Two-hand prop: left hand holds a fact token, right hand holds an
// assertion card. Wire connects them, length modulated by palm distance.
// "Snap" detected on sudden distance INCREASE (operator yanks hands
// apart — symbolizing the failed citation), with a small dead-zone
// threshold so a wobble doesn't trigger it.

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17];

// Sudden-yank threshold — if the palms move apart by this much in normalized
// distance between consecutive frames, treat as snap. 0.08 is roughly
// 8% of frame width — enough to detect a real yank but ignore wobble.
const SNAP_DELTA = 0.08;

let lastDistance = null;

function computePalmCenter(hand) {
  let x = 0;
  let y = 0;
  for (const i of PALM_INDICES) {
    x += hand[i].x;
    y += hand[i].y;
  }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

export function wireRecognizer(landmarks) {
  const result = {
    gesture: 'idle',
    leftPalm: null,
    rightPalm: null,
    distance: null,
    snap: false,
  };
  if (landmarks?.leftHand) result.leftPalm = computePalmCenter(landmarks.leftHand);
  if (landmarks?.rightHand) result.rightPalm = computePalmCenter(landmarks.rightHand);

  if (result.leftPalm && result.rightPalm) {
    const dx = result.leftPalm.x - result.rightPalm.x;
    const dy = result.leftPalm.y - result.rightPalm.y;
    result.distance = Math.hypot(dx, dy);
    if (lastDistance !== null && result.distance - lastDistance > SNAP_DELTA) {
      result.snap = true;
      result.gesture = 'snap';
    } else {
      result.gesture = 'taut';
    }
    lastDistance = result.distance;
  } else {
    lastDistance = null;
  }
  return result;
}

registerPropRecognizer('wire', wireRecognizer);

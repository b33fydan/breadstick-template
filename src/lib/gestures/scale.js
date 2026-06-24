// Verdict Scale gesture recognizer.
//
// Two-hand prop: scale floats at midpoint between palms. Beam tilts to
// follow the angle of the left→right palm vector — when left hand goes
// down, beam tilts left-down (heavier-on-left), reading naturally as
// "pour confidence into the left pan." Tilt-direction change fires a
// brass-click cue so the audio tracks the visual.

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

export function scaleRecognizer(landmarks) {
  const result = {
    gesture: 'idle',
    leftPalm: null,
    rightPalm: null,
    midpoint: null,
    tiltAngle: 0,
  };
  if (landmarks?.leftHand) result.leftPalm = computePalmCenter(landmarks.leftHand);
  if (landmarks?.rightHand) result.rightPalm = computePalmCenter(landmarks.rightHand);
  if (result.leftPalm && result.rightPalm) {
    result.midpoint = {
      x: (result.leftPalm.x + result.rightPalm.x) / 2,
      y: (result.leftPalm.y + result.rightPalm.y) / 2,
    };
    // atan2 in normalized image coords. Flip y because image y grows downward
    // but we want "left hand low" to read as a negative tilt (beam dips left).
    const dx = result.rightPalm.x - result.leftPalm.x;
    const dy = -(result.rightPalm.y - result.leftPalm.y);
    result.tiltAngle = Math.atan2(dy, dx);
    result.gesture = 'weighing';
  }
  return result;
}

registerPropRecognizer('scale', scaleRecognizer);

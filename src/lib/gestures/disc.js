// Phase Disc gesture recognizer.
//
// Disc anchors to the palm centroid (same as cube), and rotates around its
// own axis based on the operator's wrist roll. The "wrist roll" proxy here:
// angle of the thumb-tip→pinky-tip chord in screen space. When the palm is
// flat (back-of-hand toward camera, fingers spread), this chord points
// ~horizontal. Rotating the wrist tilts the chord — atan2 captures the
// rotation 1:1 with the actual hand roll.
//
// The recognizer returns activeSector ∈ {0,1,2} so the glyph code doesn't
// have to redo the math. Sector 0 = THESIS (cyan), 1 = ANTITHESIS (crimson),
// 2 = SYNTHESIS (gold). Active = the sector currently closest to the disc's
// "top" (12 o'clock from camera POV) after applying wrist roll.

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17];
const THUMB_TIP = 4;
const PINKY_TIP = 20;

function computePalmCenter(hand) {
  let x = 0;
  let y = 0;
  for (const i of PALM_INDICES) {
    x += hand[i].x;
    y += hand[i].y;
  }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

// Compute wrist-roll angle from thumb→pinky chord. Result in radians,
// covering full [-π, π] range as the wrist completes 360° of roll.
function computeWristRoll(hand) {
  const t = hand[THUMB_TIP];
  const p = hand[PINKY_TIP];
  return Math.atan2(p.y - t.y, p.x - t.x);
}

// Disc has 3 sectors at 120° each. Sector k is centered at angle
// (k * 2π/3) - π/2 when the disc is unrotated (k=0 sector at top). After
// rotation by θ, sector k is at (k * 2π/3) - π/2 + θ. Active = k whose
// center is closest to -π/2 (top of disc in screen coords). Closed-form:
//   k_active = round(-3θ / 2π) mod 3
function computeActiveSector(rollAngle) {
  const k = Math.round((-rollAngle * 3) / (2 * Math.PI));
  return ((k % 3) + 3) % 3;
}

export function discRecognizer(landmarks) {
  const result = {
    gesture: 'idle',
    palmCenter: null,
    rollAngle: 0,
    activeSector: 0,
  };

  // Disc is single-hand. Prefer left, fall back to right.
  const hand = landmarks?.leftHand || landmarks?.rightHand;
  if (!hand) return result;

  result.palmCenter = computePalmCenter(hand);
  result.rollAngle = computeWristRoll(hand);
  result.activeSector = computeActiveSector(result.rollAngle);
  result.gesture = 'rotating';
  return result;
}

registerPropRecognizer('disc', discRecognizer);

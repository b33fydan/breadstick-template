// Tribunal gesture recognizer.
//
// Two-hand prop. The "argument" is a continuous channel (palm-to-palm
// distance → tension); the "verdict" is a discrete rising-edge event
// (both index fingertips touching the normalized-center (0.5, 0.5)
// within a small radius). This mirrors the Phase Disc continuous +
// discrete pattern, applied to the Deterministic Verdicts invariant.
//
// Result shape:
//   {
//     gesture:          'idle' | 'one-hand' | 'arguing' | 'verdict',
//     leftPalm:         { x, y } | null,
//     rightPalm:        { x, y } | null,
//     leftIndex:        { x, y } | null,
//     rightIndex:       { x, y } | null,
//     palmDistance:     0..√2,    // raw Euclidean distance in normalized [0,1] space
//     tension:          0..1,     // 1 = palms together, 0 = palms maximally apart
//     centerProximity:  0..1,     // 1 = both index tips at scene center, 0 = both at edges
//     verdictTriggered: boolean,  // true on the single frame the verdict fires
//   }
//
// Verdict trigger:
//   Both index fingertips within VERDICT_RADIUS of normalized center (0.5, 0.5).
//   Rising edge only: fires once on entry, holds 'verdict' gesture until both
//   tips leave the radius, then 1.5s cooldown before re-arming. Cooldown
//   stops "twitchy" double-verdicts when the user lingers at center.
//
// Tension:
//   Inverse of palm-to-palm distance, clamped. PALMS_FAR_DIST sets where
//   tension drops to 0 (palms one screen-third apart = no tension).

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17];
const INDEX_TIP = 8;

const VERDICT_RADIUS = 0.15;        // normalized — both tips within this circle around (0.5, 0.5)
const VERDICT_COOLDOWN_MS = 1500;
const PALMS_FAR_DIST = 0.55;        // palm-distance at which tension reads as 0

// Module-level state for rising-edge + cooldown. Stays alive across calls
// (single-prop session), reset is implicit when both hands leave the radius.
let inVerdictZone = false;
let lastVerdictMs = 0;

function computePalmCenter(hand) {
  let x = 0;
  let y = 0;
  for (const i of PALM_INDICES) {
    x += hand[i].x;
    y += hand[i].y;
  }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

function distanceTo(p, cx, cy) {
  return Math.hypot(p.x - cx, p.y - cy);
}

export function tribunalRecognizer(landmarks) {
  const result = {
    gesture: 'idle',
    leftPalm: null,
    rightPalm: null,
    leftIndex: null,
    rightIndex: null,
    palmDistance: 0,
    tension: 0,
    centerProximity: 0,
    verdictTriggered: false,
  };

  const left = landmarks?.leftHand;
  const right = landmarks?.rightHand;

  if (left) {
    result.leftPalm = computePalmCenter(left);
    result.leftIndex = { x: left[INDEX_TIP].x, y: left[INDEX_TIP].y };
  }
  if (right) {
    result.rightPalm = computePalmCenter(right);
    result.rightIndex = { x: right[INDEX_TIP].x, y: right[INDEX_TIP].y };
  }

  if (!left && !right) {
    inVerdictZone = false;       // hands gone → reset zone state, cooldown clock keeps running
    return result;
  }
  if (!left || !right) {
    result.gesture = 'one-hand';
    inVerdictZone = false;
    return result;
  }

  // Both hands present — compute argument-tension + verdict candidacy.
  result.palmDistance = Math.hypot(
    result.leftPalm.x - result.rightPalm.x,
    result.leftPalm.y - result.rightPalm.y,
  );
  result.tension = 1 - Math.min(1, result.palmDistance / PALMS_FAR_DIST);

  const leftCenterDist = distanceTo(result.leftIndex, 0.5, 0.5);
  const rightCenterDist = distanceTo(result.rightIndex, 0.5, 0.5);
  const avgCenterDist = (leftCenterDist + rightCenterDist) / 2;
  // centerProximity: 1 at center, 0 at max-distance VERDICT_RADIUS×4 from center
  result.centerProximity = 1 - Math.min(1, avgCenterDist / (VERDICT_RADIUS * 4));

  const bothAtCenter = leftCenterDist < VERDICT_RADIUS && rightCenterDist < VERDICT_RADIUS;
  const now = performance.now();
  const cooledDown = now - lastVerdictMs > VERDICT_COOLDOWN_MS;

  if (bothAtCenter && !inVerdictZone && cooledDown) {
    // Rising edge — fire verdict once.
    result.verdictTriggered = true;
    inVerdictZone = true;
    lastVerdictMs = now;
    result.gesture = 'verdict';
  } else if (bothAtCenter) {
    inVerdictZone = true;
    result.gesture = 'verdict';
  } else {
    inVerdictZone = false;
    result.gesture = 'arguing';
  }

  return result;
}

registerPropRecognizer('tribunal', tribunalRecognizer);

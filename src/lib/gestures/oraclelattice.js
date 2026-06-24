// Oracle Lattice gesture recognizer.
//
// The Oracle's rigidity is the narrative point — zero idle motion. The only
// gesture surface is the adjudication trigger: palms come close together
// (distance < threshold) and then separate. On the rising edge of the
// separation, the lattice fires a single vertex-pulse wave.

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17];
const ADJUDICATE_THRESHOLD = 0.16; // palms-together threshold (normalized)

function palmCenter(hand) {
  let x = 0, y = 0;
  for (const i of PALM_INDICES) { x += hand[i].x; y += hand[i].y; }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

export function oracleLatticeRecognizer(landmarks) {
  const result = { leftPalm: null, rightPalm: null, palmsTogether: false, palmDistance: null };
  if (landmarks?.leftHand) result.leftPalm = palmCenter(landmarks.leftHand);
  if (landmarks?.rightHand) result.rightPalm = palmCenter(landmarks.rightHand);
  if (result.leftPalm && result.rightPalm) {
    const dx = result.leftPalm.x - result.rightPalm.x;
    const dy = result.leftPalm.y - result.rightPalm.y;
    result.palmDistance = Math.hypot(dx, dy);
    result.palmsTogether = result.palmDistance < ADJUDICATE_THRESHOLD;
  }
  return result;
}

registerPropRecognizer('oraclelattice', oracleLatticeRecognizer);

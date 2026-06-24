// Firewall HUD gesture recognizer.
//
// Single-hand pinch-drop. Tracks the thumb-index distance with hysteresis
// (closed under 0.04, open over 0.07) so pinch state doesn't flicker near
// the threshold. Reports rising-edges on both open→closed (pinchGrabbed)
// and closed→open (pinchReleased) so the glyph factory can hook spawn +
// drop transitions cleanly.
//
// Result shape:
//   {
//     gesture:        'idle' | 'open' | 'pinched',
//     palm:           { x, y } | null,
//     fingertip:      { x, y } | null,   // index-tip position, for spawn anchor
//     pinch:          'open' | 'closed',
//     pinchGrabbed:   boolean,            // rising-edge true on this frame
//     pinchReleased:  boolean,            // rising-edge true on this frame
//     hand:           'left' | 'right' | null,
//   }
//
// Sister recognizer to firewall.js (thumb-scale). Same hand-priority
// convention (left preferred); separate logic since pinch ≠ scale.

import { registerPropRecognizer } from '../gestureRecognizer.js';

const PALM_INDICES = [0, 5, 9, 13, 17];
const THUMB_TIP = 4;
const INDEX_TIP = 8;

// Hysteresis thresholds — closed below 0.04, open above 0.07. Anything
// between holds the previous state to suppress jitter.
const PINCH_CLOSED_THRESHOLD = 0.04;
const PINCH_OPEN_THRESHOLD = 0.07;

let pinchState = 'open';

function computePalmCenter(hand) {
  let x = 0;
  let y = 0;
  for (const i of PALM_INDICES) {
    x += hand[i].x;
    y += hand[i].y;
  }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
}

export function firewallhudRecognizer(landmarks) {
  const result = {
    gesture: 'idle',
    palm: null,
    fingertip: null,
    pinch: 'open',
    pinchGrabbed: false,
    pinchReleased: false,
    hand: null,
  };

  let hand = null;
  let handName = null;
  if (landmarks?.leftHand) {
    hand = landmarks.leftHand;
    handName = 'left';
  } else if (landmarks?.rightHand) {
    hand = landmarks.rightHand;
    handName = 'right';
  }

  if (!hand) {
    // Reset state on hand-loss so a returning hand starts fresh in 'open'.
    pinchState = 'open';
    return result;
  }

  result.palm = computePalmCenter(hand);
  result.fingertip = { x: hand[INDEX_TIP].x, y: hand[INDEX_TIP].y };
  result.hand = handName;

  const t = hand[THUMB_TIP];
  const i = hand[INDEX_TIP];
  const dist = Math.hypot(t.x - i.x, t.y - i.y);

  const wasClosed = pinchState === 'closed';
  let isClosed = wasClosed;
  if (wasClosed && dist > PINCH_OPEN_THRESHOLD) {
    isClosed = false;
  } else if (!wasClosed && dist < PINCH_CLOSED_THRESHOLD) {
    isClosed = true;
  }

  if (!wasClosed && isClosed) result.pinchGrabbed = true;
  if (wasClosed && !isClosed) result.pinchReleased = true;

  pinchState = isClosed ? 'closed' : 'open';
  result.pinch = pinchState;
  result.gesture = isClosed ? 'pinched' : 'open';

  return result;
}

registerPropRecognizer('firewallhud', firewallhudRecognizer);

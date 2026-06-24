// Light Skeptic glyph — ARES four-rule deterministic skeptic.
//
// BEAT 6, 8. Four white #FFFFFF rule dots arranged in a clockwise square
// on the anchor palm (R1 top-left → R2 top-right → R3 bottom-right →
// R4 bottom-left). The OTHER hand's index fingertip is the tester — it
// hits each dot in sequence, naming the four rules (authorization,
// benign-explanation, kill-chain-stage, default-floor).
//
// Geometric, rigid, white. The visual signature is "structure beats
// inference" — the lattice is small, simple, and emits a single 0.84
// confidence verdict when all four rules fire in order.
//
// State machine:
//   - touch sequence index = next expected rule (0..3)
//   - Each in-order touch fires a deterministic pip + advances index
//   - Out-of-order touch resets the index to 0 (but still pips on hit)
//   - On index advancing to 4, fire a "verdict" chime + flash the entire
//     lattice once, then reset index after a brief hold

import * as THREE from 'three';
import '../../lib/gestures/lightskeptic.js';
import { playLightSkepticTick, playLightSkepticVerdict } from '../../lib/audioPalettes.js';

const RULE_COLOR = 0xffffff;
const DOT_RADIUS = 0.022;
const SQUARE_HALF = 0.07;         // half-width of the four-dot square
const HIT_RADIUS_WORLD = 0.06;    // world-units proximity for index hits
const HOLD_AFTER_VERDICT = 0.9;   // seconds before re-arm

const STAGE_W = 1280, STAGE_H = 720, FOV_DEG = 50, CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

// Clockwise order from top-left.
const RULE_OFFSETS = [
  { x: -SQUARE_HALF, y:  SQUARE_HALF }, // R1 — authorization marker
  { x:  SQUARE_HALF, y:  SQUARE_HALF }, // R2 — benign explanation
  { x:  SQUARE_HALF, y: -SQUARE_HALF }, // R3 — kill chain stage low
  { x: -SQUARE_HALF, y: -SQUARE_HALF }, // R4 — default floor
];

export function createLightSkeptic({ scene }) {
  const group = new THREE.Group();
  const dots = RULE_OFFSETS.map((offset) => {
    const geom = new THREE.IcosahedronGeometry(DOT_RADIUS, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: RULE_COLOR,
      transparent: true,
      opacity: 0.85,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(offset.x, offset.y, 0);
    group.add(mesh);
    return { mesh, geom, mat, offset, glow: 0 };
  });

  // Connecting frame — thin white square so the four dots read as ONE
  // geometric object, not four floaters.
  const frameGeom = new THREE.BufferGeometry();
  const frameVerts = new Float32Array([
    RULE_OFFSETS[0].x, RULE_OFFSETS[0].y, 0, RULE_OFFSETS[1].x, RULE_OFFSETS[1].y, 0,
    RULE_OFFSETS[1].x, RULE_OFFSETS[1].y, 0, RULE_OFFSETS[2].x, RULE_OFFSETS[2].y, 0,
    RULE_OFFSETS[2].x, RULE_OFFSETS[2].y, 0, RULE_OFFSETS[3].x, RULE_OFFSETS[3].y, 0,
    RULE_OFFSETS[3].x, RULE_OFFSETS[3].y, 0, RULE_OFFSETS[0].x, RULE_OFFSETS[0].y, 0,
  ]);
  frameGeom.setAttribute('position', new THREE.BufferAttribute(frameVerts, 3));
  const frameMat = new THREE.LineBasicMaterial({
    color: RULE_COLOR,
    transparent: true,
    opacity: 0.35,
  });
  const frame = new THREE.LineSegments(frameGeom, frameMat);
  group.add(frame);

  scene.add(group);

  let nextRule = 0;                // 0..3 = next expected rule in sequence
  let lastHit = -1;                // last rule index that fired this frame (debounce)
  let verdictHold = 0;             // seconds remaining in post-verdict hold
  let verdictFlash = 0;            // 0..1 flash decay across all dots
  let lastFrameTime = performance.now() / 1000;

  function update(_landmarks, gesture) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - lastFrameTime);
    lastFrameTime = now;

    // Pick anchor + tester palm. Default: anchor = LEFT, tester = RIGHT.
    // Falls back to whichever single hand is in frame.
    let anchorPalm = null, testerIndex = null;
    if (gesture?.leftPalm) {
      anchorPalm = gesture.leftPalm;
      testerIndex = gesture.rightIndex || null;
    } else if (gesture?.rightPalm) {
      anchorPalm = gesture.rightPalm;
      testerIndex = gesture.leftIndex || null;
    }

    if (!anchorPalm) {
      group.visible = false;
      return;
    }
    group.visible = true;

    const world = normalizedToWorld(anchorPalm);
    group.position.set(world.x, world.y, 0);

    // Per-rule glow decay.
    for (const d of dots) d.glow = Math.max(0, d.glow - dt * 3.2);

    // Hit-test the tester index against each dot — only if not in
    // post-verdict hold + tester is actually in frame.
    if (verdictHold <= 0 && testerIndex) {
      const tw = normalizedToWorld(testerIndex);
      let hitIdx = -1;
      let bestD = HIT_RADIUS_WORLD;
      for (let i = 0; i < dots.length; i++) {
        const wx = world.x + dots[i].offset.x;
        const wy = world.y + dots[i].offset.y;
        const d = Math.hypot(tw.x - wx, tw.y - wy);
        if (d < bestD) { bestD = d; hitIdx = i; }
      }
      // Rising-edge per-dot debounce — only fire when we ENTER a new dot.
      if (hitIdx !== -1 && hitIdx !== lastHit) {
        dots[hitIdx].glow = 1.0;
        const inOrder = hitIdx === nextRule;
        playLightSkepticTick({ pitch: 1 + nextRule * 0.18, volume: 0.16 });
        if (inOrder) {
          nextRule += 1;
          if (nextRule >= 4) {
            // Sequence complete — verdict.
            verdictFlash = 1;
            verdictHold = HOLD_AFTER_VERDICT;
            playLightSkepticVerdict({ volume: 0.22 });
            nextRule = 0;
          }
        } else {
          nextRule = 0; // out-of-order resets the sequence
        }
      }
      lastHit = hitIdx;
    } else {
      lastHit = -1;
    }

    verdictHold = Math.max(0, verdictHold - dt);
    verdictFlash = Math.max(0, verdictFlash - dt * 1.6);

    // Apply visuals.
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      const baseOpacity = 0.85;
      d.mat.opacity = baseOpacity + d.glow * 0.15 + verdictFlash * 0.1;
      const scale = 1 + d.glow * 0.6 + verdictFlash * 0.45;
      d.mesh.scale.setScalar(scale);
    }
    frameMat.opacity = 0.35 + verdictFlash * 0.5;
  }

  function dispose() {
    scene.remove(group);
    for (const d of dots) { d.geom.dispose(); d.mat.dispose(); }
    frameGeom.dispose();
    frameMat.dispose();
  }

  return { update, dispose };
}

function normalizedToWorld({ x, y }) {
  return { x: (x - 0.5) * WORLD_WIDTH, y: -(y - 0.5) * WORLD_HEIGHT };
}

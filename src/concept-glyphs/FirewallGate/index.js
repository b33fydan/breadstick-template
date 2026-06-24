// Firewall Gate glyph — ARES regex-gate prop.
//
// Enacts ARES's Firewall invariant: inputs are screened by a regex rule.
// Matching tokens pass; non-matching get rejected. The Gate is a thin
// glowing wire-ring floating above the palm. On the v1 internal-timer
// reveal cycle (4s loop), the ring's geometry warps into a regex-pattern
// silhouette (modulated radius — bracket cuts + bar emphases), pulses
// green-pass or red-reject, then returns to dim cyan idle. The rule
// materializes only when tested.
//
// Side-effect import: pulls in src/lib/gestures/firewall.js, which
// registers the firewall recognizer with the central gestureRecognizer
// module.
//
// Gesture: single-hand thumb-scale → ring radius. Tighter pinch = smaller
// gate (stricter rule), wider open = larger gate (looser rule). Whichever
// hand is in frame wins; left preferred when both visible.
//
// Audio: playFirewallSnap fires once per reveal-cycle peak.
//
// v2 hook: when token-data flows from a Citation Wire ↔ Firewall continuity
// callback, the internal timer-driven reveal can be replaced with actual
// per-token pass/reject events.

import * as THREE from 'three';
import '../../lib/gestures/firewall.js';
import { playFirewallSnap } from '../../lib/audioPalettes.js';

const RING_RADIUS_BASE = 0.18;
const RING_FLOAT_OFFSET = 0.22;     // world-units above palm-center
const RING_SEGMENTS = 64;
const REVEAL_CYCLE_SEC = 4.0;        // full pattern-reveal + return
const PASS_COLOR = 0x4ade80;         // green-pass
const REJECT_COLOR = 0xef4444;       // red-reject
const IDLE_COLOR = 0x06b6d4;         // cyan idle (matches Cube's wireframe palette)

// World-mapping constants — must match conceptStage's camera (FOV 50°,
// camera z=3, aspect 1280/720).
const STAGE_W = 1280;
const STAGE_H = 720;
const FOV_DEG = 50;
const CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

export function createFirewallGate({ scene }) {
  const group = new THREE.Group();

  // Idle ring: perfect circle at RING_RADIUS_BASE, RING_SEGMENTS+1 verts
  // (last vertex closes the loop). Stored as a static reference buffer so
  // the per-frame morph can lerp toward it.
  const idlePositions = new Float32Array((RING_SEGMENTS + 1) * 3);
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const theta = (i / RING_SEGMENTS) * Math.PI * 2;
    idlePositions[i * 3 + 0] = Math.cos(theta) * RING_RADIUS_BASE;
    idlePositions[i * 3 + 1] = Math.sin(theta) * RING_RADIUS_BASE;
    idlePositions[i * 3 + 2] = 0;
  }

  // Pattern ring: same vertex count, but radius modulated by a sum of two
  // angular harmonics (cos 4θ + sin 6θ). Produces 4 "bracket cuts" and 6
  // "bar emphases" around the ring — reads as a stylized regex silhouette.
  const patternPositions = new Float32Array((RING_SEGMENTS + 1) * 3);
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const theta = (i / RING_SEGMENTS) * Math.PI * 2;
    const angleMod = Math.cos(theta * 4) * 0.25 + Math.sin(theta * 6) * 0.15;
    const r = RING_RADIUS_BASE * (1 + angleMod);
    patternPositions[i * 3 + 0] = Math.cos(theta) * r;
    patternPositions[i * 3 + 1] = Math.sin(theta) * r;
    patternPositions[i * 3 + 2] = 0;
  }

  // Current positions buffer — what the BufferGeometry actually renders.
  // Per-frame lerp blends idle/pattern via the morph parameter (0..1).
  const currentPositions = new Float32Array(idlePositions);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(currentPositions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: IDLE_COLOR,
    transparent: true,
    opacity: 0.85,
  });
  const ring = new THREE.Line(geom, mat);
  group.add(ring);

  // Inner ambient glow — translucent disc, smaller than ring, low opacity.
  // Sells the "gate has a 'through' state" feel (something passes through
  // the ring, not just past an outline).
  const innerGeom = new THREE.CircleGeometry(RING_RADIUS_BASE * 0.92, 32);
  const innerMat = new THREE.MeshBasicMaterial({
    color: IDLE_COLOR,
    transparent: true,
    opacity: 0.06,
    side: THREE.DoubleSide,
  });
  const inner = new THREE.Mesh(innerGeom, innerMat);
  group.add(inner);

  scene.add(group);

  let elapsed = 0;
  let lastFrameTime = performance.now() / 1000;
  let lastPulseCycle = -1; // which cycle index last fired the snap

  function update(_landmarks, gesture) {
    // dt accumulator independent of frame rate. Clamp big gaps so a paused
    // tab returning doesn't fast-forward the reveal cycle.
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - lastFrameTime);
    lastFrameTime = now;
    elapsed += dt;

    // Anchor to palm + float offset. No hand in frame → hide the gate.
    if (gesture?.palm) {
      const world = normalizedToWorld(gesture.palm);
      group.position.set(world.x, world.y + RING_FLOAT_OFFSET, 0);
      group.scale.setScalar(gesture.scale || 1);
      group.visible = true;
    } else {
      group.visible = false;
      return;
    }

    // Reveal cycle phases:
    //   0.00–0.20: idle  (morph=0, no pulse)
    //   0.20–0.50: warp to pattern  (morph 0→1 smoothstep)
    //   0.50–0.70: hold + pulse  (morph=1, sine pulse 0→1→0)
    //   0.70–1.00: morph back to idle  (morph 1→0 smoothstep)
    const cyclePos = (elapsed % REVEAL_CYCLE_SEC) / REVEAL_CYCLE_SEC;
    const cycleIndex = Math.floor(elapsed / REVEAL_CYCLE_SEC);

    let morph = 0;
    let pulse = 0;
    if (cyclePos < 0.2) {
      morph = 0;
    } else if (cyclePos < 0.5) {
      morph = smoothstep((cyclePos - 0.2) / 0.3);
    } else if (cyclePos < 0.7) {
      morph = 1;
      pulse = Math.sin(((cyclePos - 0.5) / 0.2) * Math.PI);
    } else {
      morph = 1 - smoothstep((cyclePos - 0.7) / 0.3);
    }

    // Lerp vertex positions
    for (let i = 0; i < currentPositions.length; i++) {
      currentPositions[i] = idlePositions[i] * (1 - morph) + patternPositions[i] * morph;
    }
    geom.attributes.position.needsUpdate = true;

    // Pass/reject cycling — 2-of-3 pass, 1-of-3 reject. Reads as a regex
    // that mostly allows valid input through, occasionally blocks bad input.
    const isPassCycle = cycleIndex % 3 !== 2;
    const baseColor = isPassCycle ? PASS_COLOR : REJECT_COLOR;
    if (pulse > 0.01) {
      mat.color.setHex(baseColor);
      mat.opacity = 0.85 + pulse * 0.15;
      innerMat.color.setHex(baseColor);
      innerMat.opacity = 0.06 + pulse * 0.18;
    } else {
      mat.color.setHex(IDLE_COLOR);
      mat.opacity = 0.85;
      innerMat.color.setHex(IDLE_COLOR);
      innerMat.opacity = 0.06;
    }

    // Fire audio snap once per cycle at peak pulse. lastPulseCycle prevents
    // re-fire on the same cycle even if frame timing lands in 0.50–0.55 twice.
    if (cyclePos >= 0.5 && cyclePos < 0.55 && cycleIndex !== lastPulseCycle) {
      playFirewallSnap({ volume: 0.22 });
      lastPulseCycle = cycleIndex;
    }
  }

  function dispose() {
    scene.remove(group);
    geom.dispose();
    mat.dispose();
    innerGeom.dispose();
    innerMat.dispose();
  }

  return { update, dispose };
}

function smoothstep(t) {
  const tc = Math.max(0, Math.min(1, t));
  return tc * tc * (3 - 2 * tc);
}

function normalizedToWorld({ x, y }) {
  return {
    x: (x - 0.5) * WORLD_WIDTH,
    y: -(y - 0.5) * WORLD_HEIGHT,
  };
}

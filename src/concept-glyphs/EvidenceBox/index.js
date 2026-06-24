// Evidence Box glyph — ARES locked-evidence visualization (Packet Binding).
//
// BEAT 2, 3, 6, 8. The core teaching prop. Twelve white Fact-dots arranged
// inside a cyan #00ACC1 wireframe shell, all anchored to the LEFT palm.
// The shell is the SHA seal — "you can't add evidence after the fact."
//
// Right-hand index fingertip is the "claim pointer":
//   - Inside the test volume AND near a dot → VALID. Cube pulses cyan,
//     the touched dot brightens, valid chime fires.
//   - Inside the test volume AND not near any dot → INVALID. The cyan
//     shell flashes RED, reject snap fires. ("schema violation —
//     message rejected.")
//   - Outside the test volume → idle, no audio, no flash.
//
// Each event fires on rising edge — moving between two dots fires once;
// hovering on a single dot does not re-fire. Leaving and re-entering the
// volume re-arms the recognizer.

import * as THREE from 'three';
import '../../lib/gestures/evidencebox.js';
import { playEvidenceValid, playEvidenceReject } from '../../lib/audioPalettes.js';

const SHELL_COLOR = 0x00acc1;
const DOT_COLOR = 0xffffff;
const REJECT_COLOR = 0xff5252;
const BOX_HALF = 0.13;           // half-edge length of the cubic shell
const DOT_RADIUS = 0.012;
const HIT_RADIUS_WORLD = 0.045;  // index-near-dot threshold in world units
const TEST_VOLUME_HALF = 0.18;   // box extended slightly = test volume
const VALID_FLASH_DECAY = 1.6;
const REJECT_FLASH_DECAY = 1.4;

const STAGE_W = 1280, STAGE_H = 720, FOV_DEG = 50, CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

// Deterministic 12-dot layout — stratified, no clipping into the shell walls.
// Generated once at module load so dot positions stay stable between mounts.
const DOT_POSITIONS = generateFactPositions(12, BOX_HALF * 0.78);

function generateFactPositions(count, bound) {
  // Simple low-discrepancy distribution: walk the unit cube along a 3D
  // halton-ish sequence so the 12 facts don't visibly cluster.
  const positions = [];
  let seed = 0.123;
  for (let i = 0; i < count; i++) {
    seed = (seed * 1597 + 0.731) % 1;
    const x = (seed - 0.5) * 2;
    seed = (seed * 1597 + 0.731) % 1;
    const y = (seed - 0.5) * 2;
    seed = (seed * 1597 + 0.731) % 1;
    const z = (seed - 0.5) * 2;
    positions.push({ x: x * bound, y: y * bound, z: z * bound });
  }
  return positions;
}

export function createEvidenceBox({ scene }) {
  const group = new THREE.Group();

  // Cubic wireframe shell — the SHA seal.
  const boxGeom = new THREE.BoxGeometry(BOX_HALF * 2, BOX_HALF * 2, BOX_HALF * 2);
  const boxEdges = new THREE.EdgesGeometry(boxGeom);
  const shellMat = new THREE.LineBasicMaterial({
    color: SHELL_COLOR,
    transparent: true,
    opacity: 0.78,
  });
  const shell = new THREE.LineSegments(boxEdges, shellMat);
  group.add(shell);

  // Inner ambient glow — barely visible solid translucent box. Sells "sealed."
  const innerGeom = new THREE.BoxGeometry(BOX_HALF * 1.92, BOX_HALF * 1.92, BOX_HALF * 1.92);
  const innerMat = new THREE.MeshBasicMaterial({
    color: SHELL_COLOR,
    transparent: true,
    opacity: 0.06,
  });
  const innerMesh = new THREE.Mesh(innerGeom, innerMat);
  group.add(innerMesh);

  // 12 Fact-dots.
  const dots = DOT_POSITIONS.map((pos) => {
    const geom = new THREE.IcosahedronGeometry(DOT_RADIUS, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: DOT_COLOR,
      transparent: true,
      opacity: 0.88,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    group.add(mesh);
    return { mesh, geom, mat, pos, glow: 0 };
  });

  scene.add(group);

  let validFlash = 0;     // 0..1 — global cube cyan pulse on valid event
  let rejectFlash = 0;    // 0..1 — global shell red flash on invalid event
  let lastEvent = 'none'; // 'valid' | 'invalid' | 'none'
  let lastValidDot = -1;  // last dot we fired 'valid' for
  let lastFrameTime = performance.now() / 1000;

  function update(_landmarks, gesture) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - lastFrameTime);
    lastFrameTime = now;

    // Anchor preference: LEFT for the evidence box (matches all four beats).
    // If only RIGHT in frame, anchor there and swap the tester to LEFT index.
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
      lastEvent = 'none';
      lastValidDot = -1;
      return;
    }
    group.visible = true;

    const world = normalizedToWorld(anchorPalm);
    group.position.set(world.x, world.y, 0);

    // Index hit-test against test volume + dots.
    if (testerIndex) {
      const tw = normalizedToWorld(testerIndex);
      const localX = tw.x - world.x;
      const localY = tw.y - world.y;
      // We don't have z from MediaPipe in 2D; treat the index as on the
      // same z-plane as the palm. Sufficient for the choreography since
      // The operator's index points AT the box from camera-side anyway.
      const insideVolume =
        Math.abs(localX) <= TEST_VOLUME_HALF &&
        Math.abs(localY) <= TEST_VOLUME_HALF;

      let nearestDot = -1;
      let nearestD = HIT_RADIUS_WORLD;
      for (let i = 0; i < dots.length; i++) {
        const d = Math.hypot(localX - dots[i].pos.x, localY - dots[i].pos.y);
        if (d < nearestD) { nearestD = d; nearestDot = i; }
      }

      if (insideVolume) {
        if (nearestDot !== -1) {
          // Valid — only fire when entering a NEW dot (rising edge).
          if (lastEvent !== 'valid' || lastValidDot !== nearestDot) {
            validFlash = 1;
            dots[nearestDot].glow = 1.0;
            playEvidenceValid({ volume: 0.18 });
            lastEvent = 'valid';
            lastValidDot = nearestDot;
          }
        } else {
          if (lastEvent !== 'invalid') {
            rejectFlash = 1;
            playEvidenceReject({ volume: 0.24 });
            lastEvent = 'invalid';
            lastValidDot = -1;
          }
        }
      } else {
        // Index left the test volume → re-arm.
        lastEvent = 'none';
        lastValidDot = -1;
      }
    } else {
      lastEvent = 'none';
      lastValidDot = -1;
    }

    // Decay flash channels + per-dot glow.
    validFlash = Math.max(0, validFlash - dt * VALID_FLASH_DECAY);
    rejectFlash = Math.max(0, rejectFlash - dt * REJECT_FLASH_DECAY);
    for (const d of dots) d.glow = Math.max(0, d.glow - dt * 1.8);

    // Apply visuals.
    // Shell colour: lerp between SHELL_COLOR and REJECT_COLOR by rejectFlash.
    const baseShell = new THREE.Color(SHELL_COLOR);
    const reject = new THREE.Color(REJECT_COLOR);
    const blended = baseShell.clone().lerp(reject, rejectFlash);
    shellMat.color.copy(blended);
    shellMat.opacity = 0.78 + validFlash * 0.22 + rejectFlash * 0.22;
    innerMat.color.copy(blended);
    innerMat.opacity = 0.06 + validFlash * 0.05 + rejectFlash * 0.12;

    for (const d of dots) {
      d.mat.opacity = 0.88 + d.glow * 0.12;
      d.mesh.scale.setScalar(1 + d.glow * 1.1);
    }
  }

  function dispose() {
    scene.remove(group);
    boxGeom.dispose();
    boxEdges.dispose();
    shellMat.dispose();
    innerGeom.dispose();
    innerMat.dispose();
    for (const d of dots) { d.geom.dispose(); d.mat.dispose(); }
  }

  return { update, dispose };
}

function normalizedToWorld({ x, y }) {
  return { x: (x - 0.5) * WORLD_WIDTH, y: -(y - 0.5) * WORLD_HEIGHT };
}

// Drift Dial glyph — ARES first negative result (two-hand altitude dial).
//
// BEAT 4. Two small wisps, one per palm:
//   - LEFT wisp = ACCURACY. Amber #FFB300 at chest level (y ≈ 0.5);
//     drift downward → color lerps to red #FF5252. "Wrong answer falling."
//   - RIGHT wisp = CONFIDENCE. Amber at chest level; drift UPWARD →
//     color lerps to red. "Sure of itself, climbing."
//
// Opposite-direction altitude is the punchline: red-left-low +
// red-right-high = the failure mode. When both wisps hit deep red and
// converge in the wrong-and-confident region, a faint "convergence
// halo" pulses around the prop — visual hook for the convergence beat.

import * as THREE from 'three';
import '../../lib/gestures/driftdial.js';
import { playDriftConvergence } from '../../lib/audioPalettes.js';

const AMBER = new THREE.Color(0xffb300);
const RED = new THREE.Color(0xff5252);

const PER_WISP_COUNT = 22;
const PARTICLE_SIZE = 0.014;
const WISP_RADIUS = 0.085;
const CONVERGE_HOLD = 0.6;          // seconds in red+red before halo fires
const NEUTRAL_Y = 0.5;              // chest level — start of dial
const DRIFT_HALF_RANGE = 0.32;       // y-distance from neutral for full red

const STAGE_W = 1280, STAGE_H = 720, FOV_DEG = 50, CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

function buildWisp(scene, rotationSign) {
  const group = new THREE.Group();
  const particles = [];
  for (let i = 0; i < PER_WISP_COUNT; i++) {
    const geom = new THREE.IcosahedronGeometry(PARTICLE_SIZE, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: AMBER.clone(),
      transparent: true,
      opacity: 0.82,
    });
    const mesh = new THREE.Mesh(geom, mat);
    group.add(mesh);
    particles.push({
      mesh, geom, mat,
      orbitAngle: Math.random() * Math.PI * 2,
      orbitSpeed: rotationSign * 0.7 * (0.7 + Math.random() * 0.6),
      orbitRadius: WISP_RADIUS * (0.45 + Math.random() * 0.65),
      yPhase: Math.random() * Math.PI * 2,
      zPhase: Math.random() * Math.PI * 2,
    });
  }
  scene.add(group);
  return { group, particles };
}

function buildHalo(scene) {
  const halo = new THREE.Group();
  const geom = new THREE.TorusGeometry(0.22, 0.005, 8, 48);
  const mat = new THREE.LineBasicMaterial({
    color: RED.getHex(),
    transparent: true,
    opacity: 0,
  });
  const edges = new THREE.EdgesGeometry(geom);
  const torus = new THREE.LineSegments(edges, mat);
  halo.add(torus);
  scene.add(halo);
  return { halo, mat, geom, edges, torus };
}

export function createDriftDial({ scene }) {
  const leftWisp = buildWisp(scene, +1);
  const rightWisp = buildWisp(scene, -1);
  const halo = buildHalo(scene);

  let convergeTimer = 0;
  let haloPulse = 0;
  let lastFrameTime = performance.now() / 1000;

  function update(_landmarks, gesture) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - lastFrameTime);
    lastFrameTime = now;

    const leftActive = !!gesture?.leftPalm;
    const rightActive = !!gesture?.rightPalm;
    leftWisp.group.visible = leftActive;
    rightWisp.group.visible = rightActive;

    if (!leftActive && !rightActive) {
      halo.halo.visible = false;
      convergeTimer = 0;
      haloPulse = 0;
      return;
    }
    halo.halo.visible = true;

    // Compute drift values: 0 = amber/neutral, 1 = full red/extreme.
    let leftDrift = 0, rightDrift = 0;
    if (leftActive) {
      // Drop = positive y delta from neutral.
      leftDrift = clamp01((gesture.leftAltitude - NEUTRAL_Y) / DRIFT_HALF_RANGE);
    }
    if (rightActive) {
      // Rise = negative y delta from neutral.
      rightDrift = clamp01((NEUTRAL_Y - gesture.rightAltitude) / DRIFT_HALF_RANGE);
    }

    // Anchor each wisp + animate.
    if (leftActive) updateWisp(leftWisp, normalizedToWorld(gesture.leftPalm), leftDrift, dt);
    if (rightActive) updateWisp(rightWisp, normalizedToWorld(gesture.rightPalm), rightDrift, dt);

    // Convergence: both wisps deep red. Halo centers between palms.
    const bothRed = leftDrift > 0.85 && rightDrift > 0.85;
    if (bothRed) convergeTimer += dt;
    else convergeTimer = Math.max(0, convergeTimer - dt * 1.5);

    if (convergeTimer > CONVERGE_HOLD && haloPulse < 0.1) {
      haloPulse = 1.0;
      playDriftConvergence({ volume: 0.18 });
    }
    haloPulse = Math.max(0, haloPulse - dt * 0.7);

    if (leftActive && rightActive) {
      const lw = normalizedToWorld(gesture.leftPalm);
      const rw = normalizedToWorld(gesture.rightPalm);
      halo.halo.position.set((lw.x + rw.x) / 2, (lw.y + rw.y) / 2, 0);
      halo.halo.scale.setScalar(0.7 + haloPulse * 0.6);
      halo.mat.opacity = haloPulse * 0.85;
    } else {
      halo.mat.opacity = 0;
    }
  }

  function updateWisp(wisp, anchor, drift, dt) {
    const color = AMBER.clone().lerp(RED, drift);
    for (const p of wisp.particles) {
      p.orbitAngle += p.orbitSpeed * dt;
      const r = p.orbitRadius;
      p.mesh.position.set(
        anchor.x + Math.cos(p.orbitAngle) * r,
        anchor.y + Math.sin(p.orbitAngle * 1.2 + p.yPhase) * r * 0.7,
        Math.sin(p.orbitAngle * 0.55 + p.zPhase) * r * 0.45,
      );
      p.mat.color.copy(color);
      // As drift climbs, the cloud tightens — the dial reads "locked in."
      p.mesh.scale.setScalar(1 + drift * 0.25);
      p.mat.opacity = 0.82 + drift * 0.12;
    }
  }

  function dispose() {
    scene.remove(leftWisp.group);
    scene.remove(rightWisp.group);
    scene.remove(halo.halo);
    for (const p of leftWisp.particles) { p.geom.dispose(); p.mat.dispose(); }
    for (const p of rightWisp.particles) { p.geom.dispose(); p.mat.dispose(); }
    halo.geom.dispose();
    halo.edges.dispose();
    halo.mat.dispose();
  }

  return { update, dispose };
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function normalizedToWorld({ x, y }) {
  return { x: (x - 0.5) * WORLD_WIDTH, y: -(y - 0.5) * WORLD_HEIGHT };
}

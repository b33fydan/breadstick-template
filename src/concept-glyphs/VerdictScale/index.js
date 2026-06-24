// Verdict Scale glyph — Phase 3, prop #4.
//
// Enacts ARES's Deterministic Verdicts invariant: the Oracle Judge is a
// pure function. Same inputs → same outputs. A brass balance scale floats
// between the operator's palms; beam tilts with the left↔right palm angle.
// Tilt-direction changes fire a brass click; sustained-tilt events would
// emit verdict coins in a fuller v2.
//
// v1 scope:
// - Brass pillar + beam + two pans
// - Anchored at midpoint between palms
// - Beam tilts to match palm-vector angle
// - Brass click on tilt-direction crossing (rising/falling edge through 0)
// - Skip confidence orbs + verdict coin emission for v1 — they need
//   discrete drop gestures (pinch detect) and physics, which earns a v2

import * as THREE from 'three';
import '../../lib/gestures/scale.js';
import { playBrassClick } from '../../lib/audioPalettes.js';

const STAGE_W = 1280;
const STAGE_H = 720;
const FOV_DEG = 50;
const CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

const BRASS = 0xb87333;
const BRASS_GLOW = 0xfacc15;

export function createVerdictScale({ scene }) {
  const root = new THREE.Group();
  scene.add(root);

  const brassMat = new THREE.MeshBasicMaterial({
    color: BRASS,
    transparent: true,
    opacity: 0.92,
  });
  const panMat = new THREE.MeshBasicMaterial({
    color: BRASS,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: BRASS_GLOW,
    transparent: true,
    opacity: 0.18,
  });

  // Base pedestal — short fat cylinder
  const baseGeom = new THREE.CylinderGeometry(0.08, 0.1, 0.04, 16);
  const base = new THREE.Mesh(baseGeom, brassMat);
  base.position.y = -0.24;
  root.add(base);

  // Pillar — tall thin cylinder
  const pillarGeom = new THREE.CylinderGeometry(0.018, 0.022, 0.4, 12);
  const pillar = new THREE.Mesh(pillarGeom, brassMat);
  pillar.position.y = -0.02;
  root.add(pillar);

  // Pillar glow (subtle inner halo)
  const pillarGlowGeom = new THREE.CylinderGeometry(0.032, 0.036, 0.4, 12);
  const pillarGlow = new THREE.Mesh(pillarGlowGeom, glowMat);
  pillarGlow.position.y = -0.02;
  root.add(pillarGlow);

  // Beam group — rotates around Z at the pillar top
  const beamGroup = new THREE.Group();
  beamGroup.position.y = 0.2;
  root.add(beamGroup);

  // Beam itself — horizontal cylinder (created vertical, rotated 90°)
  const beamGeom = new THREE.CylinderGeometry(0.012, 0.012, 0.56, 8);
  const beam = new THREE.Mesh(beamGeom, brassMat);
  beam.rotation.z = Math.PI / 2;
  beamGroup.add(beam);

  // Two pans (left + right) — flat discs hanging from beam ends. Position
  // them along beam local-X; beam rotation tilts them naturally.
  const panGeom = new THREE.CircleGeometry(0.085, 24);
  const panRingGeom = new THREE.RingGeometry(0.082, 0.092, 32);

  const leftPan = new THREE.Mesh(panGeom, panMat);
  leftPan.position.x = -0.27;
  leftPan.position.y = -0.04;
  beamGroup.add(leftPan);
  const leftRing = new THREE.Mesh(panRingGeom, brassMat);
  leftRing.position.copy(leftPan.position);
  beamGroup.add(leftRing);

  const rightPan = new THREE.Mesh(panGeom, panMat);
  rightPan.position.x = 0.27;
  rightPan.position.y = -0.04;
  beamGroup.add(rightPan);
  const rightRing = new THREE.Mesh(panRingGeom, brassMat);
  rightRing.position.copy(rightPan.position);
  beamGroup.add(rightRing);

  // Pan suspension lines — thin vertical "ropes" from beam to each pan
  const ropeMat = new THREE.LineBasicMaterial({
    color: BRASS,
    transparent: true,
    opacity: 0.6,
  });
  const leftRopeGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.27, 0, 0),
    new THREE.Vector3(-0.27, -0.04, 0),
  ]);
  beamGroup.add(new THREE.Line(leftRopeGeom, ropeMat));
  const rightRopeGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0.27, 0, 0),
    new THREE.Vector3(0.27, -0.04, 0),
  ]);
  beamGroup.add(new THREE.Line(rightRopeGeom, ropeMat));

  // Smoothed tilt — exponential moving average so the beam doesn't jitter
  // with raw landmark noise. Brass click triggers on sign change of the
  // smoothed value crossing zero.
  let smoothedTilt = 0;
  let lastSign = 0;

  function update(_landmarks, gesture) {
    if (!gesture || !gesture.midpoint) {
      root.visible = false;
      return;
    }
    root.visible = true;
    const world = normalizedToWorld(gesture.midpoint);
    root.position.set(world.x, world.y, 0);

    // Clamp tilt so beam doesn't flip past vertical (looks broken).
    const targetTilt = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, gesture.tiltAngle || 0));
    smoothedTilt = smoothedTilt * 0.78 + targetTilt * 0.22;
    beamGroup.rotation.z = smoothedTilt;

    // Brass click on zero-crossing of smoothed tilt (the visual "click" of
    // the scale settling toward the other side).
    const sign = smoothedTilt > 0.05 ? 1 : smoothedTilt < -0.05 ? -1 : 0;
    if (sign !== 0 && sign !== lastSign) {
      playBrassClick({ pitch: sign > 0 ? 1.0 : 0.85 });
    }
    lastSign = sign;
  }

  function dispose() {
    scene.remove(root);
    baseGeom.dispose();
    pillarGeom.dispose();
    pillarGlowGeom.dispose();
    beamGeom.dispose();
    panGeom.dispose();
    panRingGeom.dispose();
    leftRopeGeom.dispose();
    rightRopeGeom.dispose();
    brassMat.dispose();
    panMat.dispose();
    glowMat.dispose();
    ropeMat.dispose();
  }

  return { update, dispose };
}

function normalizedToWorld({ x, y }) {
  return {
    x: (x - 0.5) * WORLD_WIDTH,
    y: -(y - 0.5) * WORLD_HEIGHT,
  };
}

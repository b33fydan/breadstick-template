// Skeptic Wisp glyph — ARES Skeptic LLM particle visualization.
//
// BEAT 0, 1, 3, 6. Magenta #E91E63 counter-rotating particle cloud
// anchored to a palm. Default anchor = RIGHT (per BEAT 1 — magenta right
// to Architect's left); falls back to LEFT if RIGHT not in frame. Cloud
// rotates COUNTER-clockwise — paired with Architect's clockwise sweep
// they read as opposed reasoners. Slightly looser cloud than Architect.
// Fist closure freezes orbit.
//
// Audio: silent. Mirror of ArchitectWisp.

import * as THREE from 'three';
import '../../lib/gestures/skepticwisp.js';

const SKEPTIC_COLOR = 0xe91e63;
const PARTICLE_COUNT = 42;
const PARTICLE_SIZE = 0.017;
const CLOUD_RADIUS = 0.15;       // slightly larger than Architect
const BREATH_AMPL = 0.10;
const BREATH_HZ = 0.42;          // slightly faster — the skeptic is restless
const ROTATION_SPEED = -0.55;    // counter-clockwise (negative)

const STAGE_W = 1280, STAGE_H = 720, FOV_DEG = 50, CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

export function createSkepticWisp({ scene }) {
  const group = new THREE.Group();
  const baseColor = new THREE.Color(SKEPTIC_COLOR);

  const particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const geom = new THREE.IcosahedronGeometry(PARTICLE_SIZE, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: baseColor.clone(),
      transparent: true,
      opacity: 0.78,
    });
    const mesh = new THREE.Mesh(geom, mat);
    group.add(mesh);
    particles.push({
      mesh, geom, mat,
      orbitAngle: Math.random() * Math.PI * 2,
      orbitSpeed: ROTATION_SPEED * (0.7 + Math.random() * 0.6),
      orbitRadius: CLOUD_RADIUS * (0.45 + Math.random() * 0.7),
      yPhase: Math.random() * Math.PI * 2,
      zPhase: Math.random() * Math.PI * 2,
      tilt: Math.random() * Math.PI,
    });
  }
  scene.add(group);

  let lastFrameTime = performance.now() / 1000;

  function update(_landmarks, gesture) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - lastFrameTime);
    lastFrameTime = now;

    // Anchor preference: RIGHT first, LEFT fallback. Matches BEAT 1.
    let anchor = null;
    let frozen = false;
    if (gesture?.rightPalm) {
      anchor = normalizedToWorld(gesture.rightPalm);
      frozen = !!gesture.rightFist;
    } else if (gesture?.leftPalm) {
      anchor = normalizedToWorld(gesture.leftPalm);
      frozen = !!gesture.leftFist;
    }

    if (!anchor) { group.visible = false; return; }
    group.visible = true;

    const breathT = performance.now() / 1000;
    const breath = frozen ? 1 : (1 + Math.sin(breathT * Math.PI * 2 * BREATH_HZ + Math.PI) * BREATH_AMPL);
    const stepDt = frozen ? 0 : dt;

    for (const p of particles) {
      p.orbitAngle += p.orbitSpeed * stepDt;
      const r = p.orbitRadius * breath;
      p.mesh.position.set(
        anchor.x + Math.cos(p.orbitAngle + p.tilt) * r,
        anchor.y + Math.sin(p.orbitAngle * 1.15 + p.yPhase) * r * 0.75,
        Math.sin(p.orbitAngle * 0.55 + p.zPhase) * r * 0.5,
      );
      p.mat.opacity = frozen ? 0.55 : 0.78;
    }
  }

  function dispose() {
    scene.remove(group);
    for (const p of particles) { p.geom.dispose(); p.mat.dispose(); }
  }

  return { update, dispose };
}

function normalizedToWorld({ x, y }) {
  return { x: (x - 0.5) * WORLD_WIDTH, y: -(y - 0.5) * WORLD_HEIGHT };
}

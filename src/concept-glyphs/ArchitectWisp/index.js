// Architect Wisp glyph — ARES Architect particle visualization.
//
// BEAT 0, 1, 3, 4. Amber #FFB300 breathing particle cloud anchored to a
// palm. Default anchor = LEFT (per BEAT 1 — amber left, magenta right);
// falls back to RIGHT if LEFT not in frame. The cloud rotates clockwise
// (counter-rotates against the Skeptic). Fist closure freezes orbital
// motion — used in BEAT 0's "system can see the lie" beat.
//
// Side-effect import: pulls in src/lib/gestures/architectwisp.js, which
// registers the architectwisp recognizer with gestureRecognizer.
//
// Audio: silent. The wisp is companion-prop visual texture, not a
// causal trigger surface. Audio cues come from neighboring props on
// the same beat.

import * as THREE from 'three';
import '../../lib/gestures/architectwisp.js';

const ARCHITECT_COLOR = 0xffb300;
const PARTICLE_COUNT = 38;
const PARTICLE_SIZE = 0.016;
const CLOUD_RADIUS = 0.13;
const BREATH_AMPL = 0.08;          // ±8% size pulse on breath
const BREATH_HZ = 0.35;            // ~3s per breath cycle
const ROTATION_SPEED = 0.55;        // rad/s clockwise (positive)

const STAGE_W = 1280, STAGE_H = 720, FOV_DEG = 50, CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

export function createArchitectWisp({ scene }) {
  const group = new THREE.Group();
  const baseColor = new THREE.Color(ARCHITECT_COLOR);

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
      orbitRadius: CLOUD_RADIUS * (0.4 + Math.random() * 0.7),
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

    // Anchor preference: LEFT first, RIGHT fallback. Matches BEAT 1 default.
    let anchor = null;
    let frozen = false;
    if (gesture?.leftPalm) {
      anchor = normalizedToWorld(gesture.leftPalm);
      frozen = !!gesture.leftFist;
    } else if (gesture?.rightPalm) {
      anchor = normalizedToWorld(gesture.rightPalm);
      frozen = !!gesture.rightFist;
    }

    if (!anchor) {
      group.visible = false;
      return;
    }
    group.visible = true;

    // Breath pulse — only animates when not frozen.
    const breathT = performance.now() / 1000;
    const breath = frozen ? 1 : (1 + Math.sin(breathT * Math.PI * 2 * BREATH_HZ) * BREATH_AMPL);
    const stepDt = frozen ? 0 : dt;

    for (const p of particles) {
      p.orbitAngle += p.orbitSpeed * stepDt;
      const r = p.orbitRadius * breath;
      p.mesh.position.set(
        anchor.x + Math.cos(p.orbitAngle + p.tilt) * r,
        anchor.y + Math.sin(p.orbitAngle * 1.2 + p.yPhase) * r * 0.7,
        Math.sin(p.orbitAngle * 0.6 + p.zPhase) * r * 0.45,
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

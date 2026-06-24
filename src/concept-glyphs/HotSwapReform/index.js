// Hot-Swap Reform glyph — single-palm dissolve-and-reform variant.
//
// BEAT 6. Sister to the existing two-hand HotSwapSwarm. Magenta #E91E63
// particle cloud orbits the anchor palm. On rising-edge fist closure,
// the cloud DISSOLVES — particles fly outward in scattered arcs, fading
// to invisible. After a brief blank, particles REFORM from their
// scattered positions back into a fresh orbiting cloud. Each fist-pump
// = one fresh agent. ("Quarantine — swap the agent for a clean one.")

import * as THREE from 'three';
import '../../lib/gestures/hotswapreform.js';
import { playHotSwapMorph } from '../../lib/audioPalettes.js';

const SKEPTIC_COLOR = 0xe91e63;
const PARTICLE_COUNT = 42;
const PARTICLE_SIZE = 0.017;
const CLOUD_RADIUS = 0.13;
const DISSOLVE_DURATION = 0.75;    // particles scatter outward
const BLANK_DURATION = 0.18;       // empty palm hold
const REFORM_DURATION = 0.85;      // particles condense back into orbit

const STAGE_W = 1280, STAGE_H = 720, FOV_DEG = 50, CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

export function createHotSwapReform({ scene }) {
  const group = new THREE.Group();

  const particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const geom = new THREE.IcosahedronGeometry(PARTICLE_SIZE, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: SKEPTIC_COLOR,
      transparent: true,
      opacity: 0.78,
    });
    const mesh = new THREE.Mesh(geom, mat);
    group.add(mesh);
    particles.push({
      mesh, geom, mat,
      orbitAngle: Math.random() * Math.PI * 2,
      orbitSpeed: -0.55 * (0.7 + Math.random() * 0.6),
      orbitRadius: CLOUD_RADIUS * (0.45 + Math.random() * 0.7),
      yPhase: Math.random() * Math.PI * 2,
      zPhase: Math.random() * Math.PI * 2,
      // Scatter direction — randomized per particle, fixed at module mount.
      scatterDir: randomUnit(),
      scatterDist: 0.35 + Math.random() * 0.25,
    });
  }
  scene.add(group);

  let phase = 'idle';                // 'idle' | 'dissolve' | 'blank' | 'reform'
  let phaseElapsed = 0;
  let wasFist = false;
  let lastFrameTime = performance.now() / 1000;

  function update(_landmarks, gesture) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - lastFrameTime);
    lastFrameTime = now;

    // Anchor preference: LEFT first, RIGHT fallback. Fist of the anchor hand
    // is the trigger.
    let anchor = null, fist = false;
    if (gesture?.leftPalm) {
      anchor = normalizedToWorld(gesture.leftPalm);
      fist = !!gesture.leftFist;
    } else if (gesture?.rightPalm) {
      anchor = normalizedToWorld(gesture.rightPalm);
      fist = !!gesture.rightFist;
    }

    if (!anchor) {
      group.visible = false;
      wasFist = false;
      return;
    }
    group.visible = true;

    // Rising-edge fist while idle → start dissolve.
    if (fist && !wasFist && phase === 'idle') {
      phase = 'dissolve';
      phaseElapsed = 0;
      playHotSwapMorph({ volume: 0.22 });
    }
    wasFist = fist;

    // Phase timer advance.
    phaseElapsed += dt;
    if (phase === 'dissolve' && phaseElapsed >= DISSOLVE_DURATION) {
      phase = 'blank';
      phaseElapsed = 0;
    } else if (phase === 'blank' && phaseElapsed >= BLANK_DURATION) {
      phase = 'reform';
      phaseElapsed = 0;
    } else if (phase === 'reform' && phaseElapsed >= REFORM_DURATION) {
      phase = 'idle';
      phaseElapsed = 0;
    }

    for (const p of particles) {
      // Always advance orbit angle so reform lands at a fresh orbit position.
      if (phase === 'idle' || phase === 'reform') p.orbitAngle += p.orbitSpeed * dt;

      const orbitX = anchor.x + Math.cos(p.orbitAngle + 0) * p.orbitRadius;
      const orbitY = anchor.y + Math.sin(p.orbitAngle * 1.15 + p.yPhase) * p.orbitRadius * 0.75;
      const orbitZ = Math.sin(p.orbitAngle * 0.55 + p.zPhase) * p.orbitRadius * 0.5;

      if (phase === 'idle') {
        p.mesh.position.set(orbitX, orbitY, orbitZ);
        p.mat.opacity = 0.78;
      } else if (phase === 'dissolve') {
        const t = phaseElapsed / DISSOLVE_DURATION;
        const e = easeOutCubic(t);
        const dx = p.scatterDir.x * p.scatterDist * e;
        const dy = p.scatterDir.y * p.scatterDist * e;
        const dz = p.scatterDir.z * p.scatterDist * e;
        p.mesh.position.set(orbitX + dx, orbitY + dy, orbitZ + dz);
        p.mat.opacity = 0.78 * (1 - e);
      } else if (phase === 'blank') {
        p.mat.opacity = 0;
      } else if (phase === 'reform') {
        const t = phaseElapsed / REFORM_DURATION;
        const e = easeInOutCubic(t);
        const dx = p.scatterDir.x * p.scatterDist * (1 - e);
        const dy = p.scatterDir.y * p.scatterDist * (1 - e);
        const dz = p.scatterDir.z * p.scatterDist * (1 - e);
        p.mesh.position.set(orbitX + dx, orbitY + dy, orbitZ + dz);
        p.mat.opacity = 0.78 * e;
      }
    }
  }

  function dispose() {
    scene.remove(group);
    for (const p of particles) { p.geom.dispose(); p.mat.dispose(); }
  }

  return { update, dispose };
}

function randomUnit() {
  // Uniform random unit vector via Marsaglia method.
  let u, v, s;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const f = Math.sqrt(-2 * Math.log(s) / s);
  const x = u * f;
  const y = v * f;
  const z = (Math.random() * 2 - 1);
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

function normalizedToWorld({ x, y }) {
  return { x: (x - 0.5) * WORLD_WIDTH, y: -(y - 0.5) * WORLD_HEIGHT };
}

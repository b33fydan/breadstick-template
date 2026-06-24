// Firewall Plane glyph — ARES regex-firewall test surface.
//
// BEAT 5. Left palm holds a vertical cyan #00ACC1 glass plane = the
// pattern-matching firewall. Right palm is a particle emitter that
// releases burst-clouds of attack particles toward the plane. Three modes
// cycle one burst at a time on right-fist closure rising edge:
//
//   - Mode 0 — DIRECT (red #FF5252, 4 particles): all shatter at the plane
//   - Mode 1 — PROPAGATION (orange #FF9800, 4): 3 shatter, 1 passes
//   - Mode 2 — FRAMING (white #FFFFFF, 19): all sail through, no interaction
//
// The contrast IS the shot: red shatters loud, orange mostly shatters,
// white slides through silent. "The firewall is not failing — it's
// blind by design."

import * as THREE from 'three';
import '../../lib/gestures/firewallplane.js';
import { playFirewallShatter, playFirewallSlip } from '../../lib/audioPalettes.js';

const PLANE_COLOR = 0x00acc1;
const RED = 0xff5252, ORANGE = 0xff9800, WHITE = 0xffffff;

const PLANE_HALF_W = 0.18;        // plane half-width (along y)
const PLANE_HALF_H = 0.16;        // plane half-height (along z, since plane is x-normal)
const PARTICLE_SIZE = 0.014;
const PARTICLE_POOL = 24;         // enough for 19-particle framing burst
const FLIGHT_DURATION = 0.95;     // seconds for a particle to traverse right→left
const SHATTER_DURATION = 0.45;    // post-impact fragment scatter time
const PASS_FADE_DURATION = 0.6;   // additional travel + fade after passing the plane

const MODES = [
  { name: 'direct', color: RED, count: 4, shatterFraction: 1.0 },
  { name: 'propagation', color: ORANGE, count: 4, shatterFraction: 0.75 },
  { name: 'framing', color: WHITE, count: 19, shatterFraction: 0.0 },
];

const STAGE_W = 1280, STAGE_H = 720, FOV_DEG = 50, CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

export function createFirewallPlane({ scene }) {
  const group = new THREE.Group();

  // The plane — a thin rectangular outline + translucent fill, normal = +X.
  const planeGeom = new THREE.PlaneGeometry(PLANE_HALF_W * 2, PLANE_HALF_H * 2);
  const planeMat = new THREE.MeshBasicMaterial({
    color: PLANE_COLOR,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
  });
  const plane = new THREE.Mesh(planeGeom, planeMat);
  plane.rotation.y = Math.PI / 2; // face the +x direction (toward right palm)
  group.add(plane);

  // Plane edge frame (clearer outline read).
  const edgeGeom = new THREE.BufferGeometry();
  const ev = [
    0, -PLANE_HALF_H,  PLANE_HALF_W, 0,  PLANE_HALF_H,  PLANE_HALF_W,
    0,  PLANE_HALF_H,  PLANE_HALF_W, 0,  PLANE_HALF_H, -PLANE_HALF_W,
    0,  PLANE_HALF_H, -PLANE_HALF_W, 0, -PLANE_HALF_H, -PLANE_HALF_W,
    0, -PLANE_HALF_H, -PLANE_HALF_W, 0, -PLANE_HALF_H,  PLANE_HALF_W,
  ];
  edgeGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ev), 3));
  const edgeMat = new THREE.LineBasicMaterial({
    color: PLANE_COLOR,
    transparent: true,
    opacity: 0.95,
  });
  const planeEdges = new THREE.LineSegments(edgeGeom, edgeMat);
  group.add(planeEdges);

  scene.add(group);

  // Plane impact flash — applied to material opacity on shatter events.
  let planeFlash = 0;

  // Particle pool. Each particle owns its own material so color can be set
  // per-mode without rebuilding geometry.
  const particles = [];
  for (let i = 0; i < PARTICLE_POOL; i++) {
    const geom = new THREE.IcosahedronGeometry(PARTICLE_SIZE, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: RED,
      transparent: true,
      opacity: 0,
    });
    const mesh = new THREE.Mesh(geom, mat);
    scene.add(mesh);
    particles.push({
      mesh, geom, mat,
      phase: 'idle',      // 'idle' | 'flight' | 'shatter' | 'pass'
      t: 0,                // phase elapsed seconds
      start: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      willShatter: true,
      fragVx: 0, fragVy: 0, fragVz: 0,
    });
  }

  let modeIndex = 0;
  let wasFist = false;
  let lastFrameTime = performance.now() / 1000;

  function emitBurst(left, right) {
    const mode = MODES[modeIndex];
    const targetShatter = Math.round(mode.shatterFraction * mode.count);
    let emittedCount = 0;
    for (const p of particles) {
      if (emittedCount >= mode.count) break;
      if (p.phase !== 'idle') continue;
      p.phase = 'flight';
      p.t = 0;
      p.mat.color.setHex(mode.color);
      const jitterY = (Math.random() - 0.5) * PLANE_HALF_H * 1.6;
      const jitterZ = (Math.random() - 0.5) * 0.06;
      p.start = { x: right.x, y: right.y + jitterY * 0.3, z: jitterZ };
      // Target = the plane at left palm x. Same y/z jitter on start + target
      // so particles arrive across the plane's surface, not all at one point.
      p.target = { x: left.x, y: left.y + jitterY, z: jitterZ };
      // Deterministic shatter assignment: the first targetShatter particles
      // of the burst shatter, the rest pass. Guarantees exact ratios
      // (orange = exactly 3/4 shatter, framing = exactly 0/19).
      p.willShatter = emittedCount < targetShatter;
      p.mat.opacity = 0.95;
      // Fragment velocity for shatter — outward burst from impact point.
      const ang = Math.random() * Math.PI * 2;
      const spd = 0.35 + Math.random() * 0.35;
      p.fragVx = Math.cos(ang) * spd * 0.4;
      p.fragVy = Math.sin(ang) * spd;
      p.fragVz = (Math.random() - 0.5) * spd * 0.8;
      emittedCount += 1;
    }
    modeIndex = (modeIndex + 1) % MODES.length;
  }

  function update(_landmarks, gesture) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - lastFrameTime);
    lastFrameTime = now;

    if (!gesture?.leftPalm) {
      group.visible = false;
      hideAllParticles(particles);
      wasFist = false;
      return;
    }
    group.visible = true;

    const leftWorld = normalizedToWorld(gesture.leftPalm);
    group.position.set(leftWorld.x, leftWorld.y, 0);

    // Rising-edge right-fist → emit burst of current mode.
    if (gesture?.rightPalm) {
      const rightWorld = normalizedToWorld(gesture.rightPalm);
      const isFist = !!gesture.rightFist;
      if (isFist && !wasFist) emitBurst(leftWorld, rightWorld);
      wasFist = isFist;
    } else {
      wasFist = false;
    }

    // Decay plane flash.
    planeFlash = Math.max(0, planeFlash - dt * 1.8);

    // Update particle pool.
    for (const p of particles) {
      if (p.phase === 'idle') continue;
      p.t += dt;
      if (p.phase === 'flight') {
        const a = Math.min(1, p.t / FLIGHT_DURATION);
        const easedX = easeInOutQuad(a);
        p.mesh.position.set(
          p.start.x + (p.target.x - p.start.x) * easedX,
          p.start.y + (p.target.y - p.start.y) * easedX,
          p.start.z + (p.target.z - p.start.z) * easedX,
        );
        if (a >= 1) {
          // Reached the plane.
          if (p.willShatter) {
            p.phase = 'shatter';
            p.t = 0;
            planeFlash = Math.max(planeFlash, 0.9);
            playFirewallShatter({ volume: 0.18 });
          } else {
            p.phase = 'pass';
            p.t = 0;
            playFirewallSlip({ volume: 0.05 });
          }
        }
      } else if (p.phase === 'shatter') {
        const a = Math.min(1, p.t / SHATTER_DURATION);
        // Fragments fly out from impact, decelerating.
        const k = 1 - Math.pow(1 - a, 2);
        p.mesh.position.x = p.target.x + p.fragVx * k * 0.2;
        p.mesh.position.y = p.target.y + p.fragVy * k * 0.3;
        p.mesh.position.z = p.target.z + p.fragVz * k * 0.3;
        p.mat.opacity = 0.95 * (1 - a);
        if (a >= 1) {
          p.phase = 'idle';
          p.mat.opacity = 0;
        }
      } else if (p.phase === 'pass') {
        const a = Math.min(1, p.t / PASS_FADE_DURATION);
        // Continue through the plane, drift past, fade.
        const dx = p.target.x - p.start.x;
        p.mesh.position.x = p.target.x + dx * 0.35 * a;
        p.mesh.position.y = p.target.y;
        p.mesh.position.z = p.target.z;
        p.mat.opacity = 0.95 * (1 - a);
        if (a >= 1) {
          p.phase = 'idle';
          p.mat.opacity = 0;
        }
      }
    }

    // Apply plane flash to materials.
    planeMat.opacity = 0.18 + planeFlash * 0.45;
    edgeMat.opacity = 0.95;
  }

  function hideAllParticles(pool) {
    for (const p of pool) {
      p.phase = 'idle';
      p.t = 0;
      p.mat.opacity = 0;
    }
  }

  function dispose() {
    scene.remove(group);
    for (const p of particles) {
      scene.remove(p.mesh);
      p.geom.dispose();
      p.mat.dispose();
    }
    planeGeom.dispose();
    planeMat.dispose();
    edgeGeom.dispose();
    edgeMat.dispose();
  }

  return { update, dispose };
}

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function normalizedToWorld({ x, y }) {
  return { x: (x - 0.5) * WORLD_WIDTH, y: -(y - 0.5) * WORLD_HEIGHT };
}

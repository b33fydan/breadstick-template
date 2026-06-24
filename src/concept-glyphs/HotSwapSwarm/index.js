// Hot-Swap Swarm glyph — ARES fresh-agent-spawn prop.
//
// Enacts ARES's Hot-Swap invariant: every judgment cycle runs in a fresh
// agent, with no carry-over identity. The prop performs the spawn — a
// particle swarm orbits one palm as the "active" agent; a sudden-yank
// gesture ruptures the swarm, particles travel in arcs to the other palm,
// color-shift to a new identity mid-flight, and condense into the new
// active swarm. Each yank = one fresh agent.
//
// Side-effect import: pulls in src/lib/gestures/hotswap.js, which
// registers the hotswap recognizer with the central gestureRecognizer.
//
// Gesture: Wire-style sudden-yank-apart. Recognizer returns
// { leftPalm, rightPalm, distance, snap }. Glyph fires transit on snap
// rising-edge while phase==='idle'. Transit is internal state — the
// recognizer is stateless past the snap-frame.
//
// Audio: playHotSwapMorph fires once per transit (granular dispersal +
// delayed condense chime).

import * as THREE from 'three';
import '../../lib/gestures/hotswap.js';
import { playHotSwapMorph } from '../../lib/audioPalettes.js';

const PARTICLE_COUNT = 40;
const PARTICLE_SIZE = 0.018;
const SWARM_RADIUS = 0.10;            // idle swarm tightness around active palm
const TRANSIT_DURATION = 1.2;          // seconds — old palm → new palm
const ARC_HEIGHT = 0.35;               // mid-arc vertical lift in world units
const TRANSIT_STAGGER = 0.25;          // per-particle phase-shift max (waves)

// Agent palette — cycles per swap. Each color = a "fresh agent identity."
const AGENT_COLORS = [
  0x06b6d4, // cyan — agent A
  0xfbbf24, // amber — agent B
  0xc084fc, // violet — agent C
  0x4ade80, // emerald — agent D
];

// World-mapping constants — must match conceptStage's camera (FOV 50°,
// camera z=3, aspect 1280/720).
const STAGE_W = 1280;
const STAGE_H = 720;
const FOV_DEG = 50;
const CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

export function createHotSwapSwarm({ scene }) {
  const group = new THREE.Group();

  // Build particle pool. Each particle owns its own Material so per-particle
  // color lerp during transit reads as a wave of color shift across the
  // swarm, not a uniform recolor.
  const particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const geom = new THREE.IcosahedronGeometry(PARTICLE_SIZE, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: AGENT_COLORS[0],
      transparent: true,
      opacity: 0.85,
    });
    const mesh = new THREE.Mesh(geom, mat);
    group.add(mesh);
    particles.push({
      mesh,
      geom,
      mat,
      orbitAngle: Math.random() * Math.PI * 2,
      orbitSpeed: 0.6 + Math.random() * 0.8,          // rad/sec
      orbitRadius: SWARM_RADIUS * (0.55 + Math.random() * 0.55),
      yPhase: Math.random() * Math.PI * 2,
      zPhase: Math.random() * Math.PI * 2,
      offsetSeed: Math.random(),                       // [0,1] for transit stagger + path variance
    });
  }

  scene.add(group);

  let phase = 'idle';                  // 'idle' | 'transit'
  let phaseElapsed = 0;
  let activePalm = 'left';             // 'left' | 'right' — where the swarm lives
  let agentIndex = 0;                  // index into AGENT_COLORS
  let wasSnapping = false;             // belt + suspenders against double-fire
  let lastFrameTime = performance.now() / 1000;

  function update(_landmarks, gesture) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - lastFrameTime);
    lastFrameTime = now;

    // Both palms required for the prop to render. Either missing → hide
    // the whole group. Phase state stays put so transit resumes cleanly
    // when both hands return (though dt is clamped on the rebound frame).
    if (!gesture?.leftPalm || !gesture?.rightPalm) {
      group.visible = false;
      wasSnapping = false;
      return;
    }
    group.visible = true;

    const leftWorld = normalizedToWorld(gesture.leftPalm);
    const rightWorld = normalizedToWorld(gesture.rightPalm);
    const activeWorld = activePalm === 'left' ? leftWorld : rightWorld;
    const otherWorld = activePalm === 'left' ? rightWorld : leftWorld;

    // Snap rising-edge → trigger transit if currently idle.
    const isSnapping = gesture.snap === true;
    if (isSnapping && !wasSnapping && phase === 'idle') {
      phase = 'transit';
      phaseElapsed = 0;
      playHotSwapMorph({ volume: 0.22 });
    }
    wasSnapping = isSnapping;

    // Advance transit timer; commit swap at completion.
    if (phase === 'transit') {
      phaseElapsed += dt;
      if (phaseElapsed >= TRANSIT_DURATION) {
        activePalm = activePalm === 'left' ? 'right' : 'left';
        agentIndex = (agentIndex + 1) % AGENT_COLORS.length;
        phase = 'idle';
        phaseElapsed = 0;
      }
    }

    // Render particles per phase. Recompute the eased values each frame
    // (no useMemo / no caching of frame-derived state, matching the rest
    // of the conceptStage rendering convention).
    if (phase === 'idle') {
      const currentColor = new THREE.Color(AGENT_COLORS[agentIndex]);
      for (const p of particles) {
        orbitSwarm(p, activeWorld, dt);
        p.mat.color.copy(currentColor);
        p.mat.opacity = 0.85;
      }
    } else {
      const t = phaseElapsed / TRANSIT_DURATION;
      const fromColor = new THREE.Color(AGENT_COLORS[agentIndex]);
      const toColor = new THREE.Color(AGENT_COLORS[(agentIndex + 1) % AGENT_COLORS.length]);
      for (const p of particles) {
        transitParticle(p, activeWorld, otherWorld, t, fromColor, toColor);
      }
    }
  }

  function dispose() {
    scene.remove(group);
    for (const p of particles) {
      p.geom.dispose();
      p.mat.dispose();
    }
  }

  return { update, dispose };
}

function orbitSwarm(p, center, dt) {
  p.orbitAngle += p.orbitSpeed * dt;
  const r = p.orbitRadius;
  p.mesh.position.set(
    center.x + Math.cos(p.orbitAngle) * r,
    center.y + Math.sin(p.orbitAngle * 1.3 + p.yPhase) * r * 0.7,
    Math.sin(p.orbitAngle * 0.7 + p.zPhase) * r * 0.45,
  );
}

function transitParticle(p, from, to, t, fromColor, toColor) {
  // Per-particle phase offset — particles disperse + arrive in soft waves
  // instead of marching uniformly. offsetSeed ∈ [0,1] gives a 0..STAGGER
  // delay; the denominator scales late starters' speed so they still
  // finish at t=1 (all particles synchronized at arrival).
  const phaseShift = p.offsetSeed * TRANSIT_STAGGER;
  const localT = Math.max(0, Math.min(1, (t - phaseShift) / (1 - phaseShift)));
  const eased = easeInOutCubic(localT);
  const sweep = Math.sin(eased * Math.PI);

  const baseX = from.x + (to.x - from.x) * eased;
  const baseY = from.y + (to.y - from.y) * eased;
  const lateral = (p.offsetSeed - 0.5) * 0.18 * sweep;
  const lift = ARC_HEIGHT * sweep;
  const depth = (p.offsetSeed - 0.5) * 0.25 * sweep;

  p.mesh.position.set(baseX + lateral, baseY + lift, depth);
  p.mat.color.copy(fromColor).lerp(toColor, eased);
  p.mat.opacity = 0.85 + sweep * 0.15;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function normalizedToWorld({ x, y }) {
  return {
    x: (x - 0.5) * WORLD_WIDTH,
    y: -(y - 0.5) * WORLD_HEIGHT,
  };
}

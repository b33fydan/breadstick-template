// Topology Crystal glyph — ARES Evidence Grounding (graph-topology variant).
//
// Enacts: every claim traces back to a cited node or edge in the graph
// topology; ungrounded claims cannot render. Sister approach to Citation
// Wire, which uses a two-hand thread between a fact token and an assertion
// card. Topology Crystal lifts the same invariant into a multi-node graph
// — a structured constellation where every "agent claim" (reasoning node)
// must visibly tether to a specific evidence node via a golden beam.
//
// Side-effect import: pulls in src/lib/gestures/topologycrystal.js, which
// registers the topologycrystal recognizer with the central registry.
//
// State machine: idle → crystallizing → stable → demo → stable. Operator
// opens hand (state advances to crystallizing then stable); rolls wrist
// past 35° (state advances to demo); demo runs ~3.5s of rotation + edge
// pulses + reasoning-node drop + beams, then returns to stable.

import * as THREE from 'three';
import '../../lib/gestures/topologycrystal.js';
import {
  playTopologyCrystalSnap,
  playTopologyCrystalPulse,
  playTopologyCrystalBeam,
} from '../../lib/audioPalettes.js';

// Anchor offset above palm.
const FLOAT_OFFSET = 0.22;

// Lattice geometry — sized to match Phase Disc's footprint so a 10-node
// graph reads as legible structure, not "tiny dot above palm."
const LATTICE_RADIUS = 0.30;                  // sphere shell the nodes sit on, world units
const NODE_RADIUS = 0.038;
const PARTICLE_COUNT = 50;
const PARTICLE_RADIUS = 0.022;

// Reasoning nodes.
const REASONING_RADIUS = 0.044;
const REASONING_START_Y = 0.62;               // world units above lattice origin
const REASONING_DROP_DURATION = 0.5;          // seconds per node
const REASONING_DROP_STAGGER = 0.15;          // seconds between each node's drop

// Second-hand pointer. Index fingertip of the non-anchor hand casts a line
// to whichever lattice node is closest within range; target node brightens.
// Range is generous (≈half the frame diagonal) so operator can point from
// most positions on screen without losing the attachment.
const POINTER_MAX_RANGE = 1.8;                // world units; beyond this, no line
const POINTER_NODE_SCALE = 1.35;              // multiplier applied to highlighted node mesh

// Timing.
const CRYSTALLIZE_DURATION = 1.0;             // seconds
const DEMO_DURATION = 3.5;                    // seconds
const EDGE_PULSE_STAGGER = 0.18;              // seconds between successive edge fires
const EDGE_PULSE_DURATION = 0.55;             // seconds per edge pulse traversal
const BEAM_FADE_DURATION = 0.3;               // seconds for beam opacity ramp

// Color palette.
const COLOR_USER = 0x06b6d4;                  // cyan
const COLOR_PROCESS = 0xfbbf24;               // amber
const COLOR_FILE = 0xc084fc;                  // violet
const COLOR_ENDPOINT = 0x4ade80;              // green
const COLOR_REASONING = 0xfbbf24;             // gold (reasoning + beams)
const COLOR_EDGE = 0x6b7280;                  // dim gray for edge baseline
const COLOR_PARTICLE_HOT = 0xef4444;          // red chaos
const COLOR_PARTICLE_COLD = 0x6b7280;         // gray chaos

// World-mapping constants — must match conceptStage's camera (FOV 50°,
// camera z=3). Stage dimensions arrive via creator params (default 1280×720
// for backward compat; 9:16 callers pass 720×1280).
const DEFAULT_STAGE_W = 1280;
const DEFAULT_STAGE_H = 720;
const FOV_DEG = 50;
const CAMERA_Z = 3;

// Topology: 10 nodes on a Fibonacci-ish sphere shell.
//   u1, u2          → User    (cyan)
//   p1, p2, p3      → Process (amber)
//   f1, f2, f3      → File    (violet)
//   e1, e2          → Endpoint (green)
const NODE_DEFS = [
  { id: 'u1', color: COLOR_USER },
  { id: 'u2', color: COLOR_USER },
  { id: 'p1', color: COLOR_PROCESS },
  { id: 'p2', color: COLOR_PROCESS },
  { id: 'p3', color: COLOR_PROCESS },
  { id: 'f1', color: COLOR_FILE },
  { id: 'f2', color: COLOR_FILE },
  { id: 'f3', color: COLOR_FILE },
  { id: 'e1', color: COLOR_ENDPOINT },
  { id: 'e2', color: COLOR_ENDPOINT },
];

// 12 edges. Order in this array = the causal sequence fired during demo.
const EDGE_DEFS = [
  ['u1', 'p1'],
  ['u1', 'p2'],
  ['u2', 'p2'],
  ['p1', 'f1'],
  ['p1', 'e1'],
  ['p2', 'f2'],
  ['p2', 'f3'],
  ['f1', 'p3'],
  ['f3', 'p3'],
  ['p3', 'e2'],
  ['f2', 'e1'],
  ['p3', 'e1'],
];

// Reasoning nodes target specific evidence nodes — the visual claim that
// each agent reasoning step is grounded in a concrete piece of evidence.
const REASONING_DEFS = [
  { targetId: 'f2', label: 'HYPOTHESIZES file evidence' },
  { targetId: 'e1', label: 'HYPOTHESIZES endpoint evidence' },
  { targetId: 'p3', label: 'HYPOTHESIZES process evidence' },
];

export function createTopologyCrystal({ scene, stageW = DEFAULT_STAGE_W, stageH = DEFAULT_STAGE_H }) {
  const aspect = stageW / stageH;
  const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
  const WORLD_WIDTH = WORLD_HEIGHT * aspect;
  const normalizedToWorld = ({ x, y }) => ({
    x: (x - 0.5) * WORLD_WIDTH,
    y: -(y - 0.5) * WORLD_HEIGHT,
  });

  const group = new THREE.Group();
  scene.add(group);

  // ─── Node spheres ──────────────────────────────────────────────────
  const nodePositions = fibonacciSpherePoints(NODE_DEFS.length, LATTICE_RADIUS);
  const nodeById = {};
  const nodes = NODE_DEFS.map((def, idx) => {
    const geom = new THREE.IcosahedronGeometry(NODE_RADIUS, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: def.color,
      transparent: true,
      opacity: 0,                            // crystallize-in
    });
    const mesh = new THREE.Mesh(geom, mat);
    const pos = nodePositions[idx];
    mesh.position.set(pos.x, pos.y, pos.z);
    group.add(mesh);
    const node = { ...def, mesh, geom, mat, pos };
    nodeById[def.id] = node;
    return node;
  });

  // ─── Edges (LineSegments) ──────────────────────────────────────────
  // One BufferGeometry holds all edges; per-edge color via vertex colors
  // so we can brighten individual edges during the pulse pass without
  // rebuilding the buffer.
  const edgePositions = new Float32Array(EDGE_DEFS.length * 2 * 3);
  const edgeColors = new Float32Array(EDGE_DEFS.length * 2 * 3);
  const edges = EDGE_DEFS.map(([fromId, toId], i) => {
    const from = nodeById[fromId];
    const to = nodeById[toId];
    edgePositions[i * 6 + 0] = from.pos.x;
    edgePositions[i * 6 + 1] = from.pos.y;
    edgePositions[i * 6 + 2] = from.pos.z;
    edgePositions[i * 6 + 3] = to.pos.x;
    edgePositions[i * 6 + 4] = to.pos.y;
    edgePositions[i * 6 + 5] = to.pos.z;
    return { fromId, toId, from, to, idx: i };
  });
  const edgeGeom = new THREE.BufferGeometry();
  edgeGeom.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
  edgeGeom.setAttribute('color', new THREE.BufferAttribute(edgeColors, 3));
  const edgeMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,                              // crystallize-in
    blending: THREE.AdditiveBlending,
  });
  const edgeLines = new THREE.LineSegments(edgeGeom, edgeMat);
  group.add(edgeLines);
  paintEdges(edgeColors, EDGE_DEFS.length, COLOR_EDGE, 0.35);
  edgeGeom.attributes.color.needsUpdate = true;

  // ─── Edge pulse runner (single shared moving sphere per edge) ──────
  // Pre-allocate one pulse mesh per edge so during demo each edge can
  // run its traversal independently. Visible only when active.
  const edgePulses = edges.map(() => {
    const geom = new THREE.SphereGeometry(NODE_RADIUS * 0.65, 12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.visible = false;
    group.add(mesh);
    return { mesh, geom, mat, active: false, startTime: 0, fired: false };
  });

  // ─── Reasoning nodes + beams ───────────────────────────────────────
  const reasoningGroup = new THREE.Group();
  group.add(reasoningGroup);
  const reasoningNodes = REASONING_DEFS.map((def) => {
    const geom = new THREE.IcosahedronGeometry(REASONING_RADIUS, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: COLOR_REASONING,
      transparent: true,
      opacity: 0,
    });
    const mesh = new THREE.Mesh(geom, mat);
    reasoningGroup.add(mesh);

    // Beam — golden line from reasoning node to its target evidence node.
    // Two-vertex BufferGeometry; positions updated each frame as the
    // reasoning node drops + sits.
    const beamPos = new Float32Array(6);
    const beamGeom = new THREE.BufferGeometry();
    beamGeom.setAttribute('position', new THREE.BufferAttribute(beamPos, 3));
    const beamMat = new THREE.LineBasicMaterial({
      color: COLOR_REASONING,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Line(beamGeom, beamMat);
    reasoningGroup.add(beam);

    return {
      target: nodeById[def.targetId],
      mesh, geom, mat,
      beam, beamGeom, beamMat, beamPos,
      landed: false,
      beamFired: false,
    };
  });

  // ─── Second-hand pointer line ──────────────────────────────────────
  // Lives outside `group` so it doesn't rotate during the wrist-roll demo
  // — it always points from the operator's fingertip in world space to
  // the currently-rotated position of the closest node.
  const pointerPos = new Float32Array(6);
  const pointerGeom = new THREE.BufferGeometry();
  pointerGeom.setAttribute('position', new THREE.BufferAttribute(pointerPos, 3));
  const pointerMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
  });
  const pointerLine = new THREE.Line(pointerGeom, pointerMat);
  pointerLine.visible = false;
  scene.add(pointerLine);
  const tempNodeWorld = new THREE.Vector3();

  // ─── Chaos particles (idle / crystallizing) ────────────────────────
  const particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const geom = new THREE.IcosahedronGeometry(PARTICLE_RADIUS, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: Math.random() < 0.5 ? COLOR_PARTICLE_HOT : COLOR_PARTICLE_COLD,
      transparent: true,
      opacity: 0.7,
    });
    const mesh = new THREE.Mesh(geom, mat);
    group.add(mesh);
    particles.push({
      mesh, geom, mat,
      orbitR: LATTICE_RADIUS * (0.5 + Math.random() * 0.9),
      orbitTheta: Math.random() * Math.PI * 2,
      orbitPhi: (Math.random() - 0.5) * Math.PI,
      orbitSpeed: 0.5 + Math.random() * 1.5,
      yPhase: Math.random() * Math.PI * 2,
      // Where it converges TO during crystallize (a random lattice node).
      converge: nodePositions[Math.floor(Math.random() * nodePositions.length)],
    });
  }

  // ─── State ────────────────────────────────────────────────────────
  let state = 'idle';                        // 'idle' | 'crystallizing' | 'stable' | 'demo'
  let stateStart = 0;
  let wasPastThreshold = false;
  let demoStartRollY = 0;
  let lastPointerNodeId = null;

  function update(_landmarks, gesture) {
    const now = performance.now() / 1000;

    // No palm in frame → reset to idle (preserve crystallized look optionally;
    // we choose to hide the group entirely so the scene doesn't flash stale).
    if (!gesture?.palm) {
      group.visible = false;
      pointerLine.visible = false;
      lastPointerNodeId = null;
      if (state !== 'idle') {
        state = 'idle';
        stateStart = now;
        resetDemoVisuals();
      }
      wasPastThreshold = false;
      return;
    }
    group.visible = true;

    // Anchor — apply BEFORE state machinery so the lattice is positioned
    // even on the very first visible frame.
    const palmWorld = normalizedToWorld(gesture.palm);
    group.position.set(palmWorld.x, palmWorld.y + FLOAT_OFFSET, 0);

    // ─── State transitions ──────────────────────────────────────────
    if (state === 'idle' && gesture.handOpen) {
      state = 'crystallizing';
      stateStart = now;
    } else if (state === 'crystallizing' && now - stateStart >= CRYSTALLIZE_DURATION) {
      state = 'stable';
      stateStart = now;
      playTopologyCrystalSnap({ volume: 0.22 });
    } else if (state === 'stable' && gesture.rollPastThreshold && !wasPastThreshold) {
      state = 'demo';
      stateStart = now;
      demoStartRollY = group.rotation.y;
      initDemo();
    } else if (state === 'demo' && now - stateStart >= DEMO_DURATION) {
      state = 'stable';
      stateStart = now;
      resetDemoVisuals();
    }
    wasPastThreshold = !!gesture.rollPastThreshold;

    const stateAge = now - stateStart;

    // ─── Render per state ───────────────────────────────────────────
    if (state === 'idle' || state === 'crystallizing') {
      const crystProgress = state === 'crystallizing'
        ? Math.min(1, stateAge / CRYSTALLIZE_DURATION)
        : 0;
      renderParticles(particles, crystProgress);
      // Fade in node + edge opacity during second half of crystallize.
      const latticeOpacity = state === 'crystallizing'
        ? smoothstep(Math.max(0, crystProgress * 2 - 1))
        : 0;
      setLatticeOpacity(nodes, edgeMat, latticeOpacity);
    } else {
      hideParticles(particles);
      setLatticeOpacity(nodes, edgeMat, 1);
    }

    if (state === 'demo') {
      // Spin with the wrist — multiply deviation for a clearer visual.
      group.rotation.y = demoStartRollY + (gesture.deviation || 0) * 1.8;
      animateEdgePulses(edgePulses, edges, stateAge);
      animateReasoning(reasoningNodes, stateAge);
    } else {
      // Settle rotation; hide demo-only elements.
      group.rotation.y *= 0.92;
      hideEdgePulses(edgePulses);
      hideReasoning(reasoningNodes);
    }

    // ─── Second-hand pointer (runs after primary render so it can ──
    //     override node scale / opacity for the highlighted target) ──
    // Reset all node scales to baseline as a default for this frame.
    for (const n of nodes) n.mesh.scale.setScalar(1.0);

    // Pointer is only meaningful when the lattice is visible.
    if ((state === 'stable' || state === 'demo') && gesture.otherFingertip) {
      // Force matrixWorld up-to-date so applyMatrix4 reflects the
      // position + rotation we just set above (Three.js otherwise updates
      // matrixWorld during renderer.render, after this update() returns).
      group.updateMatrixWorld(true);
      const fpWorld = normalizedToWorld(gesture.otherFingertip);

      let bestNode = null;
      let bestDist = POINTER_MAX_RANGE;
      for (const node of nodes) {
        tempNodeWorld.set(node.pos.x, node.pos.y, node.pos.z).applyMatrix4(group.matrixWorld);
        const dx = fpWorld.x - tempNodeWorld.x;
        const dy = fpWorld.y - tempNodeWorld.y;
        const dz = -tempNodeWorld.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < bestDist) {
          bestDist = d;
          bestNode = node;
        }
      }

      if (bestNode) {
        tempNodeWorld.set(bestNode.pos.x, bestNode.pos.y, bestNode.pos.z).applyMatrix4(group.matrixWorld);
        pointerPos[0] = fpWorld.x;
        pointerPos[1] = fpWorld.y;
        pointerPos[2] = 0;
        pointerPos[3] = tempNodeWorld.x;
        pointerPos[4] = tempNodeWorld.y;
        pointerPos[5] = tempNodeWorld.z;
        pointerGeom.attributes.position.needsUpdate = true;
        pointerMat.color.setHex(bestNode.color);
        pointerMat.opacity = 0.85;
        pointerLine.visible = true;
        bestNode.mesh.scale.setScalar(POINTER_NODE_SCALE);
        bestNode.mat.opacity = 1.0;

        if (lastPointerNodeId !== bestNode.id) {
          playTopologyCrystalPulse({ volume: 0.08 });
          lastPointerNodeId = bestNode.id;
        }
      } else {
        pointerLine.visible = false;
        lastPointerNodeId = null;
      }
    } else {
      pointerLine.visible = false;
      lastPointerNodeId = null;
    }
  }

  function initDemo() {
    // Schedule each edge pulse with a staggered start time.
    edgePulses.forEach((pulse, i) => {
      pulse.active = false;
      pulse.fired = false;
      pulse.startTime = i * EDGE_PULSE_STAGGER;
      pulse.mesh.visible = false;
    });
    // Reasoning nodes start hidden, drop in after the first wave of pulses.
    reasoningNodes.forEach((r) => {
      r.landed = false;
      r.beamFired = false;
      r.mat.opacity = 0;
      r.beamMat.opacity = 0;
      r.mesh.position.set(r.target.pos.x, REASONING_START_Y, r.target.pos.z);
    });
  }

  function resetDemoVisuals() {
    hideEdgePulses(edgePulses);
    hideReasoning(reasoningNodes);
  }

  function dispose() {
    scene.remove(group);
    scene.remove(pointerLine);
    pointerGeom.dispose();
    pointerMat.dispose();
    for (const n of nodes) { n.geom.dispose(); n.mat.dispose(); }
    edgeGeom.dispose();
    edgeMat.dispose();
    for (const p of edgePulses) { p.geom.dispose(); p.mat.dispose(); }
    for (const r of reasoningNodes) {
      r.geom.dispose();
      r.mat.dispose();
      r.beamGeom.dispose();
      r.beamMat.dispose();
    }
    for (const p of particles) { p.geom.dispose(); p.mat.dispose(); }
  }

  return { update, dispose };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function renderParticles(particles, crystProgress) {
  for (const p of particles) {
    p.mesh.visible = true;
    p.orbitTheta += p.orbitSpeed * 0.016;
    const r = p.orbitR;
    // Idle position on a chaotic shell — Lissajous-y orbits.
    const idleX = Math.cos(p.orbitTheta) * Math.sin(p.orbitPhi + p.yPhase) * r;
    const idleY = Math.sin(p.orbitTheta * 1.3 + p.yPhase) * r * 0.7;
    const idleZ = Math.cos(p.orbitTheta * 0.7 + p.orbitPhi) * r * 0.6;
    // Converge toward target node position as crystallize progresses.
    const ct = smoothstep(crystProgress);
    const tx = p.converge.x;
    const ty = p.converge.y;
    const tz = p.converge.z;
    p.mesh.position.set(
      idleX * (1 - ct) + tx * ct,
      idleY * (1 - ct) + ty * ct,
      idleZ * (1 - ct) + tz * ct,
    );
    // Fade out as they reach the node positions.
    p.mat.opacity = (0.7 * (1 - ct)) + 0.05;
  }
}

function hideParticles(particles) {
  for (const p of particles) p.mesh.visible = false;
}

function setLatticeOpacity(nodes, edgeMat, t) {
  const clamped = Math.max(0, Math.min(1, t));
  for (const n of nodes) n.mat.opacity = clamped * 0.95;
  edgeMat.opacity = clamped * 0.85;
}

function animateEdgePulses(edgePulses, edges, stateAge) {
  for (let i = 0; i < edgePulses.length; i++) {
    const pulse = edgePulses[i];
    const edge = edges[i];
    const local = stateAge - pulse.startTime;
    if (local < 0) {
      pulse.mesh.visible = false;
      continue;
    }
    if (local > EDGE_PULSE_DURATION) {
      pulse.mesh.visible = false;
      continue;
    }
    // Fire the per-edge audio on the first frame the pulse appears.
    if (!pulse.fired) {
      pulse.fired = true;
      playTopologyCrystalPulse({ volume: 0.10 });
    }
    const t = local / EDGE_PULSE_DURATION;
    const eased = smoothstep(t);
    const from = edge.from.pos;
    const to = edge.to.pos;
    pulse.mesh.visible = true;
    pulse.mesh.position.set(
      from.x + (to.x - from.x) * eased,
      from.y + (to.y - from.y) * eased,
      from.z + (to.z - from.z) * eased,
    );
    // Pulse fades at the head and tail of its run for a softer streak.
    const fade = Math.sin(t * Math.PI);
    pulse.mat.opacity = 0.4 + fade * 0.55;
  }
}

function hideEdgePulses(edgePulses) {
  for (const p of edgePulses) p.mesh.visible = false;
}

function animateReasoning(reasoningNodes, stateAge) {
  // Drops begin after the first ~6 edges have fired (≈1.1s).
  const dropStart = 1.1;
  for (let i = 0; i < reasoningNodes.length; i++) {
    const r = reasoningNodes[i];
    const myStart = dropStart + i * REASONING_DROP_STAGGER;
    const localDrop = stateAge - myStart;

    if (localDrop < 0) {
      r.mesh.visible = false;
      r.beam.visible = false;
      continue;
    }
    r.mesh.visible = true;

    const t = Math.min(1, localDrop / REASONING_DROP_DURATION);
    const eased = easeInCubic(t);
    const targetY = r.target.pos.y;
    r.mesh.position.y = REASONING_START_Y + (targetY - REASONING_START_Y) * eased;
    r.mesh.position.x = r.target.pos.x;
    r.mesh.position.z = r.target.pos.z;
    r.mat.opacity = 0.95;

    if (t >= 1) {
      // Landed → fire beam (once).
      if (!r.landed) {
        r.landed = true;
      }
      // Beam endpoint follows reasoning node → target node.
      r.beamPos[0] = r.mesh.position.x;
      r.beamPos[1] = r.mesh.position.y;
      r.beamPos[2] = r.mesh.position.z;
      r.beamPos[3] = r.target.pos.x;
      r.beamPos[4] = r.target.pos.y;
      r.beamPos[5] = r.target.pos.z;
      r.beamGeom.attributes.position.needsUpdate = true;
      r.beam.visible = true;
      const beamAge = localDrop - REASONING_DROP_DURATION;
      r.beamMat.opacity = Math.min(0.85, beamAge / BEAM_FADE_DURATION * 0.85);
      if (!r.beamFired && beamAge > 0.02) {
        r.beamFired = true;
        playTopologyCrystalBeam({ volume: 0.18 });
      }
    } else {
      r.beam.visible = false;
    }
  }
}

function hideReasoning(reasoningNodes) {
  for (const r of reasoningNodes) {
    r.mesh.visible = false;
    r.beam.visible = false;
  }
}

function paintEdges(colorBuf, edgeCount, hex, intensity) {
  const c = new THREE.Color(hex).multiplyScalar(intensity);
  for (let i = 0; i < edgeCount; i++) {
    for (let v = 0; v < 2; v++) {
      colorBuf[i * 6 + v * 3 + 0] = c.r;
      colorBuf[i * 6 + v * 3 + 1] = c.g;
      colorBuf[i * 6 + v * 3 + 2] = c.b;
    }
  }
}

// Even point distribution on a sphere — golden-ratio spiral.
function fibonacciSpherePoints(count, radius) {
  const points = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    points.push({
      x: Math.cos(theta) * r * radius,
      y: y * radius,
      z: Math.sin(theta) * r * radius,
    });
  }
  return points;
}

function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function easeInCubic(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c;
}


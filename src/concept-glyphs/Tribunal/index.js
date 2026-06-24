// Tribunal glyph — ARES Deterministic Verdicts (Architect / Skeptic / Oracle).
//
// Enacts the quote: "One LLM proposes a threat hypothesis from cybersecurity
// evidence. The other one challenges it. The referee — pure Python, no model
// behind it — adjudicates with a deterministic decision table."
//
// Three actors share the scene:
//   - Architect NeuroGraph (cyan, anchored at LEFT palm, rotates clockwise)
//   - Skeptic NeuroGraph   (red,  anchored at RIGHT palm, rotates counter-CW)
//   - Oracle               (cyan #00ACC1 lattice + ORACLE label, FIXED at
//                          scene origin, ZERO geometric animation)
//
// Continuous channel (Phase Disc pattern):
//   palm-to-palm distance → tension. The tension line (cyan→red gradient)
//   stretches between the two NeuroGraphs at all times; its opacity rises
//   with proximity. The argument is visible throughout, not just at contact.
//
// Discrete punctuation:
//   Both index fingertips touching screen-center within VERDICT_RADIUS →
//   single 200ms color flash on the Oracle (cyan → white → cyan) and one
//   playOracleAdjudicate chime. The flash is IDENTICAL every time; that
//   sameness IS the "deterministic" feel. The lattice geometry never moves.
//
// Side-effect import: pulls in src/lib/gestures/tribunal.js, which registers
// the tribunal recognizer with the central registry.

import * as THREE from 'three';
import '../../lib/gestures/tribunal.js';
import {
  createTribunalAmbience,
  playOracleAdjudicate,
} from '../../lib/audioPalettes.js';

// ─── Palette ────────────────────────────────────────────────────────────
const COLOR_ARCHITECT = 0x06b6d4;     // cyan (matches NODE_ACCENT — same family as Oracle)
const COLOR_SKEPTIC   = 0xef4444;     // red
const COLOR_ORACLE    = 0x00acc1;     // specified cyan #00ACC1
const COLOR_FLASH     = 0xffffff;     // verdict flash

// ─── NeuroGraph sizing ──────────────────────────────────────────────────
const NEURO_RADIUS       = 0.16;      // sphere shell radius for nodes (world units)
const NEURO_NODE_SIZE    = 0.024;
const NEURO_NODE_COUNT   = 10;
const NEURO_EDGE_RADIUS  = 0.22;      // node pairs within this distance get an edge
const NEURO_ROTATE_SPEED = 1.2;       // rad/sec; sign distinguishes Architect/Skeptic
const NEURO_FLOAT_OFFSET = 0.04;      // small lift above palm
const NEURO_PULSE_HZ     = 1.4;       // breathing intensity for "thinking" feel

// ─── Holographic cube sizing ────────────────────────────────────────────
// Single wireframe cube — 8 corner spheres + 12 edges — centered at scene
// origin. Additive-blended cyan reads as "construct made of light." Spins
// continuously: baseline drift when nothing's happening, accelerates with
// tension (hands close together) toward CUBE_SPIN_MAX. The metaphor reads
// as "the math is weighing the argument"; the verdict flash (separate, 200ms
// triangle-wave to white) is the discrete deterministic pronouncement.
const CUBE_EDGE_LENGTH = 0.32;        // world units, cube centered at origin
const CUBE_VERTEX_SIZE = 0.026;
const CUBE_SPIN_BASE   = 0.35;        // rad/sec at tension=0 (idle drift)
const CUBE_SPIN_MAX    = 2.6;         // rad/sec at tension=1 (heated argument)
const CUBE_TUMBLE_AXIS = { y: 1.0, x: 0.35, z: 0.12 };   // multipliers for visual tumble
const VERDICT_FLASH_MS = 200;

// ─── World mapping ──────────────────────────────────────────────────────
// Matches the camera config in conceptStage (FOV 50°, z=3). Computed at
// module load against the default 16:9 aspect; non-16:9 stages have a slight
// horizontal offset that the recogniser-side normalization absorbs.
const STAGE_W = 1280;
const STAGE_H = 720;
const FOV_DEG = 50;
const CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

function normalizedToWorld({ x, y }) {
  return {
    x: (x - 0.5) * WORLD_WIDTH,
    y: -(y - 0.5) * WORLD_HEIGHT,
  };
}

export function createTribunal({ scene }) {
  const root = new THREE.Group();
  scene.add(root);

  // ─── Architect NeuroGraph (cyan, CW) ──────────────────────────────
  const architect = buildNeuroGraph(COLOR_ARCHITECT);
  root.add(architect.group);

  // ─── Skeptic NeuroGraph (red, CCW) ────────────────────────────────
  const skeptic = buildNeuroGraph(COLOR_SKEPTIC);
  root.add(skeptic.group);

  // ─── Tension line (LineSegments with vertex-color gradient) ───────
  // 2 vertices, 6 floats positions, 6 floats colors. Endpoints are updated
  // per frame to track the two NeuroGraph centers. Material uses additive
  // blending so the line glows over the dark backdrop.
  const tensionPos = new Float32Array(6);
  const tensionColorBuf = new Float32Array([
    /* vertex 0 (architect end) */ ...hexToRGB(COLOR_ARCHITECT),
    /* vertex 1 (skeptic end)   */ ...hexToRGB(COLOR_SKEPTIC),
  ]);
  const tensionGeom = new THREE.BufferGeometry();
  tensionGeom.setAttribute('position', new THREE.BufferAttribute(tensionPos, 3));
  tensionGeom.setAttribute('color', new THREE.BufferAttribute(tensionColorBuf, 3));
  const tensionMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,                      // starts hidden; opacity rides tension
    blending: THREE.AdditiveBlending,
  });
  const tensionLine = new THREE.LineSegments(tensionGeom, tensionMat);
  root.add(tensionLine);

  // ─── Holographic cube (fixed at origin, spins) ────────────────────
  const holoCube = buildHoloCube();
  root.add(holoCube.group);

  // ─── Audio ambience (started on first mount) ──────────────────────
  const ambience = createTribunalAmbience({ volume: 0.7 });
  let verdictFlashStart = -Infinity;
  let lastTime = performance.now() / 1000;

  function update(_landmarks, gesture) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - lastTime);       // dt cap protects against tab-switch jumps
    lastTime = now;

    if (!gesture) {
      root.visible = false;
      ambience.setTension(0);
      return;
    }
    root.visible = true;

    // ─── Architect anchoring ────────────────────────────────────────
    if (gesture.leftPalm) {
      const w = normalizedToWorld(gesture.leftPalm);
      architect.group.position.set(w.x, w.y + NEURO_FLOAT_OFFSET, 0);
      architect.group.rotation.y += NEURO_ROTATE_SPEED * dt;        // CW
      pulseNeuroGraph(architect, now);
      architect.group.visible = true;
    } else {
      architect.group.visible = false;
    }

    // ─── Skeptic anchoring ──────────────────────────────────────────
    if (gesture.rightPalm) {
      const w = normalizedToWorld(gesture.rightPalm);
      skeptic.group.position.set(w.x, w.y + NEURO_FLOAT_OFFSET, 0);
      skeptic.group.rotation.y -= NEURO_ROTATE_SPEED * dt;          // CCW
      pulseNeuroGraph(skeptic, now);
      skeptic.group.visible = true;
    } else {
      skeptic.group.visible = false;
    }

    // ─── Tension line (only when both hands present) ────────────────
    if (architect.group.visible && skeptic.group.visible) {
      tensionPos[0] = architect.group.position.x;
      tensionPos[1] = architect.group.position.y;
      tensionPos[2] = architect.group.position.z;
      tensionPos[3] = skeptic.group.position.x;
      tensionPos[4] = skeptic.group.position.y;
      tensionPos[5] = skeptic.group.position.z;
      tensionGeom.attributes.position.needsUpdate = true;
      // Opacity is the continuous channel. Starts visible at 0.25 (the
      // argument is happening even when hands are far) and climbs with
      // tension toward 0.95 (heated).
      tensionMat.opacity = 0.25 + 0.7 * (gesture.tension || 0);
      tensionLine.visible = true;
    } else {
      tensionLine.visible = false;
    }

    // ─── Cube spin (continuous, tension-driven) ─────────────────────
    // Spin rate is the continuous channel for the Oracle. Idle drift at
    // CUBE_SPIN_BASE so the cube always reads as "alive"; lerps up toward
    // CUBE_SPIN_MAX as hands close in (tension → 1). Multi-axis tumble
    // (Y primary, X secondary, Z tiny) keeps the cube visually engaging
    // — a Y-only spin reads as a boring lazy susan.
    const tensionNow = gesture.tension || 0;
    const spinRate = CUBE_SPIN_BASE + (CUBE_SPIN_MAX - CUBE_SPIN_BASE) * tensionNow;
    holoCube.group.rotation.y += spinRate * CUBE_TUMBLE_AXIS.y * dt;
    holoCube.group.rotation.x += spinRate * CUBE_TUMBLE_AXIS.x * dt;
    holoCube.group.rotation.z += spinRate * CUBE_TUMBLE_AXIS.z * dt;

    // ─── Verdict trigger (discrete rising edge) ─────────────────────
    if (gesture.verdictTriggered) {
      verdictFlashStart = now;
      playOracleAdjudicate({ volume: 0.24 });
    }

    // ─── Cube flash render ──────────────────────────────────────────
    const flashAge = (now - verdictFlashStart) * 1000;   // ms
    if (flashAge >= 0 && flashAge < VERDICT_FLASH_MS) {
      // Triangle wave: t=0 → cyan, t=0.5 → white-hot, t=1 → back to cyan.
      const t = flashAge / VERDICT_FLASH_MS;
      const tri = 1 - Math.abs(t - 0.5) * 2;
      const c = lerpColor(COLOR_ORACLE, COLOR_FLASH, tri);
      paintCube(holoCube, c);
    } else {
      paintCube(holoCube, new THREE.Color(COLOR_ORACLE));
    }

    // ─── Audio tension follow ───────────────────────────────────────
    ambience.setTension(tensionNow);
  }

  function dispose() {
    scene.remove(root);
    ambience.stop();
    architect.dispose();
    skeptic.dispose();
    tensionGeom.dispose();
    tensionMat.dispose();
    holoCube.dispose();
  }

  return { update, dispose };
}

// ─── NeuroGraph builder ────────────────────────────────────────────────
// Small "thinking constellation": fibonacci-sphere nodes + nearest-neighbor
// edges. Additive blending on edges so they read as glowing filaments.
// Each node mesh gets pulsed gently in opacity by pulseNeuroGraph() so the
// graph "breathes" — sells "LLM thinking" without screaming animation.
function buildNeuroGraph(colorHex) {
  const group = new THREE.Group();

  const positions = fibonacciSpherePoints(NEURO_NODE_COUNT, NEURO_RADIUS);

  const nodeMats = [];
  const nodeGeoms = [];
  positions.forEach((pos) => {
    const geom = new THREE.SphereGeometry(NEURO_NODE_SIZE, 12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    group.add(mesh);
    nodeMats.push(mat);
    nodeGeoms.push(geom);
  });

  // Edges: connect every pair within NEURO_EDGE_RADIUS. Sparse enough to
  // read as "filaments" rather than a solid mesh.
  const edgePairs = [];
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i];
      const b = positions[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d < NEURO_EDGE_RADIUS) edgePairs.push([i, j]);
    }
  }
  const edgePos = new Float32Array(edgePairs.length * 2 * 3);
  edgePairs.forEach(([i, j], k) => {
    const a = positions[i];
    const b = positions[j];
    edgePos[k * 6 + 0] = a.x; edgePos[k * 6 + 1] = a.y; edgePos[k * 6 + 2] = a.z;
    edgePos[k * 6 + 3] = b.x; edgePos[k * 6 + 4] = b.y; edgePos[k * 6 + 5] = b.z;
  });
  const edgeGeom = new THREE.BufferGeometry();
  edgeGeom.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
  const edgeMat = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
  });
  const edgeLines = new THREE.LineSegments(edgeGeom, edgeMat);
  group.add(edgeLines);

  return {
    group,
    nodeMats,
    dispose() {
      for (const g of nodeGeoms) g.dispose();
      for (const m of nodeMats) m.dispose();
      edgeGeom.dispose();
      edgeMat.dispose();
    },
  };
}

// "Breathing" — gently varies node opacity around 0.7..1.0 so the graph
// looks alive even before any gesture is recognized. Frequency is shared
// across nodes but phase varies per-index, so it doesn't pulse in unison.
function pulseNeuroGraph(neuro, t) {
  for (let i = 0; i < neuro.nodeMats.length; i++) {
    const phase = i * 0.7;
    const v = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(2 * Math.PI * NEURO_PULSE_HZ * t + phase));
    neuro.nodeMats[i].opacity = v;
  }
}

// ─── Holographic cube builder ──────────────────────────────────────────
// Single wireframe cube at scene origin. 8 corner vertex-spheres + 12
// edges, all additive-blended in cyan #00ACC1. No label, no nested
// structure — clean geometric construct that reads as "hologram."
// Spins continuously; the spin rate is driven from update() by tension.
function buildHoloCube() {
  const group = new THREE.Group();
  const half = CUBE_EDGE_LENGTH / 2;

  // 8 cube corners (+/-, +/-, +/-)
  const corners = [];
  for (let i = 0; i < 8; i++) {
    corners.push([
      (i & 1) ? half : -half,
      (i & 2) ? half : -half,
      (i & 4) ? half : -half,
    ]);
  }

  // Vertex spheres — additive blending gives the corner-light look.
  const vertexMats = [];
  const vertexGeoms = [];
  corners.forEach(([x, y, z]) => {
    const geom = new THREE.SphereGeometry(CUBE_VERTEX_SIZE, 12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: COLOR_ORACLE,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    vertexMats.push(mat);
    vertexGeoms.push(geom);
  });

  // 12 cube edges — every pair of corners that differ in exactly one bit
  // (Hamming distance 1). Iterating bit-flips is shorter than hard-listing.
  const edgePairs = [];
  for (let i = 0; i < 8; i++) {
    for (let b = 0; b < 3; b++) {
      const j = i ^ (1 << b);
      if (j > i) edgePairs.push([i, j]);
    }
  }
  const edgePos = new Float32Array(edgePairs.length * 2 * 3);
  edgePairs.forEach(([i, j], idx) => {
    const a = corners[i];
    const b = corners[j];
    edgePos[idx * 6 + 0] = a[0]; edgePos[idx * 6 + 1] = a[1]; edgePos[idx * 6 + 2] = a[2];
    edgePos[idx * 6 + 3] = b[0]; edgePos[idx * 6 + 4] = b[1]; edgePos[idx * 6 + 5] = b[2];
  });
  const edgeGeom = new THREE.BufferGeometry();
  edgeGeom.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
  const edgeMat = new THREE.LineBasicMaterial({
    color: COLOR_ORACLE,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
  });
  const edgeLines = new THREE.LineSegments(edgeGeom, edgeMat);
  group.add(edgeLines);

  return {
    group,
    vertexMats,
    edgeMat,
    dispose() {
      for (const g of vertexGeoms) g.dispose();
      for (const m of vertexMats) m.dispose();
      edgeGeom.dispose();
      edgeMat.dispose();
    },
  };
}

// Paint every cube material with a single color. Called every frame during
// the verdict flash; the rest of the time it just re-sets cyan (cheap —
// Three.Color.copy is a numeric copy).
function paintCube(cube, color) {
  for (const m of cube.vertexMats) m.color.copy(color);
  cube.edgeMat.color.copy(color);
}

// ─── Helpers ──────────────────────────────────────────────────────────

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

function hexToRGB(hex) {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

const _lerpFrom = new THREE.Color();
const _lerpTo = new THREE.Color();
const _lerpOut = new THREE.Color();
function lerpColor(hexA, hexB, t) {
  _lerpFrom.setHex(hexA);
  _lerpTo.setHex(hexB);
  _lerpOut.copy(_lerpFrom).lerp(_lerpTo, Math.max(0, Math.min(1, t)));
  return _lerpOut;
}

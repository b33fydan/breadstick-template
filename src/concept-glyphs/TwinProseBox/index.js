// Twin-Prose Box glyph — paired-scenario visualization (Evidence Grounding).
//
// BEAT 7. Two mini evidence boxes side-by-side anchored to the LEFT palm.
// IDENTICAL 12-dot layout inside each — "same facts." Different prose
// ribbons wrapped around each box: BLUE #4DD0E1 vs ORANGE #FF9800 — the
// "different attacker prose" carrier. The visual finding: same evidence
// skeleton, different language wrapping. The math doesn't care.
//
// Ribbons are slow-spinning helical wraps so they read as a coiled
// wrapper, not just a static outline.

import * as THREE from 'three';
import '../../lib/gestures/twinprosebox.js';

const SHELL_COLOR = 0x00acc1;
const DOT_COLOR = 0xffffff;
const PROSE_A_COLOR = 0x4dd0e1;   // blue
const PROSE_B_COLOR = 0xff9800;   // orange

const BOX_HALF = 0.07;             // small mini-box (half of Evidence Box)
const DOT_RADIUS = 0.008;
const BOX_GAP = 0.18;              // center-to-center separation
const RIBBON_RADIUS = BOX_HALF * 1.35;
const RIBBON_SAMPLES = 64;
const RIBBON_TURNS = 2.2;
const RIBBON_SPIN_HZ = 0.16;

const STAGE_W = 1280, STAGE_H = 720, FOV_DEG = 50, CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

// Identical dot layout — shared across both boxes (this is the whole point).
const DOT_POSITIONS = generateFactPositions(12, BOX_HALF * 0.78);

function generateFactPositions(count, bound) {
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

function buildBox(parent, offsetX, ribbonColor) {
  const container = new THREE.Group();
  container.position.x = offsetX;
  parent.add(container);

  // Cyan wireframe shell.
  const boxGeom = new THREE.BoxGeometry(BOX_HALF * 2, BOX_HALF * 2, BOX_HALF * 2);
  const boxEdges = new THREE.EdgesGeometry(boxGeom);
  const shellMat = new THREE.LineBasicMaterial({
    color: SHELL_COLOR, transparent: true, opacity: 0.78,
  });
  const shell = new THREE.LineSegments(boxEdges, shellMat);
  container.add(shell);

  // Inner soft glow.
  const innerGeom = new THREE.BoxGeometry(BOX_HALF * 1.92, BOX_HALF * 1.92, BOX_HALF * 1.92);
  const innerMat = new THREE.MeshBasicMaterial({
    color: SHELL_COLOR, transparent: true, opacity: 0.05,
  });
  const innerMesh = new THREE.Mesh(innerGeom, innerMat);
  container.add(innerMesh);

  // 12 Fact-dots — identical between the two boxes.
  const dots = DOT_POSITIONS.map((pos) => {
    const geom = new THREE.IcosahedronGeometry(DOT_RADIUS, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: DOT_COLOR, transparent: true, opacity: 0.88,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    container.add(mesh);
    return { mesh, geom, mat };
  });

  // Helical prose ribbon — sample a helix wrapping the box, draw as line strip.
  const ribbonGeom = new THREE.BufferGeometry();
  const ribbonVerts = new Float32Array(RIBBON_SAMPLES * 3);
  ribbonGeom.setAttribute('position', new THREE.BufferAttribute(ribbonVerts, 3));
  const ribbonMat = new THREE.LineBasicMaterial({
    color: ribbonColor, transparent: true, opacity: 0.85, linewidth: 2,
  });
  const ribbon = new THREE.Line(ribbonGeom, ribbonMat);
  container.add(ribbon);

  return {
    container, shell, shellMat, boxGeom, boxEdges,
    innerMesh, innerGeom, innerMat,
    dots, ribbon, ribbonGeom, ribbonMat, ribbonVerts,
  };
}

function updateRibbon(boxData, phase) {
  // Helix: t ∈ [0,1] → y from -1.1*HALF to +1.1*HALF; angle = 2π·TURNS·t + phase.
  const verts = boxData.ribbonVerts;
  for (let i = 0; i < RIBBON_SAMPLES; i++) {
    const t = i / (RIBBON_SAMPLES - 1);
    const y = (t - 0.5) * 2 * BOX_HALF * 1.1;
    const ang = t * Math.PI * 2 * RIBBON_TURNS + phase;
    verts[i * 3 + 0] = Math.cos(ang) * RIBBON_RADIUS;
    verts[i * 3 + 1] = y;
    verts[i * 3 + 2] = Math.sin(ang) * RIBBON_RADIUS;
  }
  boxData.ribbonGeom.attributes.position.needsUpdate = true;
}

export function createTwinProseBox({ scene }) {
  const group = new THREE.Group();
  scene.add(group);

  const boxA = buildBox(group, -BOX_GAP / 2, PROSE_A_COLOR);
  const boxB = buildBox(group, +BOX_GAP / 2, PROSE_B_COLOR);

  function update(_landmarks, gesture) {
    // Anchor: LEFT first, RIGHT fallback.
    let anchor = null;
    if (gesture?.leftPalm) anchor = gesture.leftPalm;
    else if (gesture?.rightPalm) anchor = gesture.rightPalm;
    if (!anchor) { group.visible = false; return; }
    group.visible = true;
    const w = normalizedToWorld(anchor);
    group.position.set(w.x, w.y, 0);

    // Slow ribbon counter-rotation — visual texture, not interactive.
    const t = performance.now() / 1000;
    updateRibbon(boxA, +t * Math.PI * 2 * RIBBON_SPIN_HZ);
    updateRibbon(boxB, -t * Math.PI * 2 * RIBBON_SPIN_HZ);
  }

  function dispose() {
    scene.remove(group);
    for (const b of [boxA, boxB]) {
      b.shellMat.dispose();
      b.boxGeom.dispose();
      b.boxEdges.dispose();
      b.innerGeom.dispose();
      b.innerMat.dispose();
      for (const d of b.dots) { d.geom.dispose(); d.mat.dispose(); }
      b.ribbonGeom.dispose();
      b.ribbonMat.dispose();
    }
  }

  return { update, dispose };
}

function normalizedToWorld({ x, y }) {
  return { x: (x - 0.5) * WORLD_WIDTH, y: -(y - 0.5) * WORLD_HEIGHT };
}

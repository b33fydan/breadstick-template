// Oracle Lattice glyph — ARES Oracle (deterministic Python referee).
//
// BEAT 1, 3. Cyan #00ACC1 rigid cube — 8 vertices, 12 edges, ZERO idle
// animation. The stillness is the narrative point: the Oracle doesn't
// "think." It runs a decision table. When the LLM clouds breathe, the
// Oracle's rigidity is the contrast that sells the punchline.
//
// Anchor: midpoint between palms if both visible (BEAT 3 "rises up
// between them"). Single-palm fallback to LEFT (BEAT 1 "sitting on the
// left palm").
//
// Adjudication trigger: palms together → palms apart rising edge. Fires
// a single vertex-pulse wave across the cube diagonal (BEAT 3
// "vertices pulse in a wave from one corner to the opposite") + audio.
// No "thinking loader" — the pulse completes in ~0.6s and the lattice
// returns to stillness.

import * as THREE from 'three';
import '../../lib/gestures/oraclelattice.js';
import { playOracleAdjudicate } from '../../lib/audioPalettes.js';

const ORACLE_COLOR = 0x00acc1;
const CUBE_HALF = 0.13;            // half-edge length of the lattice cube
const VERTEX_SIZE = 0.022;
const PULSE_DURATION = 0.6;        // diagonal traversal time
const PULSE_GLOW = 1.0;             // max emissive multiplier
const REVEAL_DURATION = 0.45;       // scale + opacity rise on first reveal

const STAGE_W = 1280, STAGE_H = 720, FOV_DEG = 50, CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

export function createOracleLattice({ scene }) {
  const group = new THREE.Group();

  // Cube vertices in local space — index 0 = (-,-,-), index 7 = (+,+,+).
  // The pulse wave traverses from vertex 0 to vertex 7 by signed-sum order.
  const localVerts = [];
  for (let x = -1; x <= 1; x += 2) {
    for (let y = -1; y <= 1; y += 2) {
      for (let z = -1; z <= 1; z += 2) {
        localVerts.push(new THREE.Vector3(x * CUBE_HALF, y * CUBE_HALF, z * CUBE_HALF));
      }
    }
  }
  // Diagonal order: sort by (x+y+z) so the pulse walks from (-,-,-) to (+,+,+).
  const pulseOrder = localVerts
    .map((v, i) => ({ i, sum: v.x + v.y + v.z }))
    .sort((a, b) => a.sum - b.sum)
    .map((entry) => entry.i);

  // 12 edges of the cube — pairs of vertex indices that differ in exactly one axis.
  const edgePairs = [];
  for (let a = 0; a < 8; a++) {
    for (let b = a + 1; b < 8; b++) {
      const va = localVerts[a], vb = localVerts[b];
      const diffs = [va.x !== vb.x, va.y !== vb.y, va.z !== vb.z].filter(Boolean).length;
      if (diffs === 1) edgePairs.push([a, b]);
    }
  }

  // Edges as a single LineSegments — additive so pulse glow stacks on overlaps.
  const edgePositions = new Float32Array(edgePairs.length * 2 * 3);
  for (let i = 0; i < edgePairs.length; i++) {
    const [a, b] = edgePairs[i];
    edgePositions.set([localVerts[a].x, localVerts[a].y, localVerts[a].z], i * 6);
    edgePositions.set([localVerts[b].x, localVerts[b].y, localVerts[b].z], i * 6 + 3);
  }
  const edgeGeom = new THREE.BufferGeometry();
  edgeGeom.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
  const edgeMat = new THREE.LineBasicMaterial({
    color: ORACLE_COLOR,
    transparent: true,
    opacity: 0.85,
  });
  const edges = new THREE.LineSegments(edgeGeom, edgeMat);
  group.add(edges);

  // Vertex spheres — per-vertex material so the pulse can light individual nodes.
  const vertexMeshes = [];
  for (const v of localVerts) {
    const geom = new THREE.IcosahedronGeometry(VERTEX_SIZE, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: ORACLE_COLOR,
      transparent: true,
      opacity: 0.95,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(v);
    group.add(mesh);
    vertexMeshes.push({ mesh, geom, mat, baseOpacity: 0.95, glow: 0 });
  }

  scene.add(group);

  let wasTogether = false;
  let pulseElapsed = -1;             // -1 = no pulse active
  let revealElapsed = 0;
  let lastFrameTime = performance.now() / 1000;

  function update(_landmarks, gesture) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - lastFrameTime);
    lastFrameTime = now;

    // Anchor: midpoint between palms if both, else LEFT, else RIGHT.
    let anchor = null;
    if (gesture?.leftPalm && gesture?.rightPalm) {
      anchor = {
        x: (gesture.leftPalm.x + gesture.rightPalm.x) / 2,
        y: (gesture.leftPalm.y + gesture.rightPalm.y) / 2,
      };
    } else if (gesture?.leftPalm) {
      anchor = gesture.leftPalm;
    } else if (gesture?.rightPalm) {
      anchor = gesture.rightPalm;
    }

    if (!anchor) {
      group.visible = false;
      revealElapsed = 0;
      return;
    }
    if (!group.visible) {
      // First visible frame this anchor cycle → reset reveal.
      revealElapsed = 0;
    }
    group.visible = true;

    const world = normalizedToWorld(anchor);
    group.position.set(world.x, world.y, 0);

    // Reveal scale-up — clamped scalar so the lattice doesn't pop in.
    revealElapsed = Math.min(REVEAL_DURATION, revealElapsed + dt);
    const revealT = revealElapsed / REVEAL_DURATION;
    const reveal = easeOutCubic(revealT);
    group.scale.setScalar(0.6 + 0.4 * reveal);
    edgeMat.opacity = 0.85 * reveal;

    // Rising-edge adjudicate: palms-together → palms-apart.
    const isTogether = !!gesture?.palmsTogether;
    if (wasTogether && !isTogether && pulseElapsed < 0) {
      pulseElapsed = 0;
      playOracleAdjudicate({ volume: 0.2 });
    }
    wasTogether = isTogether;

    // Advance pulse + apply per-vertex glow.
    if (pulseElapsed >= 0) {
      pulseElapsed += dt;
      if (pulseElapsed > PULSE_DURATION) {
        pulseElapsed = -1;
        for (const v of vertexMeshes) v.glow = 0;
      } else {
        const t = pulseElapsed / PULSE_DURATION;
        // Wave front position along pulseOrder index (0..7).
        const head = t * 8;
        for (let i = 0; i < vertexMeshes.length; i++) {
          const orderIdx = pulseOrder.indexOf(i);
          const distance = Math.abs(orderIdx - head);
          const glow = Math.max(0, 1 - distance * 0.6) * PULSE_GLOW;
          vertexMeshes[i].glow = glow;
        }
      }
    }

    for (const v of vertexMeshes) {
      v.mat.opacity = (v.baseOpacity + v.glow * 0.05) * reveal;
      const scale = 1 + v.glow * 0.55;
      v.mesh.scale.setScalar(scale);
    }
  }

  function dispose() {
    scene.remove(group);
    edgeGeom.dispose();
    edgeMat.dispose();
    for (const v of vertexMeshes) { v.geom.dispose(); v.mat.dispose(); }
  }

  return { update, dispose };
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function normalizedToWorld({ x, y }) {
  return { x: (x - 0.5) * WORLD_WIDTH, y: -(y - 0.5) * WORLD_HEIGHT };
}

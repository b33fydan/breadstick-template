// Drift Bands glyph — four-band horizontal drift display (Phase Enforcement
// across layers).
//
// BEAT 7. Anchored to RIGHT palm. Four horizontal bands stacked vertically,
// each a row of markers across the same pair-index axis:
//
//   Top:    ARCHITECT   — ~40% red, jagged (high drift)
//   2nd:    SKEPTIC LLM — ~35% red, medium jitter
//   3rd:    ORACLE      — mostly green BUT each Architect-red marker drips a
//                         thin red thread down to the matching Oracle slot
//                         ("verdict held, citations contaminated")
//   Bottom: LIGHT SKEP. — flat green, zero drift, the whole point
//
// The flat-bottom-vs-jagged-top contrast IS the finding. The pattern is
// pre-baked at mount so repeat viewings show the same visual signature.

import * as THREE from 'three';
import '../../lib/gestures/driftbands.js';

const RED = 0xff5252;
const GREEN = 0x26c281;
const AMBER = 0xfbbf24;

const MARKERS_PER_BAND = 22;           // visual proxy for 98 pair-indices
const BAND_HALF_WIDTH = 0.20;          // -W..+W extent along x
const BAND_VERTICAL_GAP = 0.06;        // gap between adjacent bands
const MARKER_SIZE = 0.009;
const JITTER_AMPL_ARCH = 0.018;
const JITTER_AMPL_SKEP = 0.012;
const JITTER_AMPL_ORC = 0.003;
const JITTER_HZ = 0.55;
const THREAD_OPACITY = 0.6;

// Per-band drift fractions — the visual signature of each layer's
// vulnerability to attacker prose.
const BAND_DEFS = [
  { name: 'arch',  driftFraction: 0.40, jitter: JITTER_AMPL_ARCH },
  { name: 'skep',  driftFraction: 0.35, jitter: JITTER_AMPL_SKEP },
  { name: 'orc',   driftFraction: 0.05, jitter: JITTER_AMPL_ORC },
  { name: 'lskep', driftFraction: 0.00, jitter: 0 },
];

const STAGE_W = 1280, STAGE_H = 720, FOV_DEG = 50, CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

// Deterministic per-marker drift pattern — seeded so re-mounts look identical.
function bakePattern(driftFraction) {
  const flags = new Array(MARKERS_PER_BAND);
  // Use a fixed seed walker so the pattern is identical across mounts but
  // visually irregular.
  let seed = 0.371 + driftFraction;
  for (let i = 0; i < MARKERS_PER_BAND; i++) {
    seed = (seed * 1597 + 0.731) % 1;
    flags[i] = seed < driftFraction;
  }
  return flags;
}

export function createDriftBands({ scene }) {
  const group = new THREE.Group();
  scene.add(group);

  // Compute vertical positions of the 4 bands (centered around y=0).
  const bandY = [];
  const total = BAND_DEFS.length;
  for (let i = 0; i < total; i++) {
    const offset = (i - (total - 1) / 2) * -BAND_VERTICAL_GAP; // top first
    bandY.push(offset);
  }

  // Bake the drift pattern per band.
  const patterns = BAND_DEFS.map((def) => bakePattern(def.driftFraction));

  // Per-band marker meshes.
  const bands = BAND_DEFS.map((def, bandIdx) => {
    const bandGroup = new THREE.Group();
    bandGroup.position.y = bandY[bandIdx];

    const markers = [];
    for (let i = 0; i < MARKERS_PER_BAND; i++) {
      const drifted = patterns[bandIdx][i];
      const color = drifted ? RED : (def.name === 'lskep' || def.name === 'orc' ? GREEN : AMBER);
      const geom = new THREE.IcosahedronGeometry(MARKER_SIZE, 0);
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.92,
      });
      const mesh = new THREE.Mesh(geom, mat);
      const xN = i / (MARKERS_PER_BAND - 1);
      const x = -BAND_HALF_WIDTH + xN * BAND_HALF_WIDTH * 2;
      mesh.position.set(x, 0, 0);
      bandGroup.add(mesh);
      markers.push({
        mesh, geom, mat,
        baseX: x, drifted,
        phase: Math.random() * Math.PI * 2,
      });
    }

    // Band baseline — thin horizontal line so each row reads as a row.
    const lineGeom = new THREE.BufferGeometry();
    const lineVerts = new Float32Array([
      -BAND_HALF_WIDTH, 0, 0,
       BAND_HALF_WIDTH, 0, 0,
    ]);
    lineGeom.setAttribute('position', new THREE.BufferAttribute(lineVerts, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.18,
    });
    const baseline = new THREE.Line(lineGeom, lineMat);
    bandGroup.add(baseline);

    group.add(bandGroup);
    return { def, group: bandGroup, markers, lineGeom, lineMat, jitter: def.jitter };
  });

  // Red threads: for each Architect (band 0) drifted marker, connect down to
  // the Oracle (band 2) at the same x — through Skeptic LLM band 1, visible
  // as continuous vertical line. The threads make citation contamination
  // legible: the verdict's CITED FACT slot inherited the drift.
  const archPattern = patterns[0];
  const threadGeoms = [];
  const threadMats = [];
  const archY = bandY[0];
  const orcY = bandY[2];
  for (let i = 0; i < MARKERS_PER_BAND; i++) {
    if (!archPattern[i]) continue;
    const xN = i / (MARKERS_PER_BAND - 1);
    const x = -BAND_HALF_WIDTH + xN * BAND_HALF_WIDTH * 2;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      x, archY, 0,
      x, orcY, 0,
    ]), 3));
    const mat = new THREE.LineBasicMaterial({
      color: RED, transparent: true, opacity: THREAD_OPACITY,
    });
    const line = new THREE.Line(geom, mat);
    group.add(line);
    threadGeoms.push(geom);
    threadMats.push(mat);
  }

  function update(_landmarks, gesture) {
    // Anchor: RIGHT first, LEFT fallback.
    let anchor = null;
    if (gesture?.rightPalm) anchor = gesture.rightPalm;
    else if (gesture?.leftPalm) anchor = gesture.leftPalm;
    if (!anchor) { group.visible = false; return; }
    group.visible = true;
    const w = normalizedToWorld(anchor);
    group.position.set(w.x, w.y, 0);

    // Animate jitter on drifted markers (the "jagged" reading).
    const t = performance.now() / 1000;
    for (let bi = 0; bi < bands.length; bi++) {
      const b = bands[bi];
      const jitter = b.jitter;
      for (const m of b.markers) {
        if (jitter > 0 && m.drifted) {
          m.mesh.position.y = Math.sin(t * Math.PI * 2 * JITTER_HZ + m.phase) * jitter;
        } else if (jitter > 0) {
          // Non-drifted markers in jittery bands get tiny micro-motion.
          m.mesh.position.y = Math.sin(t * Math.PI * 2 * JITTER_HZ * 0.4 + m.phase) * jitter * 0.2;
        } else {
          m.mesh.position.y = 0;
        }
      }
    }
  }

  function dispose() {
    scene.remove(group);
    for (const b of bands) {
      for (const m of b.markers) { m.geom.dispose(); m.mat.dispose(); }
      b.lineGeom.dispose();
      b.lineMat.dispose();
    }
    for (const g of threadGeoms) g.dispose();
    for (const m of threadMats) m.dispose();
  }

  return { update, dispose };
}

function normalizedToWorld({ x, y }) {
  return { x: (x - 0.5) * WORLD_WIDTH, y: -(y - 0.5) * WORLD_HEIGHT };
}

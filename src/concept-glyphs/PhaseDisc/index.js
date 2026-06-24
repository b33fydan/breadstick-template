// Phase Disc glyph — Phase 3, prop #2.
//
// Enacts ARES's Phase Enforcement invariant: Architect speaks only during
// THESIS, Skeptic only during ANTITHESIS, Oracle only during SYNTHESIS.
// No exceptions. The disc IS the phase enforcer — three sectors, only one
// active at a time, sector position determined by wrist roll.
//
// Visual layout:
// - Flat disc anchored to palm, facing camera, rotates around its own center
// - Three 120° sectors: cyan THESIS, crimson ANTITHESIS, gold SYNTHESIS
// - Spotlight fixed at world "top" — picks up whichever sector is rotated
//   under it
// - Three origami agent figurines on disc rim (Architect cone, Skeptic
//   octahedron, Oracle icosahedron), each tied to a sector. Active agent
//   floats slightly above + glows; others stay grounded + dim.
// - Sector boundary crossing fires a low-harmonic phase chime that shifts
//   by a third — the "sound of the rule firing"

import * as THREE from 'three';
import '../../lib/gestures/disc.js';
import { playPhaseChime } from '../../lib/audioPalettes.js';

const DISC_RADIUS = 0.32;
const DISC_THICKNESS = 0.012;
const AGENT_SIZE = 0.07;
const SPOTLIGHT_HEIGHT = 0.85;
const SPOTLIGHT_RADIUS = 0.10;

// Camera setup (must match conceptStage)
const STAGE_W = 1280;
const STAGE_H = 720;
const FOV_DEG = 50;
const CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

const SECTOR_COLORS = [0x06b6d4, 0xdc2626, 0xfacc15]; // cyan, crimson, gold
const SECTOR_NAMES = ['THESIS', 'ANTITHESIS', 'SYNTHESIS'];

export function createPhaseDisc({ scene }) {
  const discGroup = new THREE.Group();
  scene.add(discGroup);

  // Three sector meshes. Sector k centered at angle (k * 2π/3) - π/2 so that
  // sector 0 sits at the top of the disc when rollAngle = 0. CircleGeometry
  // with thetaStart + thetaLength carves the pie slice directly.
  const sectorMeshes = [];
  for (let k = 0; k < 3; k++) {
    const sectorAngleStart = (k * 2 * Math.PI) / 3 - Math.PI / 2 - Math.PI / 3;
    const geom = new THREE.CircleGeometry(DISC_RADIUS, 24, sectorAngleStart, (2 * Math.PI) / 3);
    const mat = new THREE.MeshBasicMaterial({
      color: SECTOR_COLORS[k],
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.z = -DISC_THICKNESS / 2;
    discGroup.add(mesh);
    sectorMeshes.push({ mesh, geom, mat, baseOpacity: 0.35 });
  }

  // Disc rim — a slightly larger ring for definition
  const rimGeom = new THREE.RingGeometry(DISC_RADIUS * 0.98, DISC_RADIUS * 1.04, 64);
  const rimMat = new THREE.MeshBasicMaterial({
    color: 0xa8a29e, // warm grey
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
  });
  const rim = new THREE.Mesh(rimGeom, rimMat);
  discGroup.add(rim);

  // Three agent figurines — each anchored to its sector's center angle.
  const agents = [];
  for (let k = 0; k < 3; k++) {
    const angle = (k * 2 * Math.PI) / 3 - Math.PI / 2;
    const px = Math.cos(angle) * DISC_RADIUS * 0.78;
    const py = Math.sin(angle) * DISC_RADIUS * 0.78;

    const geom = createAgentGeometry(k);
    const mat = new THREE.MeshBasicMaterial({
      color: SECTOR_COLORS[k],
      transparent: true,
      opacity: 0.55,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(px, py, 0.02);
    discGroup.add(mesh);
    agents.push({ mesh, geom, mat, k, basePy: py, baseOpacity: 0.55 });
  }

  // Spotlight column — fixed at world "top" relative to disc center, NOT a
  // child of discGroup so it doesn't rotate with the disc.
  const spotlightGroup = new THREE.Group();
  scene.add(spotlightGroup);
  const spotGeom = new THREE.CylinderGeometry(SPOTLIGHT_RADIUS, SPOTLIGHT_RADIUS * 0.4, SPOTLIGHT_HEIGHT, 24, 1, true);
  const spotMat = new THREE.MeshBasicMaterial({
    color: SECTOR_COLORS[0],
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
  });
  const spotlight = new THREE.Mesh(spotGeom, spotMat);
  // Spotlight beam shoots upward from disc top — position above disc by
  // half the beam height + disc radius (so the base sits on the disc top).
  spotlight.position.y = DISC_RADIUS + SPOTLIGHT_HEIGHT / 2;
  spotlightGroup.add(spotlight);

  // State for rising-edge sector-change detection
  let lastActiveSector = -1;
  let bobPhase = 0;

  function update(_landmarks, gesture) {
    if (!gesture || !gesture.palmCenter) {
      discGroup.visible = false;
      spotlightGroup.visible = false;
      return;
    }
    discGroup.visible = true;
    spotlightGroup.visible = true;

    const world = normalizedToWorld(gesture.palmCenter);
    discGroup.position.set(world.x, world.y, 0);
    discGroup.rotation.z = gesture.rollAngle || 0;
    spotlightGroup.position.set(world.x, world.y, 0);

    const active = gesture.activeSector ?? 0;

    // Update spotlight color + opacity per active sector
    spotMat.color.setHex(SECTOR_COLORS[active]);
    spotMat.opacity = 0.45;

    // Highlight active sector, dim others
    for (let k = 0; k < sectorMeshes.length; k++) {
      const isActive = k === active;
      sectorMeshes[k].mat.opacity = isActive ? 0.9 : sectorMeshes[k].baseOpacity;
    }

    // Active agent floats + glows; others stay grounded + dim
    bobPhase += 0.08;
    for (const a of agents) {
      const isActive = a.k === active;
      if (isActive) {
        a.mesh.position.y = a.basePy + 0.025 + Math.sin(bobPhase) * 0.008;
        a.mat.opacity = 0.95;
      } else {
        a.mesh.position.y = a.basePy;
        a.mat.opacity = a.baseOpacity;
      }
    }

    // Rising-edge audio on sector change. lastActiveSector starts at -1 so
    // the very first detected sector also chimes — useful as a "ready" cue.
    if (active !== lastActiveSector) {
      playPhaseChime({ phase: active });
      lastActiveSector = active;
    }
  }

  function dispose() {
    scene.remove(discGroup);
    scene.remove(spotlightGroup);
    for (const s of sectorMeshes) {
      s.geom.dispose();
      s.mat.dispose();
    }
    rimGeom.dispose();
    rimMat.dispose();
    for (const a of agents) {
      a.geom.dispose();
      a.mat.dispose();
    }
    spotGeom.dispose();
    spotMat.dispose();
  }

  return { update, dispose };
}

// Distinct silhouettes per agent so they read at a glance:
//   Architect (sector 0, cyan)    → tall narrow cone (blueprint / spire)
//   Skeptic   (sector 1, crimson) → flat double-pyramid (octahedron)
//   Oracle    (sector 2, gold)    → rounded polyhedron (icosahedron)
function createAgentGeometry(sectorIdx) {
  switch (sectorIdx) {
    case 0: return new THREE.ConeGeometry(AGENT_SIZE * 0.55, AGENT_SIZE * 1.8, 4);
    case 1: return new THREE.OctahedronGeometry(AGENT_SIZE * 0.85, 0);
    case 2: return new THREE.IcosahedronGeometry(AGENT_SIZE * 0.8, 0);
    default: return new THREE.SphereGeometry(AGENT_SIZE, 8, 8);
  }
}

function normalizedToWorld({ x, y }) {
  return {
    x: (x - 0.5) * WORLD_WIDTH,
    y: -(y - 0.5) * WORLD_HEIGHT,
  };
}

// Exported for tests/debug
export const PHASE_DISC_SECTORS = SECTOR_NAMES;

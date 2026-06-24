// Sealed Lattice Cube glyph — Phase 2, prop #1.
//
// Enacts ARES's Packet Binding invariant: agents can only see facts from
// their assigned evidence packet. The cube IS the packet — sealed, edge-lit,
// hand-anchored. Pushing two cubes together fires a glassy chime + edge
// flash, signaling magnet repel ("no cross-contamination").
//
// Side-effect import: pulls in src/lib/gestures/cube.js, which registers
// the cube recognizer with the central gestureRecognizer module. The
// recognizer computes palm-center anchor + thumb-angle scale + push state,
// so this glyph code stays focused on rendering and audio.
//
// Token drift uses vanilla bounce-in-box math instead of cannon-es. Cubes
// are hand-anchored (kinematic), so they never benefit from full physics;
// inverted-box containment for tokens would also be awkward in cannon-es.
// cannon-es stays installed for Verdict Scale (Phase 5) which needs torque.

import * as THREE from 'three';
import '../../lib/gestures/cube.js';
import { playGlassyChime } from '../../lib/audioPalettes.js';

const CUBE_RADIUS_BASE = 0.18;
const TOKEN_COUNT = 6;
const TOKEN_SIZE = 0.025;

// World-mapping constants — must match the camera setup in conceptStage.
// Camera at z=3, FOV 50°, aspect 1280/720 → visible plane at z=0 is
// WORLD_WIDTH × WORLD_HEIGHT in Three world units.
const STAGE_W = 1280;
const STAGE_H = 720;
const FOV_DEG = 50;
const CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

export function createSealedLatticeCube({ scene }) {
  const cube1 = createCubeGroup(0x06b6d4); // cyan — agent A's packet
  const tokens1 = createTokens(cube1.group, TOKEN_COUNT, 0xfacc15);
  scene.add(cube1.group);

  const cube2 = createCubeGroup(0xc084fc); // magenta — agent B's packet
  const tokens2 = createTokens(cube2.group, TOKEN_COUNT, 0xfacc15);
  // cube2 sits off-scene until the right hand enters frame

  let cube2Mounted = false;
  let wasPushing = false;

  function update(_landmarks, gesture) {
    // Cube 1 anchored to left hand
    if (gesture && gesture.leftPalm) {
      const world = normalizedToWorld(gesture.leftPalm);
      cube1.group.position.set(world.x, world.y, 0);
      cube1.group.scale.setScalar(gesture.leftScale || 1);
      cube1.group.visible = true;
    } else {
      cube1.group.visible = false;
    }

    // Cube 2 anchored to right hand. Mount/unmount as the hand enters/leaves
    // frame so we don't render a stale cube at (0,0,0).
    if (gesture && gesture.rightPalm) {
      if (!cube2Mounted) {
        scene.add(cube2.group);
        cube2Mounted = true;
      }
      const world = normalizedToWorld(gesture.rightPalm);
      cube2.group.position.set(world.x, world.y, 0);
      cube2.group.scale.setScalar(gesture.rightScale || 1);
    } else if (cube2Mounted) {
      scene.remove(cube2.group);
      cube2Mounted = false;
    }

    // Push detection — rising-edge only. wasPushing prevents the chime from
    // re-firing every frame while palms hover at threshold.
    if (gesture && gesture.push && !wasPushing) {
      playGlassyChime({ pitch: 1.0 });
      flashCubeEdges(cube1, 1.0);
      flashCubeEdges(cube2, 1.0);
    }
    wasPushing = !!(gesture && gesture.push);

    // Tween edge flash back to baseline every frame
    decayEdgeFlash(cube1);
    decayEdgeFlash(cube2);

    // Drift tokens inside each visible cube
    updateTokens(tokens1, CUBE_RADIUS_BASE);
    if (cube2Mounted) updateTokens(tokens2, CUBE_RADIUS_BASE);
  }

  function dispose() {
    scene.remove(cube1.group);
    if (cube2Mounted) scene.remove(cube2.group);
    cube1.dispose();
    cube2.dispose();
    disposeTokens(tokens1);
    disposeTokens(tokens2);
  }

  return { update, dispose };
}

function createCubeGroup(color) {
  const group = new THREE.Group();

  // Wireframe dodecahedron — the primary visual.
  const geom = new THREE.DodecahedronGeometry(CUBE_RADIUS_BASE, 0);
  const edges = new THREE.EdgesGeometry(geom);
  const edgeMat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
  });
  const wireframe = new THREE.LineSegments(edges, edgeMat);
  group.add(wireframe);

  // Inner ambient glow — translucent solid, slightly smaller than wireframe.
  // Sells "sealed" feel — there's something in there, not just an open frame.
  const innerGeom = new THREE.DodecahedronGeometry(CUBE_RADIUS_BASE * 0.92, 0);
  const innerMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.06,
  });
  const inner = new THREE.Mesh(innerGeom, innerMat);
  group.add(inner);

  const state = { edgeMat, baseOpacity: 0.95, flashLevel: 0 };

  return {
    group,
    state,
    dispose() {
      geom.dispose();
      edges.dispose();
      edgeMat.dispose();
      innerGeom.dispose();
      innerMat.dispose();
    },
  };
}

function flashCubeEdges(cube, level) {
  cube.state.flashLevel = level;
  cube.state.edgeMat.opacity = Math.min(1, cube.state.baseOpacity + level * 0.3);
}

function decayEdgeFlash(cube) {
  if (cube.state.flashLevel > 0.001) {
    cube.state.flashLevel *= 0.92;
    cube.state.edgeMat.opacity = Math.min(1, cube.state.baseOpacity + cube.state.flashLevel * 0.3);
  } else if (cube.state.edgeMat.opacity !== cube.state.baseOpacity) {
    cube.state.edgeMat.opacity = cube.state.baseOpacity;
  }
}

function createTokens(parentGroup, count, color) {
  const tokens = [];
  const inner = CUBE_RADIUS_BASE * 0.7;
  const baseVelocity = 0.002;
  for (let i = 0; i < count; i++) {
    const geom = new THREE.IcosahedronGeometry(TOKEN_SIZE, 0);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(
      (Math.random() - 0.5) * inner,
      (Math.random() - 0.5) * inner,
      (Math.random() - 0.5) * inner,
    );
    mesh.userData.vx = (Math.random() - 0.5) * baseVelocity;
    mesh.userData.vy = (Math.random() - 0.5) * baseVelocity;
    mesh.userData.vz = (Math.random() - 0.5) * baseVelocity;
    parentGroup.add(mesh);
    tokens.push({ mesh, geom, mat });
  }
  return tokens;
}

function updateTokens(tokens, cubeRadius) {
  const bound = cubeRadius * 0.78;
  for (const t of tokens) {
    const p = t.mesh.position;
    p.x += t.mesh.userData.vx;
    p.y += t.mesh.userData.vy;
    p.z += t.mesh.userData.vz;
    if (Math.abs(p.x) > bound) t.mesh.userData.vx = -t.mesh.userData.vx;
    if (Math.abs(p.y) > bound) t.mesh.userData.vy = -t.mesh.userData.vy;
    if (Math.abs(p.z) > bound) t.mesh.userData.vz = -t.mesh.userData.vz;
  }
}

function disposeTokens(tokens) {
  for (const t of tokens) {
    t.geom.dispose();
    t.mat.dispose();
  }
}

function normalizedToWorld({ x, y }) {
  return {
    x: (x - 0.5) * WORLD_WIDTH,
    y: -(y - 0.5) * WORLD_HEIGHT,
  };
}

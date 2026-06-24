// Stretch Tile glyph — pinch-and-drag deformable tile.
//
// A floating holographic quad with four corner dots (blue / yellow / red /
// white). Initial state: a centered square between the operator's two
// palms. Pinch (thumb + index together) near a corner to GRAB it; while
// pinching, drag the corner anywhere; release the pinch to leave the
// corner where it is. The tile holds whatever shape you draw with it.
//
// Two hands can hold two different corners simultaneously — pull them
// apart and the tile stretches diagonally between your hands.
//
// Mental model:
//   recognizer → { leftPinch, rightPinch }   (where + whether pinching)
//   glyph state → per-corner { pos, grabbedBy }
//   per frame:
//     for each hand:
//       on pinch-onset → find nearest corner within grab radius, mark as
//         grabbed by this hand
//       while pinching → corner.pos = pinch.world
//       on pinch-release → unmark grabbedBy
//   render:
//     dots at corner.pos
//     quad mesh fill (two triangles with mutated vertex positions)
//     outline (four line segments between corners)

import * as THREE from 'three';
import '../../lib/gestures/stretchtile.js';
import { playStretchGrab, playStretchRelease } from '../../lib/audioPalettes.js';

const TILE_HALF = 0.18;          // initial half-width of the square
const DOT_RADIUS = 0.038;        // bumped from 0.022 — more visible target
const GRAB_RADIUS_WORLD = 0.18;  // bumped from 0.09 — generous hit-box so
                                  // hand-tracking jitter never costs you a grab
const FILL_COLOR = 0x4dd0e1;     // cyan holographic fill
const OUTLINE_COLOR = 0xa8a29e;  // warm grey

// Corners, ordered TL → TR → BR → BL (clockwise from top-left). This order
// is load-bearing for the quad triangulation below — change at your peril.
const CORNERS = [
  { color: 0x4dd0e1, baseOffset: { x: -TILE_HALF, y:  TILE_HALF }, name: 'blue'   },
  { color: 0xfacc15, baseOffset: { x:  TILE_HALF, y:  TILE_HALF }, name: 'yellow' },
  { color: 0xff5252, baseOffset: { x:  TILE_HALF, y: -TILE_HALF }, name: 'red'    },
  { color: 0xffffff, baseOffset: { x: -TILE_HALF, y: -TILE_HALF }, name: 'white'  },
];

const STAGE_W = 1280, STAGE_H = 720, FOV_DEG = 50, CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

export function createStretchTile({ scene }) {
  const group = new THREE.Group();
  scene.add(group);

  // Corner dot meshes. Each dot owns its own material so per-corner glow
  // doesn't bleed into siblings.
  const corners = CORNERS.map((def) => {
    const geom = new THREE.IcosahedronGeometry(DOT_RADIUS, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: def.color,
      transparent: true,
      opacity: 0.95,
    });
    const mesh = new THREE.Mesh(geom, mat);
    group.add(mesh);
    return {
      mesh, geom, mat,
      def,
      pos: { x: 0, y: 0 },  // world position, set on first frame init
      grabbedBy: null,       // 'left' | 'right' | null
      glow: 0,
    };
  });

  // Quad fill — two triangles forming a deformable rectangle from the four
  // corner positions. We allocate a 6-vertex (2 triangles × 3 verts) buffer
  // and rewrite it every frame from the corner positions.
  const quadGeom = new THREE.BufferGeometry();
  const quadVerts = new Float32Array(6 * 3);
  quadGeom.setAttribute('position', new THREE.BufferAttribute(quadVerts, 3));
  const quadMat = new THREE.MeshBasicMaterial({
    color: FILL_COLOR,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
  });
  const quad = new THREE.Mesh(quadGeom, quadMat);
  group.add(quad);

  // Outline — four LINE segments (not a closed loop) because LineSegments
  // wants vertex pairs. 4 segments × 2 verts × 3 components = 24 floats.
  const outlineGeom = new THREE.BufferGeometry();
  const outlineVerts = new Float32Array(4 * 2 * 3);
  outlineGeom.setAttribute('position', new THREE.BufferAttribute(outlineVerts, 3));
  const outlineMat = new THREE.LineBasicMaterial({
    color: OUTLINE_COLOR,
    transparent: true,
    opacity: 0.6,
  });
  const outline = new THREE.LineSegments(outlineGeom, outlineMat);
  group.add(outline);

  // Per-hand previous-pinch state for rising/falling-edge grab detection.
  let wasPinchingLeft = false;
  let wasPinchingRight = false;
  let initialized = false;
  let lastFrameTime = performance.now() / 1000;

  function update(_landmarks, gesture) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - lastFrameTime);
    lastFrameTime = now;

    const leftSeen = !!gesture?.leftPinch;
    const rightSeen = !!gesture?.rightPinch;
    if (!leftSeen && !rightSeen) {
      group.visible = false;
      return;
    }
    group.visible = true;

    // First-frame initialization: place corners around the palm midpoint
    // (or single-palm anchor if only one hand is in frame). After this the
    // corners are in WORLD positions and only move when grabbed.
    if (!initialized) {
      const mid = computeMidpoint(gesture);
      for (const c of corners) {
        c.pos.x = mid.x + c.def.baseOffset.x;
        c.pos.y = mid.y + c.def.baseOffset.y;
      }
      initialized = true;
    }

    // Process per-hand pinch state. handleHand mutates corner state in place.
    handleHand('left', gesture?.leftPinch, wasPinchingLeft);
    handleHand('right', gesture?.rightPinch, wasPinchingRight);
    wasPinchingLeft = !!gesture?.leftPinch?.pinching;
    wasPinchingRight = !!gesture?.rightPinch?.pinching;

    // Decay per-corner glow → returns dots to baseline after a grab pulse.
    for (const c of corners) {
      c.glow = Math.max(0, c.glow - dt * 2.4);
      c.mesh.position.set(c.pos.x, c.pos.y, 0);
      c.mesh.scale.setScalar(1 + c.glow * 0.55);
      c.mat.opacity = 0.85 + c.glow * 0.15;
    }

    // Rewrite the quad mesh — two triangles spanning the four corners:
    //   Triangle A: TL, TR, BR
    //   Triangle B: TL, BR, BL
    // This triangulation works even when the corners are stretched into
    // non-rectangular shapes (the quad becomes a convex/concave polygon).
    const TL = corners[0].pos, TR = corners[1].pos, BR = corners[2].pos, BL = corners[3].pos;
    quadVerts[0]  = TL.x; quadVerts[1]  = TL.y; quadVerts[2]  = 0;
    quadVerts[3]  = TR.x; quadVerts[4]  = TR.y; quadVerts[5]  = 0;
    quadVerts[6]  = BR.x; quadVerts[7]  = BR.y; quadVerts[8]  = 0;
    quadVerts[9]  = TL.x; quadVerts[10] = TL.y; quadVerts[11] = 0;
    quadVerts[12] = BR.x; quadVerts[13] = BR.y; quadVerts[14] = 0;
    quadVerts[15] = BL.x; quadVerts[16] = BL.y; quadVerts[17] = 0;
    quadGeom.attributes.position.needsUpdate = true;

    // Rewrite the outline — 4 edges as separate segments.
    writeSegment(outlineVerts, 0,  TL, TR);
    writeSegment(outlineVerts, 6,  TR, BR);
    writeSegment(outlineVerts, 12, BR, BL);
    writeSegment(outlineVerts, 18, BL, TL);
    outlineGeom.attributes.position.needsUpdate = true;

    // Brighten the outline subtly when any corner is held — confirms "I'm
    // listening to your drag" without being loud.
    const anyHeld = corners.some((c) => c.grabbedBy);
    outlineMat.opacity = anyHeld ? 0.85 : 0.6;
  }

  function handleHand(handName, pinch, wasPinching) {
    // Tracking lost mid-action → drop whatever this hand was holding.
    if (!pinch) {
      for (const c of corners) {
        if (c.grabbedBy === handName) {
          c.grabbedBy = null;
          playStretchRelease({ volume: 0.10 });
        }
      }
      return;
    }

    const pinchWorld = normalizedToWorld(pinch);
    const isPinching = pinch.pinching;

    // Pinch onset — try to GRAB the nearest unclaimed corner.
    if (isPinching && !wasPinching) {
      let nearest = null;
      let bestD = GRAB_RADIUS_WORLD;
      for (const c of corners) {
        if (c.grabbedBy && c.grabbedBy !== handName) continue;
        const d = Math.hypot(pinchWorld.x - c.pos.x, pinchWorld.y - c.pos.y);
        if (d < bestD) { bestD = d; nearest = c; }
      }
      if (nearest) {
        // Defensive: if this hand somehow still holds another corner, drop it.
        for (const c of corners) if (c.grabbedBy === handName && c !== nearest) c.grabbedBy = null;
        nearest.grabbedBy = handName;
        nearest.glow = 1;
        playStretchGrab({ volume: 0.15 });
      }
    }

    // Pinch release — let go of whatever this hand was holding.
    if (!isPinching && wasPinching) {
      for (const c of corners) {
        if (c.grabbedBy === handName) {
          c.grabbedBy = null;
          playStretchRelease({ volume: 0.12 });
        }
      }
    }

    // While pinching → the held corner LATCHES to the pinch point. Position
    // is set directly (no easing) so the drag feels 1:1 with the hand.
    if (isPinching) {
      for (const c of corners) {
        if (c.grabbedBy === handName) {
          c.pos.x = pinchWorld.x;
          c.pos.y = pinchWorld.y;
        }
      }
    }
  }

  function dispose() {
    scene.remove(group);
    for (const c of corners) { c.geom.dispose(); c.mat.dispose(); }
    quadGeom.dispose();
    quadMat.dispose();
    outlineGeom.dispose();
    outlineMat.dispose();
  }

  return { update, dispose };
}

function computeMidpoint(gesture) {
  if (gesture?.leftPinch && gesture?.rightPinch) {
    const lw = normalizedToWorld(gesture.leftPinch);
    const rw = normalizedToWorld(gesture.rightPinch);
    return { x: (lw.x + rw.x) / 2, y: (lw.y + rw.y) / 2 };
  }
  if (gesture?.leftPinch) return normalizedToWorld(gesture.leftPinch);
  return normalizedToWorld(gesture.rightPinch);
}

function writeSegment(buf, offset, a, b) {
  buf[offset]     = a.x; buf[offset + 1] = a.y; buf[offset + 2] = 0;
  buf[offset + 3] = b.x; buf[offset + 4] = b.y; buf[offset + 5] = 0;
}

function normalizedToWorld({ x, y }) {
  return { x: (x - 0.5) * WORLD_WIDTH, y: -(y - 0.5) * WORLD_HEIGHT };
}

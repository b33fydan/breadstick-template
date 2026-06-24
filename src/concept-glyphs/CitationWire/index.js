// Citation Wire glyph — Phase 3, prop #3.
//
// Enacts ARES's Evidence Grounding invariant: every assertion must cite
// fact_ids that exist in the packet. Wire connects fact_token (left hand)
// to assertion_card (right hand). Wire pulses softly while taut; sudden-
// yank gesture (operator pulls hands apart) snaps the wire with a sharp
// crack + brief spark shower + red bloom. The "fake fact" → UnknownFactError.
//
// v1 scope:
// - Always show fact token (left) + assertion card (right) + wire between
// - Wire = simple Line geometry, color pulses 2Hz when taut
// - On snap event: wire fades to red briefly + shock-flash + audio
// - The literal "fake fact" swap is operator pantomime in v1 (any sudden
//   yank reads as the bad-cite moment).

import * as THREE from 'three';
import '../../lib/gestures/wire.js';
import { playWireSnap } from '../../lib/audioPalettes.js';

// Camera setup must match conceptStage
const STAGE_W = 1280;
const STAGE_H = 720;
const FOV_DEG = 50;
const CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

const FACT_COLOR = 0xfacc15; // gold — matches Cube's drifting fact-token color
const CARD_COLOR = 0x06b6d4; // cyan — assertion
const SNAP_COLOR = 0xef4444; // red — error/snap state
const SNAP_DURATION_FRAMES = 60; // ~1s at 60fps

export function createCitationWire({ scene }) {
  // Fact token (left hand) — small geometric solid
  const tokenGeom = new THREE.IcosahedronGeometry(0.05, 0);
  const tokenMat = new THREE.MeshBasicMaterial({
    color: FACT_COLOR,
    transparent: true,
    opacity: 0.9,
  });
  const token = new THREE.Mesh(tokenGeom, tokenMat);
  scene.add(token);

  // Assertion card (right hand) — flat hexagon facing camera
  const cardShape = new THREE.Shape();
  const cardR = 0.09;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * cardR;
    const y = Math.sin(a) * cardR;
    if (i === 0) cardShape.moveTo(x, y);
    else cardShape.lineTo(x, y);
  }
  cardShape.closePath();
  const cardGeom = new THREE.ShapeGeometry(cardShape);
  const cardMat = new THREE.MeshBasicMaterial({
    color: CARD_COLOR,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });
  const card = new THREE.Mesh(cardGeom, cardMat);
  scene.add(card);

  // Card edge — outline for definition
  const cardEdgeGeom = new THREE.EdgesGeometry(cardGeom);
  const cardEdgeMat = new THREE.LineBasicMaterial({
    color: CARD_COLOR,
    transparent: true,
    opacity: 0.95,
  });
  const cardEdge = new THREE.LineSegments(cardEdgeGeom, cardEdgeMat);
  scene.add(cardEdge);

  // Wire — single line segment, endpoints updated each frame
  const wireGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 0),
  ]);
  const wireMat = new THREE.LineBasicMaterial({
    color: CARD_COLOR,
    transparent: true,
    opacity: 0.7,
  });
  const wire = new THREE.Line(wireGeom, wireMat);
  scene.add(wire);

  let pulsePhase = 0;
  let snapFrames = 0;

  function update(_landmarks, gesture) {
    if (!gesture) return;

    // Fact token on left palm
    if (gesture.leftPalm) {
      const w = normalizedToWorld(gesture.leftPalm);
      token.position.set(w.x, w.y, 0);
      token.rotation.x += 0.02;
      token.rotation.y += 0.015;
      token.visible = true;
    } else {
      token.visible = false;
    }

    // Assertion card on right palm
    if (gesture.rightPalm) {
      const w = normalizedToWorld(gesture.rightPalm);
      card.position.set(w.x, w.y, 0);
      cardEdge.position.set(w.x, w.y, 0);
      card.visible = true;
      cardEdge.visible = true;
    } else {
      card.visible = false;
      cardEdge.visible = false;
    }

    // Wire between the two — only visible when both hands tracked
    if (gesture.leftPalm && gesture.rightPalm) {
      const lw = normalizedToWorld(gesture.leftPalm);
      const rw = normalizedToWorld(gesture.rightPalm);
      const positions = wire.geometry.attributes.position.array;
      positions[0] = lw.x; positions[1] = lw.y; positions[2] = 0;
      positions[3] = rw.x; positions[4] = rw.y; positions[5] = 0;
      wire.geometry.attributes.position.needsUpdate = true;
      wire.geometry.computeBoundingSphere();
      wire.visible = true;

      // Snap event — rising edge from gesture.snap
      if (gesture.snap && snapFrames === 0) {
        snapFrames = SNAP_DURATION_FRAMES;
        playWireSnap();
      }
    } else {
      wire.visible = false;
    }

    // Wire color pulse + snap flash
    if (snapFrames > 0) {
      wireMat.color.setHex(SNAP_COLOR);
      wireMat.opacity = 0.3 + (snapFrames / SNAP_DURATION_FRAMES) * 0.6;
      cardEdgeMat.color.setHex(SNAP_COLOR);
      snapFrames -= 1;
    } else {
      pulsePhase += 0.12;
      const pulse = 0.5 + 0.5 * Math.sin(pulsePhase);
      wireMat.color.setHex(CARD_COLOR);
      wireMat.opacity = 0.4 + pulse * 0.4;
      cardEdgeMat.color.setHex(CARD_COLOR);
    }
  }

  function dispose() {
    scene.remove(token);
    scene.remove(card);
    scene.remove(cardEdge);
    scene.remove(wire);
    tokenGeom.dispose(); tokenMat.dispose();
    cardGeom.dispose(); cardMat.dispose();
    cardEdgeGeom.dispose(); cardEdgeMat.dispose();
    wireGeom.dispose(); wireMat.dispose();
  }

  return { update, dispose };
}

function normalizedToWorld({ x, y }) {
  return {
    x: (x - 0.5) * WORLD_WIDTH,
    y: -(y - 0.5) * WORLD_HEIGHT,
  };
}

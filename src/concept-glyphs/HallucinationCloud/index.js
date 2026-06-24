// Hallucination Cloud glyph — ARES BEAT 2 (what we made physically impossible).
//
// Anchored at the operator's palm (either hand). A cloud of ASCII characters
// arranged on a fibonacci sphere shell, each character flickering through a
// chaos vocabulary at random colors every ~150ms. Spins continuously. Reads
// as "AI hallucinating" — unstable, never the same twice, characters that
// could mean anything.
//
// This is the WRONG state in the BEAT 2 narrative. The next prop (HashSeal)
// shows how we sealed it. Together: "here's the chaos → here's the seal."
//
// Size is 1.2× the NeuroGraph radius per spec — bigger than the
// Tribunal's Architect/Skeptic graphs so it visually dominates as the
// thing being replaced.

import * as THREE from 'three';
import '../../lib/gestures/hallucinationcloud.js';

// ─── Cloud sizing ──────────────────────────────────────────────────────
// Significantly larger than the NeuroGraph baseline so the cloud reads as
// a dominant presence — this is the chaos that the next prop (HashSeal)
// supplants. Characters scale up proportionally so they don't look tiny
// inside the bigger volume.
const CLOUD_RADIUS  = 0.32;          // ≈2× original (was 0.192)
const NODE_COUNT    = 22;            // bumped from 18 to fill the larger shell
const NODE_SPRITE   = 0.105;         // world units per char sprite
const EDGE_RADIUS   = 0.27;          // proportional to new CLOUD_RADIUS
const FLOAT_OFFSET  = 0.08;          // extra lift so cloud doesn't sit on the hand
const SPIN_SPEED    = 0.9;           // rad/sec — Y axis primary
const SPIN_TUMBLE_X = 0.25;          // secondary tumble for visual interest

// ─── ASCII chaos ───────────────────────────────────────────────────────
// Mix of digits, brackets, math symbols — looks "data-y" without being any
// real language. Excludes whitespace + lowercase to keep visual density.
const CHAOS_VOCAB = '01!@#$%^&*<>{}[]?~+-=|/\\§¶±×÷∞';
const FLICKER_MS = 150;              // how often each sprite repaints

// ─── World mapping (matches conceptStage camera config) ────────────────
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

export function createHallucinationCloud({ scene }) {
  const root = new THREE.Group();
  scene.add(root);
  root.visible = false;

  // ─── Node sprites (ASCII chars on fibonacci sphere shell) ──────────
  const positions = fibonacciSpherePoints(NODE_COUNT, CLOUD_RADIUS);
  const nodes = positions.map((pos, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(pos.x, pos.y, pos.z);
    sprite.scale.set(NODE_SPRITE, NODE_SPRITE, 1);
    root.add(sprite);

    // Stagger per-sprite flicker phase so they don't all repaint on the
    // same frame — keeps the chaos feeling continuous rather than pulsed.
    const flickerPhase = (i * 31) % FLICKER_MS;
    paintFlicker(canvas, ctx, texture, randomChar(), randomBrightHSL());

    return { sprite, canvas, ctx, texture, material, flickerPhase, lastFlicker: 0 };
  });

  // ─── Faint connector edges ─────────────────────────────────────────
  // Helps the cloud read as a "graph" rather than just floating characters.
  // Drawn at low opacity so the eye reads "structure underneath chaos."
  const edgePairs = [];
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i];
      const b = positions[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d < EDGE_RADIUS) edgePairs.push([i, j]);
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
    color: 0x6b7280,                   // dim gray; the chaos is the chars, not the wires
    transparent: true,
    opacity: 0.25,
    blending: THREE.AdditiveBlending,
  });
  const edgeLines = new THREE.LineSegments(edgeGeom, edgeMat);
  root.add(edgeLines);

  function update(_landmarks, gesture) {
    const nowMs = performance.now();
    const nowS = nowMs / 1000;

    if (!gesture?.visible || !gesture.palm) {
      root.visible = false;
      return;
    }
    root.visible = true;

    // Anchor — palm position with a small float offset above the hand.
    const w = normalizedToWorld(gesture.palm);
    root.position.set(w.x, w.y + FLOAT_OFFSET, 0);

    // Continuous spin. Multi-axis tumble keeps it visually engaging.
    root.rotation.y = nowS * SPIN_SPEED;
    root.rotation.x = nowS * SPIN_SPEED * SPIN_TUMBLE_X;

    // Flicker: each sprite repaints with a fresh char + color when its
    // staggered phase ticks past FLICKER_MS.
    for (const n of nodes) {
      if (nowMs - n.lastFlicker >= FLICKER_MS) {
        n.lastFlicker = nowMs;
        paintFlicker(n.canvas, n.ctx, n.texture, randomChar(), randomBrightHSL());
      }
    }
  }

  function dispose() {
    scene.remove(root);
    for (const n of nodes) {
      n.texture.dispose();
      n.material.dispose();
    }
    edgeGeom.dispose();
    edgeMat.dispose();
  }

  return { update, dispose };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function paintFlicker(canvas, ctx, texture, char, color) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 44px "Courier New", "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fillText(char, canvas.width / 2, canvas.height / 2);
  texture.needsUpdate = true;
}

function randomChar() {
  return CHAOS_VOCAB[Math.floor(Math.random() * CHAOS_VOCAB.length)];
}

// Bright saturated HSL — full range of hues. The constant color-rotation
// is part of "hallucination": no two readings are the same.
function randomBrightHSL() {
  const h = Math.floor(Math.random() * 360);
  return `hsl(${h}, 90%, 65%)`;
}

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

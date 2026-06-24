// Hash Seal glyph — ARES BEAT 2 (immutable Fact ID + cryptographic shell).
//
// Concept: an "ID" rectangle floats at scene center. The operator paints
// the cryptographic seal around it by extending lines from their index
// fingertips toward an invisible sphere shell — each line lights up the
// nearest seed point on the sphere. Over time, the sphere literally
// FORMS from the act of sealing. Once 70% of seed points are lit, the
// shell completes (flash + chime) — the Fact is sealed.
//
// Continuous channel: lit-percentage of seed points (the sealing progress)
// Discrete event: completion threshold crossed → SEAL flash + chime
//
// Resets 3.5s after seal so the demo can loop without prop-swap.

import * as THREE from 'three';
import '../../lib/gestures/hashseal.js';
import { playStretchGrab, playOracleAdjudicate } from '../../lib/audioPalettes.js';

// ─── Sizing ─────────────────────────────────────────────────────────────
const RECT_W = 0.30;                  // 50% bigger than original (was 0.20)
const RECT_H = 0.165;                 // 50% bigger than original (was 0.11)
const SPHERE_R = 0.40;                // 25% bigger than original (was 0.32)
const SEED_COUNT = 80;
const SEED_SIZE = 0.014;
const SEED_NEIGHBORS = 4;             // each seed connects to its K nearest for edge web
const ACTIVATION_DIST = 0.08;         // bumped slightly with larger sphere so seeds remain catchable
const SEAL_THRESHOLD = 0.70;          // fraction lit to trigger SEAL
const SEAL_FLASH_MS = 600;
const SEAL_RESET_MS = 3500;           // total time before fade-back-to-zero
const MAX_CURSOR_LINES = 10;          // 5 fingertips × 2 hands

// Colors
const COLOR_SHELL    = 0xffffff;     // white — sphere seeds + edges (high-contrast on any background)
const COLOR_LINE     = 0xfff700;     // neon yellow — fingertip cursor lines
const COLOR_RECT     = 0x0e7490;     // dark cyan rectangle base
const COLOR_FLASH    = 0xffffff;

// Baseline visibility floor — unlit seeds + edges glow faintly so the
// lattice is always present, then brighten as fingertips paint.
const SEED_BASELINE_OPACITY = 0.22;
const EDGE_BASELINE_INTENSITY = 0.18;

// ─── World mapping ──────────────────────────────────────────────────────
// Stage dimensions accepted as creator params (default 1280×720 for backward
// compat with Concept Composer's webcam stage). 9:16 callers pass 720×1280.
const DEFAULT_STAGE_W = 1280;
const DEFAULT_STAGE_H = 720;
const FOV_DEG = 50;
const CAMERA_Z = 3;

function makeNormalizedToWorld(stageW, stageH) {
  const aspect = stageW / stageH;
  const worldHeight = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
  const worldWidth = worldHeight * aspect;
  return ({ x, y }) => ({
    x: (x - 0.5) * worldWidth,
    y: -(y - 0.5) * worldHeight,
  });
}

export function createHashSeal({ scene, stageW = DEFAULT_STAGE_W, stageH = DEFAULT_STAGE_H }) {
  const normalizedToWorld = makeNormalizedToWorld(stageW, stageH);
  const root = new THREE.Group();
  scene.add(root);

  // ─── ID rectangle (holographic plane with canvas-textured label) ──
  const rectCanvas = document.createElement('canvas');
  rectCanvas.width = 512;
  rectCanvas.height = 256;
  paintIdRect(rectCanvas, false);
  const rectTexture = new THREE.CanvasTexture(rectCanvas);
  rectTexture.minFilter = THREE.LinearFilter;
  rectTexture.magFilter = THREE.LinearFilter;
  const rectMat = new THREE.MeshBasicMaterial({
    map: rectTexture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const rectGeom = new THREE.PlaneGeometry(RECT_W, RECT_H);
  const rectMesh = new THREE.Mesh(rectGeom, rectMat);
  root.add(rectMesh);

  // ─── Seed points on invisible sphere shell ────────────────────────
  const seedPositions = fibonacciSpherePoints(SEED_COUNT, SPHERE_R);
  const seeds = seedPositions.map((pos) => {
    const geom = new THREE.SphereGeometry(SEED_SIZE, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: COLOR_SHELL,
      transparent: true,
      opacity: 0,                     // invisible until painted
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    root.add(mesh);
    return { mesh, geom, mat, pos, lit: 0 };   // lit: 0..1, target opacity
  });

  // ─── Near-neighbor edges (K-nearest per seed, deduped) ────────────
  const edgePairs = computeKNearestPairs(seedPositions, SEED_NEIGHBORS);
  const edgePos = new Float32Array(edgePairs.length * 2 * 3);
  // Vertex colors — RGB per endpoint. Brightness rides the dimmer of the
  // two endpoints' lit values (only bright when BOTH ends are lit). We
  // pre-multiply alpha into RGB since LineBasicMaterial.vertexColors is
  // RGB-only.
  const edgeColorBuf = new Float32Array(edgePairs.length * 2 * 3);
  edgePairs.forEach(([i, j], k) => {
    const a = seedPositions[i];
    const b = seedPositions[j];
    edgePos[k * 6 + 0] = a.x; edgePos[k * 6 + 1] = a.y; edgePos[k * 6 + 2] = a.z;
    edgePos[k * 6 + 3] = b.x; edgePos[k * 6 + 4] = b.y; edgePos[k * 6 + 5] = b.z;
  });
  const edgeGeom = new THREE.BufferGeometry();
  edgeGeom.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
  edgeGeom.setAttribute('color', new THREE.BufferAttribute(edgeColorBuf, 3));
  const edgeMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
  });
  const edgeLines = new THREE.LineSegments(edgeGeom, edgeMat);
  root.add(edgeLines);

  // ─── Fingertip cursor lines (up to 10, one per visible fingertip) ──
  // ALL fingertips paint — thumb / index / middle / ring / pinky on each
  // hand. One BufferGeometry holds every line; drawRange controls how
  // many are currently rendered based on how many fingertips are visible.
  const cursorPos = new Float32Array(MAX_CURSOR_LINES * 2 * 3);   // 10 lines × 2 vertices × 3 floats
  const cursorGeom = new THREE.BufferGeometry();
  cursorGeom.setAttribute('position', new THREE.BufferAttribute(cursorPos, 3));
  cursorGeom.setDrawRange(0, 0);
  const cursorMat = new THREE.LineBasicMaterial({
    color: COLOR_LINE,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
  });
  const cursorLines = new THREE.LineSegments(cursorGeom, cursorMat);
  root.add(cursorLines);

  // ─── State ─────────────────────────────────────────────────────────
  let sealedAt = -Infinity;             // performance.now() / 1000 of last SEAL trigger
  let sealed = false;                   // true between SEAL and reset

  // Reusable color object — avoids allocating per-frame.
  const tmpColor = new THREE.Color();

  function update(_landmarks, gesture) {
    const nowS = performance.now() / 1000;

    // Reset cycle: SEAL_RESET_MS after seal, fade everything back to zero
    // so the next demo runs from a clean state.
    if (sealed && (nowS - sealedAt) * 1000 > SEAL_RESET_MS) {
      sealed = false;
      for (const s of seeds) s.lit = 0;
    }

    // ─── Fingertip projection + seed lighting ──────────────────────
    // All fingertips (thumb / index / middle / ring / pinky) on each
    // hand paint independently. Cap at MAX_CURSOR_LINES so the buffer
    // never overruns even with degenerate landmark frames.
    let cursorCount = 0;
    const tipBatches = [gesture?.leftFingertips, gesture?.rightFingertips];
    for (const tips of tipBatches) {
      if (!tips) continue;
      for (const tip of tips) {
        if (cursorCount >= MAX_CURSOR_LINES * 2) break;
        const w = normalizedToWorld(tip);
        const seedIdx = nearestSeedIndex(seeds, w);
        paintCursor(cursorPos, cursorCount, w, seeds[seedIdx].pos);
        cursorCount += 2;
        maybeLightSeed(seeds[seedIdx], w);
      }
    }
    cursorGeom.setDrawRange(0, cursorCount);
    cursorGeom.attributes.position.needsUpdate = true;

    // ─── Seed opacity render ───────────────────────────────────────
    // During flash, override all seeds to white-hot. During fade-out
    // (between SEAL and reset), all seeds glow at peak before going
    // back to per-seed lit values.
    const flashAge = (nowS - sealedAt) * 1000;
    const inFlash = sealed && flashAge < SEAL_FLASH_MS;
    if (inFlash) {
      const flashT = flashAge / SEAL_FLASH_MS;
      const tri = 1 - Math.abs(flashT - 0.5) * 2;
      tmpColor.setHex(COLOR_SHELL).lerp(_white, tri);
      for (const s of seeds) {
        s.mat.color.copy(tmpColor);
        s.mat.opacity = 1.0;
      }
      paintIdRect(rectCanvas, true);
      rectTexture.needsUpdate = true;
    } else {
      for (const s of seeds) {
        s.mat.color.setHex(COLOR_SHELL);
        s.mat.opacity = Math.max(SEED_BASELINE_OPACITY, s.lit);
      }
      paintIdRect(rectCanvas, false);
      rectTexture.needsUpdate = true;
    }

    // ─── Edge color buffer (cheap per-vertex write) ────────────────
    // Each edge's vertex-pair gets brightness = min(litA, litB) so an
    // edge only appears at full intensity when both endpoints are sealed.
    const shellR = ((COLOR_SHELL >> 16) & 0xff) / 255;
    const shellG = ((COLOR_SHELL >> 8) & 0xff) / 255;
    const shellB = (COLOR_SHELL & 0xff) / 255;
    edgePairs.forEach(([i, j], k) => {
      const litA = seeds[i].lit;
      const litB = seeds[j].lit;
      const litIntensity = Math.min(litA, litB);
      const intensity = inFlash ? 1.0 : Math.max(EDGE_BASELINE_INTENSITY, litIntensity);
      const r = shellR * intensity;
      const g = shellG * intensity;
      const b = shellB * intensity;
      edgeColorBuf[k * 6 + 0] = r; edgeColorBuf[k * 6 + 1] = g; edgeColorBuf[k * 6 + 2] = b;
      edgeColorBuf[k * 6 + 3] = r; edgeColorBuf[k * 6 + 4] = g; edgeColorBuf[k * 6 + 5] = b;
    });
    edgeGeom.attributes.color.needsUpdate = true;

    // ─── Completion check ──────────────────────────────────────────
    if (!sealed) {
      let litCount = 0;
      for (const s of seeds) if (s.lit >= 0.95) litCount++;
      if (litCount / SEED_COUNT >= SEAL_THRESHOLD) {
        sealed = true;
        sealedAt = nowS;
        playOracleAdjudicate({ volume: 0.28 });
      }
    }
  }

  function maybeLightSeed(seed, fingertipWorld) {
    // Distance check — only light up if fingertip is within activation
    // distance of the seed's world position. Lit seeds stay lit (until
    // reset cycle wipes them).
    const dx = fingertipWorld.x - seed.pos.x;
    const dy = fingertipWorld.y - seed.pos.y;
    const dz = seed.pos.z;                    // fingertip z assumed 0 (we lifted it earlier)
    const d = Math.hypot(dx, dy, dz);
    if (d < ACTIVATION_DIST && seed.lit < 0.95) {
      seed.lit = 1.0;
      playStretchGrab({ volume: 0.08 });      // small pluck per new seed lit
    }
  }

  function dispose() {
    scene.remove(root);
    rectGeom.dispose();
    rectMat.dispose();
    rectTexture.dispose();
    for (const s of seeds) {
      s.geom.dispose();
      s.mat.dispose();
    }
    edgeGeom.dispose();
    edgeMat.dispose();
    cursorGeom.dispose();
    cursorMat.dispose();
  }

  return { update, dispose };
}

// ─── Helpers ──────────────────────────────────────────────────────────

const _white = new THREE.Color(0xffffff);

function paintIdRect(canvas, isFlashing) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Holographic plate: dark cyan rounded rectangle with bright cyan border.
  ctx.fillStyle = isFlashing ? 'rgba(255,255,255,0.55)' : `rgba(14,116,144,0.45)`;
  roundRect(ctx, 8, 8, canvas.width - 16, canvas.height - 16, 22);
  ctx.fill();
  ctx.strokeStyle = isFlashing ? '#ffffff' : '#06b6d4';
  ctx.lineWidth = 5;
  ctx.stroke();
  // "ID" label
  ctx.font = 'bold 160px "Courier New", "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = isFlashing ? '#ffffff' : '#06b6d4';
  ctx.shadowBlur = isFlashing ? 28 : 14;
  ctx.fillText('ID', canvas.width / 2, canvas.height / 2 + 4);
  ctx.shadowBlur = 0;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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

// For each seed, find its K nearest neighbors. Dedupe (a,b) == (b,a) by
// only emitting pairs where i < j. Returns array of [i, j] indices.
function computeKNearestPairs(positions, k) {
  const pairs = new Set();
  for (let i = 0; i < positions.length; i++) {
    const dists = [];
    for (let j = 0; j < positions.length; j++) {
      if (i === j) continue;
      const a = positions[i];
      const b = positions[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      dists.push({ j, d });
    }
    dists.sort((a, b) => a.d - b.d);
    for (let n = 0; n < Math.min(k, dists.length); n++) {
      const j = dists[n].j;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      pairs.add(key);
    }
  }
  return [...pairs].map((s) => s.split('-').map(Number));
}

function nearestSeedIndex(seeds, world) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    const dx = world.x - s.pos.x;
    const dy = world.y - s.pos.y;
    const dz = s.pos.z;
    const d = dx * dx + dy * dy + dz * dz;   // squared — faster than hypot
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function paintCursor(posBuf, offset, fromWorld, toPos) {
  const base = offset * 3;
  posBuf[base + 0] = fromWorld.x;
  posBuf[base + 1] = fromWorld.y;
  posBuf[base + 2] = 0;
  posBuf[base + 3] = toPos.x;
  posBuf[base + 4] = toPos.y;
  posBuf[base + 5] = toPos.z;
}

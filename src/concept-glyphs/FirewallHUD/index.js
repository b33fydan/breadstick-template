// Firewall HUD glyph — readable-regex Firewall (sister to FirewallGate).
//
// Renders the ARES Firewall invariant with the regex visible as monospace
// text on a holographic panel above the palm. On pinch-release, a burst
// of 5 cyan tokens falls toward the panel; each is visibly judged
// pass-or-reject by the panel's gate zone. Counters update on the HUD,
// closing the storytelling gap of FirewallGate's amoeba morph — the rule
// is readable, the judgments are concrete.
//
// Side-effect import: pulls in src/lib/gestures/firewallhud.js, which
// registers the firewallhud recognizer with the central registry.
//
// Audio:
//   playFirewallPass — high sine pip on pass
//   playFirewallSnap — pitched-down snap on reject (reused from FirewallGate)

import * as THREE from 'three';
import '../../lib/gestures/firewallhud.js';
import { playFirewallPass, playFirewallSnap } from '../../lib/audioPalettes.js';

// HUD plane geometry (world units). 3.2:1 aspect chosen so the regex
// reads on a single line with room for counters underneath.
const HUD_WIDTH = 0.64;
const HUD_HEIGHT = 0.20;
const HUD_FLOAT_OFFSET = 0.22;       // world-units above palm-center, matches FirewallGate

// Canvas backing the HUD texture. Higher pixel density = sharper text.
const CANVAS_W = 640;
const CANVAS_H = 200;

// Token pool sizing. With 5-token bursts and ~1.2s lifetime, 20 covers
// rapid-fire pinching without overflow.
const TOKEN_POOL_SIZE = 20;
const TOKEN_RADIUS = 0.025;
const BURST_COUNT = 5;
const BURST_STAGGER = 0.10;          // seconds between tokens in a burst

// Fall physics. Gravity is gentle — the operator should see the journey,
// not blink-and-miss it.
const GRAVITY = 1.2;                  // world units / sec² downward
const GATE_PULL = 0.35;               // additional accel toward gate center
const GATE_ENTER_RADIUS = 0.085;      // distance at which verdict fires
const RECOIL_VELOCITY = 0.55;         // upward kick on reject

// Verdict timing.
const JUDGE_DURATION = 0.30;          // seconds in 'judging' phase
const DISSOLVE_RATE = 0.85;           // per-frame opacity multiplier when dissolving

// Colors.
const IDLE_COLOR = 0x06b6d4;          // cyan — falling token, HUD accent
const PASS_COLOR = 0x4ade80;          // green
const REJECT_COLOR = 0xef4444;        // red

// The displayed regex. Cosmetic only; the verdict cycle is deterministic
// regardless of pattern.
const REGEX_PATTERN = '/^[a-z]+$/';

// World-mapping constants — must match conceptStage's camera (FOV 50°,
// camera z=3, aspect 1280/720).
const STAGE_W = 1280;
const STAGE_H = 720;
const FOV_DEG = 50;
const CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

export function createFirewallHUD({ scene }) {
  const group = new THREE.Group();

  // HUD plane — canvas-backed texture so we can redraw counters on the fly.
  const hudCanvas = document.createElement('canvas');
  hudCanvas.width = CANVAS_W;
  hudCanvas.height = CANVAS_H;
  const hudCtx = hudCanvas.getContext('2d');

  const hudTexture = new THREE.CanvasTexture(hudCanvas);
  hudTexture.colorSpace = THREE.SRGBColorSpace;
  const hudGeom = new THREE.PlaneGeometry(HUD_WIDTH, HUD_HEIGHT);
  const hudMat = new THREE.MeshBasicMaterial({
    map: hudTexture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const hudMesh = new THREE.Mesh(hudGeom, hudMat);
  group.add(hudMesh);

  // Token pool — pre-allocate so we don't churn buffers during a burst.
  const tokens = [];
  for (let i = 0; i < TOKEN_POOL_SIZE; i++) {
    const geom = new THREE.IcosahedronGeometry(TOKEN_RADIUS, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: IDLE_COLOR,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.visible = false;
    group.add(mesh);
    tokens.push({
      mesh, geom, mat,
      active: false,
      state: 'idle',                  // 'falling' | 'judging' | 'dissolving'
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      verdict: 'pass',
      age: 0,
    });
  }

  scene.add(group);

  const spawnQueue = [];               // { spawnAt: seconds, fromWorld: Vector3 }
  let timeAccum = 0;
  let totalSpawned = 0;                // drives 2-of-3 pass cycle
  let passCount = 0;
  let rejectCount = 0;
  let needsHudRedraw = true;
  let lastFrameTime = performance.now() / 1000;

  // HUD position tracks the palm + offset; cached so token attraction uses
  // the current frame's gate position.
  const hudPos = new THREE.Vector3();

  drawHUD(hudCtx, REGEX_PATTERN, passCount, rejectCount);
  hudTexture.needsUpdate = true;

  function update(_landmarks, gesture) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - lastFrameTime);
    lastFrameTime = now;
    timeAccum += dt;

    // Hand required for the prop to render. Hide group; token state stays
    // put so any in-flight tokens resume cleanly when the hand returns.
    if (!gesture?.palm) {
      group.visible = false;
      return;
    }
    group.visible = true;

    const palmWorld = normalizedToWorld(gesture.palm);
    hudPos.set(palmWorld.x, palmWorld.y + HUD_FLOAT_OFFSET, 0);
    hudMesh.position.copy(hudPos);

    // Pinch-release rising-edge → queue a burst at fingertip world position.
    if (gesture.pinchReleased && gesture.fingertip) {
      const fromWorld = normalizedToWorldVec(gesture.fingertip);
      for (let i = 0; i < BURST_COUNT; i++) {
        spawnQueue.push({
          spawnAt: timeAccum + i * BURST_STAGGER,
          fromWorld: fromWorld.clone(),
        });
      }
    }

    // Pull due tokens out of the queue.
    while (spawnQueue.length && spawnQueue[0].spawnAt <= timeAccum) {
      const req = spawnQueue.shift();
      const t = tokens.find((tk) => !tk.active);
      if (!t) continue;                // pool exhausted, drop this token

      totalSpawned += 1;
      t.active = true;
      t.state = 'falling';
      t.pos.copy(req.fromWorld);
      t.vel.set(0, 0, 0);
      t.age = 0;
      // 2-of-3 pass cycle — every 3rd token rejects.
      t.verdict = (totalSpawned % 3 === 0) ? 'reject' : 'pass';
      t.mesh.position.copy(t.pos);
      t.mesh.visible = true;
      t.mesh.scale.setScalar(1);
      t.mat.color.setHex(IDLE_COLOR);
      t.mat.opacity = 0.9;
    }

    // Integrate active tokens.
    for (const t of tokens) {
      if (!t.active) continue;
      t.age += dt;

      if (t.state === 'falling') {
        // Gravity + slight attraction toward gate center.
        const toGate = hudPos.clone().sub(t.pos);
        const distToGate = toGate.length();

        if (distToGate < GATE_ENTER_RADIUS) {
          // Verdict fires here. Color, audio, counter.
          t.state = 'judging';
          t.age = 0;
          if (t.verdict === 'pass') {
            t.mat.color.setHex(PASS_COLOR);
            passCount += 1;
            playFirewallPass({ volume: 0.15 });
            t.vel.set(0, -0.2, 0);    // continue downward + dissolve through
          } else {
            t.mat.color.setHex(REJECT_COLOR);
            rejectCount += 1;
            playFirewallSnap({ volume: 0.18 });
            t.vel.set(0, RECOIL_VELOCITY, 0); // recoil upward
          }
          needsHudRedraw = true;
        } else {
          t.vel.y -= GRAVITY * dt;
          toGate.normalize();
          t.vel.x += toGate.x * GATE_PULL * dt;
          t.vel.y += toGate.y * GATE_PULL * dt;
          t.pos.add(t.vel.clone().multiplyScalar(dt));
        }
      } else if (t.state === 'judging') {
        // 0.30s verdict animation. Pass shrinks in place + drifts through;
        // reject continues recoiling upward.
        const judgeProgress = t.age / JUDGE_DURATION;
        if (judgeProgress >= 1) {
          t.state = 'dissolving';
          t.age = 0;
        } else {
          if (t.verdict === 'pass') {
            t.mesh.scale.setScalar(Math.max(0.001, 1 - judgeProgress));
          }
          // Continue ballistic motion for both verdicts (pass drifts through,
          // reject arcs up).
          t.vel.y -= GRAVITY * dt;
          t.pos.add(t.vel.clone().multiplyScalar(dt));
        }
      } else if (t.state === 'dissolving') {
        // Geometric decay; recycle when invisible.
        t.mat.opacity *= DISSOLVE_RATE;
        if (t.mat.opacity < 0.02) {
          t.active = false;
          t.mesh.visible = false;
          t.mesh.scale.setScalar(1);
          continue;
        }
        t.pos.add(t.vel.clone().multiplyScalar(dt));
      }

      t.mesh.position.copy(t.pos);
    }

    // Redraw the HUD canvas only when counters change.
    if (needsHudRedraw) {
      drawHUD(hudCtx, REGEX_PATTERN, passCount, rejectCount);
      hudTexture.needsUpdate = true;
      needsHudRedraw = false;
    }
  }

  function dispose() {
    scene.remove(group);
    hudGeom.dispose();
    hudMat.dispose();
    hudTexture.dispose();
    for (const t of tokens) {
      t.geom.dispose();
      t.mat.dispose();
    }
  }

  return { update, dispose };
}

function drawHUD(ctx, regex, passCount, rejectCount) {
  // Background — semi-opaque dark panel with cyan border.
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = 'rgba(10, 14, 24, 0.82)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.strokeStyle = '#06b6d4';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, CANVAS_W - 4, CANVAS_H - 4);

  // Subtle scanline / grid texture on the background — gives a HUD feel.
  ctx.strokeStyle = 'rgba(6, 182, 212, 0.10)';
  ctx.lineWidth = 1;
  for (let y = 10; y < CANVAS_H - 4; y += 18) {
    ctx.beginPath();
    ctx.moveTo(4, y);
    ctx.lineTo(CANVAS_W - 4, y);
    ctx.stroke();
  }

  // Regex pattern — bold monospace, centered horizontally.
  ctx.fillStyle = '#06b6d4';
  ctx.font = 'bold 56px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(regex, CANVAS_W / 2, 70);

  // Divider above the counters.
  ctx.strokeStyle = 'rgba(6, 182, 212, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, 120);
  ctx.lineTo(CANVAS_W - 40, 120);
  ctx.stroke();

  // Counters — green pass on the left, red reject on the right.
  ctx.font = 'bold 32px monospace';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#4ade80';
  ctx.textAlign = 'left';
  ctx.fillText(`✓ ${passCount}`, 50, 158);
  ctx.fillStyle = '#ef4444';
  ctx.textAlign = 'right';
  ctx.fillText(`✗ ${rejectCount}`, CANVAS_W - 50, 158);
}

function normalizedToWorld({ x, y }) {
  return {
    x: (x - 0.5) * WORLD_WIDTH,
    y: -(y - 0.5) * WORLD_HEIGHT,
  };
}

function normalizedToWorldVec({ x, y }) {
  return new THREE.Vector3((x - 0.5) * WORLD_WIDTH, -(y - 0.5) * WORLD_HEIGHT, 0);
}

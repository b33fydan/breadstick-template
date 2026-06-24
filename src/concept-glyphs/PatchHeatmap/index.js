// PatchHeatmap glyph — DINOv3-style patch embedding heatmap.
//
// Fullscreen shader quad. Grid of quantized color cells driven by proximity
// to hand + face landmarks. Dark green tint everywhere, bright green on
// hand/arm/face. The 16-bit blocky aesthetic comes from UV quantization.

import * as THREE from 'three';

const STAGE_W = 1280;
const STAGE_H = 720;
const FOV_DEG = 50;
const CAMERA_Z = 3;
const ASPECT = STAGE_W / STAGE_H;
const WORLD_HEIGHT = 2 * Math.tan((FOV_DEG * Math.PI / 180) / 2) * CAMERA_Z;
const WORLD_WIDTH = WORLD_HEIGHT * ASPECT;

const GRID_COLS = 28;
const GRID_ROWS = 16;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform vec2 uLeftHand[21];
uniform vec2 uRightHand[21];
uniform float uLeftHandActive;
uniform float uRightHandActive;
uniform vec2 uFaceCenter;
uniform float uFaceRadius;
uniform float uFaceActive;
uniform vec2 uGridSize;
uniform float uTime;
uniform float uAspect;

varying vec2 vUv;

void main() {
  // Quantize UV into grid cells — this is the 16-bit look
  vec2 cell = floor(vUv * uGridSize) / uGridSize;
  vec2 cellCenter = cell + 0.5 / uGridSize;

  float heat = 0.0;
  float sigma2 = 0.028; // 2*sigma^2 — controls falloff width

  // Hand landmarks: Gaussian proximity, aspect-corrected
  if (uLeftHandActive > 0.5) {
    for (int i = 0; i < 21; i++) {
      vec2 diff = cellCenter - uLeftHand[i];
      diff.x *= uAspect;
      float d2 = dot(diff, diff);
      heat = max(heat, exp(-d2 / sigma2));
    }
  }

  if (uRightHandActive > 0.5) {
    for (int i = 0; i < 21; i++) {
      vec2 diff = cellCenter - uRightHand[i];
      diff.x *= uAspect;
      float d2 = dot(diff, diff);
      heat = max(heat, exp(-d2 / sigma2));
    }
  }

  // Face: single circular zone, slightly dimmer than hands
  if (uFaceActive > 0.5) {
    vec2 diff = cellCenter - uFaceCenter;
    diff.x *= uAspect;
    float faceSigma2 = uFaceRadius * uFaceRadius * 8.0;
    float faceHeat = exp(-dot(diff, diff) / max(faceSigma2, 0.001));
    heat = max(heat, faceHeat * 0.75);
  }

  // Subtle per-cell shimmer so the grid feels alive
  float cellId = dot(cell, vec2(127.1, 311.7));
  float shimmer = sin(cellId * 43758.5453 + uTime * 1.2) * 0.06 + 1.0;
  heat *= shimmer;
  heat = clamp(heat, 0.0, 1.0);

  // Dark green → bright green palette
  vec3 coldColor = vec3(0.0, 0.08, 0.0);
  vec3 hotColor  = vec3(0.0, 1.0, 0.4);
  vec3 color = mix(coldColor, hotColor, heat);

  // Thin cell borders — darken pixels near cell edges
  vec2 cellPos = fract(vUv * uGridSize);
  float borderMask = smoothstep(0.0, 0.06, cellPos.x)
                   * smoothstep(0.0, 0.06, 1.0 - cellPos.x)
                   * smoothstep(0.0, 0.06, cellPos.y)
                   * smoothstep(0.0, 0.06, 1.0 - cellPos.y);
  color *= mix(0.3, 1.0, borderMask);

  float alpha = 0.62 + heat * 0.15;
  gl_FragColor = vec4(color, alpha);
}
`;

export function createPatchHeatmap({ scene }) {
  const geo = new THREE.PlaneGeometry(WORLD_WIDTH, WORLD_HEIGHT);
  const uniforms = {
    uLeftHand:       { value: makeVec2Array(21) },
    uRightHand:      { value: makeVec2Array(21) },
    uLeftHandActive: { value: 0.0 },
    uRightHandActive:{ value: 0.0 },
    uFaceCenter:     { value: new THREE.Vector2(-1, -1) },
    uFaceRadius:     { value: 0.1 },
    uFaceActive:     { value: 0.0 },
    uGridSize:       { value: new THREE.Vector2(GRID_COLS, GRID_ROWS) },
    uTime:           { value: 0.0 },
    uAspect:         { value: ASPECT },
  };

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0, 0);
  mesh.renderOrder = -10;
  scene.add(mesh);

  function update(landmarks) {
    uniforms.uTime.value = performance.now() / 1000;

    // Left hand
    if (landmarks?.leftHand && landmarks.leftHand.length >= 21) {
      uniforms.uLeftHandActive.value = 1.0;
      for (let i = 0; i < 21; i++) {
        const pt = landmarks.leftHand[i];
        uniforms.uLeftHand.value[i].set(pt.x, 1.0 - pt.y);
      }
    } else {
      uniforms.uLeftHandActive.value = 0.0;
    }

    // Right hand
    if (landmarks?.rightHand && landmarks.rightHand.length >= 21) {
      uniforms.uRightHandActive.value = 1.0;
      for (let i = 0; i < 21; i++) {
        const pt = landmarks.rightHand[i];
        uniforms.uRightHand.value[i].set(pt.x, 1.0 - pt.y);
      }
    } else {
      uniforms.uRightHandActive.value = 0.0;
    }

    // Face — compute center + bounding radius
    if (landmarks?.face && landmarks.face.length > 0) {
      uniforms.uFaceActive.value = 1.0;
      let sx = 0, sy = 0;
      for (const p of landmarks.face) { sx += p.x; sy += p.y; }
      const cx = sx / landmarks.face.length;
      const cy = sy / landmarks.face.length;
      let maxR = 0;
      for (const p of landmarks.face) {
        const dx = (p.x - cx) * ASPECT;
        const dy = p.y - cy;
        maxR = Math.max(maxR, Math.sqrt(dx * dx + dy * dy));
      }
      uniforms.uFaceCenter.value.set(cx, 1.0 - cy);
      uniforms.uFaceRadius.value = maxR;
    } else {
      uniforms.uFaceActive.value = 0.0;
    }
  }

  function dispose() {
    scene.remove(mesh);
    geo.dispose();
    mat.dispose();
  }

  return { update, dispose };
}

function makeVec2Array(n) {
  return Array.from({ length: n }, () => new THREE.Vector2(-1, -1));
}

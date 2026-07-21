import React, {useEffect, useLayoutEffect, useMemo, useRef} from 'react';
import {ThreeCanvas} from '@remotion/three';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import * as THREE from 'three';
import {
  CUBE_FLAME_CAMERA,
  CUBE_FLAME_DEFAULTS,
  createCubeFrame,
  createCubeSeedTable,
  sampleCubeFlameInto,
} from '../../lib/visual-lab/presets/cubeFlame.js';
import {
  DEFAULT_VISUAL_LAB_BAKE_PROPS,
  DEFAULT_VISUAL_LAB_SCENE,
  normalizeVisualLabBakeScene,
  resolveVisualLabBackground,
} from './visualLabBakeConfig.js';

const CUBE_FLAME_VERTEX_SHADER = `
attribute vec3 instanceTint;
attribute float instanceAlpha;

uniform float uGlowPass;

varying vec3 vInstanceTint;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying float vInstanceAlpha;
varying float vWorldHeight;

void main() {
  vec3 expandedPosition = position * (1.0 + uGlowPass * 0.34);
  vec4 instancePosition = instanceMatrix * vec4(expandedPosition, 1.0);
  vec4 viewPosition = modelViewMatrix * instancePosition;

  vInstanceTint = instanceTint;
  vInstanceAlpha = instanceAlpha;
  vWorldHeight = instancePosition.y;
  vViewPosition = -viewPosition.xyz;
  vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);

  gl_Position = projectionMatrix * viewPosition;
}
`;

const CUBE_FLAME_FRAGMENT_SHADER = `
precision highp float;

uniform float uBloom;
uniform float uDitherAmount;
uniform int uDitherMode;
uniform float uGlowPass;
uniform float uHoloShift;
uniform float uPixelScale;
uniform float uPosterize;

varying vec3 vInstanceTint;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying float vInstanceAlpha;
varying float vWorldHeight;

float bayer2(vec2 position) {
  float x = mod(floor(position.x), 2.0);
  float y = mod(floor(position.y), 2.0);

  if (y < 1.0) {
    return x < 1.0 ? 0.0 : 2.0;
  }

  return x < 1.0 ? 3.0 : 1.0;
}

float bayer4(vec2 position) {
  float x = mod(floor(position.x), 4.0);
  float y = mod(floor(position.y), 4.0);

  if (y < 1.0) {
    if (x < 1.0) return 0.0;
    if (x < 2.0) return 8.0;
    if (x < 3.0) return 2.0;
    return 10.0;
  }
  if (y < 2.0) {
    if (x < 1.0) return 12.0;
    if (x < 2.0) return 4.0;
    if (x < 3.0) return 14.0;
    return 6.0;
  }
  if (y < 3.0) {
    if (x < 1.0) return 3.0;
    if (x < 2.0) return 11.0;
    if (x < 3.0) return 1.0;
    return 9.0;
  }

  if (x < 1.0) return 15.0;
  if (x < 2.0) return 7.0;
  if (x < 3.0) return 13.0;
  return 5.0;
}

float bayer8(vec2 position) {
  vec2 cell = floor(position);
  float coarse = bayer2(floor(cell / 4.0));
  float fine = bayer4(mod(cell, 4.0));
  return fine * 4.0 + coarse;
}

float pixelNoise(vec2 position) {
  return fract(sin(dot(floor(position), vec2(12.9898, 78.233))) * 43758.5453);
}

float ditherPattern(vec2 position) {
  if (uDitherMode == 1) {
    return (bayer8(position) + 0.5) / 64.0;
  }
  if (uDitherMode == 2) {
    return pixelNoise(position);
  }

  return (bayer4(position) + 0.5) / 16.0;
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDirection = normalize(vViewPosition);
  vec3 keyDirection = normalize(vec3(0.42, 0.78, 0.46));

  float facing = abs(dot(normal, viewDirection));
  float fresnel = pow(1.0 - facing, 2.15);
  float faceLight = 0.32 + 0.68 * max(dot(normal, keyDirection), 0.0);
  float spectralPhase = 0.5 + 0.5 * sin(
    vWorldHeight * 2.4 + fresnel * 6.28318530718
  );
  vec3 spectral = mix(
    vec3(1.0, 0.12, 0.58),
    vec3(0.35, 0.96, 1.0),
    spectralPhase
  );

  vec3 crystalColor = vInstanceTint * (0.76 + faceLight * 0.92);
  crystalColor = mix(
    crystalColor,
    spectral * (0.86 + 0.32 * vInstanceTint),
    uHoloShift * (0.18 + fresnel * 0.48)
  );
  crystalColor += spectral * fresnel * (0.52 + uBloom * 0.42);

  float mainAlpha = clamp(vInstanceAlpha * (0.66 + fresnel * 0.34), 0.0, 1.0);
  vec3 glowColor = mix(vInstanceTint, spectral, 0.46) * (0.94 + uBloom * 0.72);
  float glowAlpha = clamp(
    vInstanceAlpha * uBloom * (0.035 + fresnel * 0.11),
    0.0,
    0.32
  );

  vec3 outputColor = mix(crystalColor, glowColor, uGlowPass);
  float outputAlpha = mix(mainAlpha, glowAlpha, uGlowPass);

  if (uGlowPass < 0.5 && uDitherAmount > 0.0001) {
    float pattern = ditherPattern(gl_FragCoord.xy / max(1.0, uPixelScale)) - 0.5;
    float levels = max(2.0, uPosterize);
    vec3 quantized = floor(
      max(outputColor, vec3(0.0)) * levels + 0.5 + pattern * uDitherAmount
    ) / levels;
    outputColor = mix(outputColor, quantized, uDitherAmount);
  }

  if (outputAlpha <= 0.001) discard;
  gl_FragColor = vec4(max(outputColor, vec3(0.0)), outputAlpha);
  #include <colorspace_fragment>
}
`;

const CAMERA_ROTATION = (() => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.fromArray(CUBE_FLAME_CAMERA.position);
  camera.lookAt(...CUBE_FLAME_CAMERA.target);
  return [camera.rotation.x, camera.rotation.y, camera.rotation.z];
})();

const ditherModeIndex = (mode) => {
  if (mode === 'bayer8') return 1;
  if (mode === 'noise') return 2;
  return 0;
};

const createMaterial = ({glow = false} = {}) => {
  return new THREE.ShaderMaterial({
    vertexShader: CUBE_FLAME_VERTEX_SHADER,
    fragmentShader: CUBE_FLAME_FRAGMENT_SHADER,
    uniforms: {
      uBloom: {value: CUBE_FLAME_DEFAULTS.material.bloom},
      uDitherAmount: {value: CUBE_FLAME_DEFAULTS.post.dither.amount},
      uDitherMode: {value: ditherModeIndex(CUBE_FLAME_DEFAULTS.post.dither.mode)},
      uGlowPass: {value: glow ? 1 : 0},
      uHoloShift: {value: CUBE_FLAME_DEFAULTS.material.holoShift},
      uPixelScale: {value: CUBE_FLAME_DEFAULTS.post.dither.pixelScale},
      uPosterize: {value: CUBE_FLAME_DEFAULTS.post.dither.posterize},
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.FrontSide,
    toneMapped: false,
  });
};

const handleCanvasCreated = ({gl}) => {
  gl.setClearColor(0x000000, 0);
};

const CubeFlameInstances = ({scene, frame, fps, loopDurationSec}) => {
  const mainMeshRef = useRef(null);
  const glowMeshRef = useRef(null);
  const count = scene.params.emission.count;
  const params = scene.params;

  const seedTable = useMemo(
    () => createCubeSeedTable(scene.seed, count),
    [count, scene.seed],
  );
  const sampledFrame = useMemo(() => createCubeFrame(count), [count]);
  const geometry = useMemo(() => {
    const nextGeometry = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
    const tints = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const alphas = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    tints.setUsage(THREE.DynamicDrawUsage);
    alphas.setUsage(THREE.DynamicDrawUsage);
    nextGeometry.setAttribute('instanceTint', tints);
    nextGeometry.setAttribute('instanceAlpha', alphas);
    return nextGeometry;
  }, [count]);
  const mainMaterial = useMemo(() => createMaterial(), []);
  const glowMaterial = useMemo(() => createMaterial({glow: true}), []);
  const scratch = useMemo(() => ({
    object: new THREE.Object3D(),
    color: new THREE.Color(),
  }), []);
  const colorStops = useMemo(() => {
    return params.material.colors.map((color) => new THREE.Color(color));
  }, [params.material.colors]);

  useLayoutEffect(() => {
    const mainMesh = mainMeshRef.current;
    const glowMesh = glowMeshRef.current;
    if (!mainMesh || !glowMesh) return;

    const cubeFrame = sampleCubeFlameInto(
      seedTable,
      frame / fps,
      params,
      sampledFrame,
      {loopDurationSec, count},
    );
    const tintAttribute = geometry.getAttribute('instanceTint');
    const alphaAttribute = geometry.getAttribute('instanceAlpha');
    const [colorA, colorB, colorC] = colorStops;

    mainMesh.count = count;
    glowMesh.count = count;

    for (let index = 0; index < count; index += 1) {
      const vectorOffset = index * 3;
      const life = cubeFrame.life[index];
      const scale = Math.max(0.0001, cubeFrame.scales[index]);

      scratch.object.position.set(
        cubeFrame.positions[vectorOffset],
        cubeFrame.positions[vectorOffset + 1],
        cubeFrame.positions[vectorOffset + 2],
      );
      scratch.object.rotation.set(
        cubeFrame.rotations[vectorOffset],
        cubeFrame.rotations[vectorOffset + 1],
        cubeFrame.rotations[vectorOffset + 2],
      );
      scratch.object.scale.setScalar(scale);
      scratch.object.updateMatrix();
      mainMesh.setMatrixAt(index, scratch.object.matrix);
      glowMesh.setMatrixAt(index, scratch.object.matrix);

      if (life < 0.54) {
        scratch.color.copy(colorA).lerp(colorB, life / 0.54);
      } else {
        scratch.color.copy(colorB).lerp(colorC, (life - 0.54) / 0.46);
      }
      scratch.color.offsetHSL(
        (cubeFrame.variation[index] - 0.5) * params.material.holoShift * 0.08,
        0,
        (cubeFrame.variation[index] - 0.5) * 0.09,
      );
      tintAttribute.setXYZ(index, scratch.color.r, scratch.color.g, scratch.color.b);
      alphaAttribute.setX(index, cubeFrame.alpha[index]);
    }

    mainMesh.instanceMatrix.needsUpdate = true;
    glowMesh.instanceMatrix.needsUpdate = true;
    tintAttribute.needsUpdate = true;
    alphaAttribute.needsUpdate = true;

    for (const material of [mainMaterial, glowMaterial]) {
      material.uniforms.uBloom.value = params.material.bloom;
      material.uniforms.uDitherAmount.value = params.post.dither.enabled
        ? params.post.dither.amount
        : 0;
      material.uniforms.uDitherMode.value = ditherModeIndex(params.post.dither.mode);
      material.uniforms.uHoloShift.value = params.material.holoShift;
      material.uniforms.uPixelScale.value = params.post.dither.pixelScale;
      material.uniforms.uPosterize.value = params.post.dither.posterize;
    }
  }, [
    colorStops,
    count,
    fps,
    frame,
    geometry,
    glowMaterial,
    loopDurationSec,
    mainMaterial,
    params,
    sampledFrame,
    scratch,
    seedTable,
  ]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      mainMaterial.dispose();
      glowMaterial.dispose();
    };
  }, [geometry, glowMaterial, mainMaterial]);

  return (
    <>
      <instancedMesh
        ref={glowMeshRef}
        args={[geometry, glowMaterial, count]}
        frustumCulled={false}
        renderOrder={0}
      />
      <instancedMesh
        ref={mainMeshRef}
        args={[geometry, mainMaterial, count]}
        frustumCulled={false}
        renderOrder={1}
      />
    </>
  );
};

const CubeFlameScene = ({scene, frame, fps, loopDurationSec}) => {
  const baseColor = scene.params.material.colors[0];

  return (
    <>
      <ambientLight intensity={0.42} />
      <directionalLight position={[4.5, 7, 5.5]} intensity={1.15} color="#fff4df" />
      <pointLight
        position={[0, -1.8, 1.4]}
        intensity={1.8 * scene.params.emission.intensity}
        color={baseColor}
        distance={8}
      />
      <CubeFlameInstances
        scene={scene}
        frame={frame}
        fps={fps}
        loopDurationSec={loopDurationSec}
      />
    </>
  );
};

export const VisualLabBake = ({
  scene: sceneProp = DEFAULT_VISUAL_LAB_SCENE,
  background,
  output = DEFAULT_VISUAL_LAB_BAKE_PROPS.output,
  // No default — a concrete default here shadows the scene's background color
  // in resolveVisualLabBackground (matteColor ?? requested.color), making the
  // matte-mode picker inert on mp4-matte bakes.
  matteColor,
}) => {
  const frame = useCurrentFrame();
  const {durationInFrames, fps, width, height} = useVideoConfig();
  const scene = useMemo(() => normalizeVisualLabBakeScene(sceneProp), [sceneProp]);
  const resolvedBackground = useMemo(() => {
    return resolveVisualLabBackground({scene, background, output, matteColor});
  }, [background, matteColor, output, scene]);
  const loopDurationSec = durationInFrames / fps;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: resolvedBackground.transparent
          ? 'transparent'
          : resolvedBackground.color,
      }}
    >
      <ThreeCanvas
        width={width}
        height={height}
        dpr={1}
        camera={{
          position: CUBE_FLAME_CAMERA.position,
          rotation: CAMERA_ROTATION,
          fov: scene.camera.fov,
          near: CUBE_FLAME_CAMERA.near,
          far: CUBE_FLAME_CAMERA.far,
        }}
        onCreated={handleCanvasCreated}
        gl={{
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: true,
          premultipliedAlpha: true,
          powerPreference: 'high-performance',
        }}
        style={{width, height}}
      >
        <CubeFlameScene
          scene={scene}
          frame={frame}
          fps={fps}
          loopDurationSec={loopDurationSec}
        />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};

export default VisualLabBake;

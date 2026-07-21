import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  CUBE_FLAME_CAMERA,
  CUBE_FLAME_DEFAULTS,
  CUBE_FLAME_MAX_COUNT,
  createCubeFrame,
  createCubeSeedTable,
  normalizeCubeFlameParams,
  normalizeCubeFlameSeed,
  sampleNormalizedCubeFlameInto,
} from './presets/cubeFlame.js';
import { cubeFlameVertexShader } from './shaders/cubeFlame.vert.js';
import { cubeFlameFragmentShader } from './shaders/cubeFlame.frag.js';
import { ditherFragmentShader, ditherVertexShader } from './shaders/dither.frag.js';
import { registerVisualStageActivity } from './visualScheduler.js';

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 360;
const DEFAULT_LOOP_DURATION_SEC = 6;
const STATS_INTERVAL_MS = 500;

const QUALITY_PRESETS = Object.freeze({
  eco: Object.freeze({ maxLongEdge: 480, pixelRatio: 1, countScale: 0.5, bloom: false }),
  live: Object.freeze({ maxLongEdge: 640, pixelRatio: 1.25, countScale: 1, bloom: true }),
  high: Object.freeze({ maxLongEdge: 960, pixelRatio: 1.5, countScale: 1, bloom: true }),
});

const BACKGROUNDS = Object.freeze({
  transparent: Object.freeze({ color: 0x000000, alpha: 0 }),
  black: Object.freeze({ color: 0x050309, alpha: 1 }),
  breadstick: Object.freeze({ color: 0x0a0806, alpha: 1 }),
});

const DITHER_MODES = Object.freeze({ bayer4: 0, bayer8: 1, noise: 2 });

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeQuality(quality) {
  return Object.hasOwn(QUALITY_PRESETS, quality) ? quality : 'live';
}

function normalizeBackground(background) {
  const mode = typeof background === 'object' && background
    ? background.mode
    : background;
  return Object.hasOwn(BACKGROUNDS, mode) ? mode : 'transparent';
}

function readLoopDuration(source) {
  const candidate = source?.loopDurationSec ?? source?.scene?.loopDurationSec;
  return clamp(finiteOr(candidate, DEFAULT_LOOP_DURATION_SEC), 0.1, 60);
}

function readCameraFov(source) {
  const candidate = source?.camera?.fov ?? source?.scene?.camera?.fov;
  return clamp(finiteOr(candidate, CUBE_FLAME_CAMERA.fov), 15, 90);
}

function getDevicePixelRatio() {
  return typeof window === 'undefined' ? 1 : finiteOr(window.devicePixelRatio, 1);
}

/**
 * Mount the deterministic cube-flame renderer into a caller-owned container.
 * The stage owns all WebGL resources and appends one canvas. Call `dispose()`
 * when its React Flow node unmounts.
 */
export function createVisualStage({
  container,
  paramsRef = { current: CUBE_FLAME_DEFAULTS },
  seed = 4317,
  backgroundMode = 'transparent',
  quality = 'live',
  onStats,
} = {}) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new TypeError('visualStage: a container element is required');
  }

  let disposed = false;
  let contextAvailable = true;
  let requestedRunning = false;
  let loopActive = false;
  let documentVisible = typeof document === 'undefined' || !document.hidden;
  let intersecting = true;
  let reducedMotion = false;
  let currentQuality = normalizeQuality(quality);
  let currentBackground = normalizeBackground(backgroundMode);
  let currentSeed = normalizeCubeFlameSeed(seed);
  let seedTable = createCubeSeedTable(currentSeed, CUBE_FLAME_MAX_COUNT);
  const frame = createCubeFrame(CUBE_FLAME_MAX_COUNT);

  let lastParamsSource = null;
  let normalizedParams = normalizeCubeFlameParams(CUBE_FLAME_DEFAULTS);
  let loopDurationSec = DEFAULT_LOOP_DURATION_SEC;
  let elapsedBeforeStartSec = 0;
  let lastRenderedTimeSec = 0;
  let startedAtMs = null;
  let lastFrameTimestampMs = null;
  let statsStartedAtMs = null;
  let statsFrameCount = 0;
  let renderWidth = DEFAULT_WIDTH;
  let renderHeight = DEFAULT_HEIGHT;
  let variationDirty = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    CUBE_FLAME_CAMERA.fov,
    DEFAULT_WIDTH / DEFAULT_HEIGHT,
    CUBE_FLAME_CAMERA.near,
    CUBE_FLAME_CAMERA.far,
  );
  camera.position.fromArray(CUBE_FLAME_CAMERA.position);
  camera.lookAt(...CUBE_FLAME_CAMERA.target);

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
    premultipliedAlpha: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setSize(DEFAULT_WIDTH, DEFAULT_HEIGHT, false);
  renderer.domElement.className = 'visual-lab-stage-canvas';
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.inset = '0';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.pointerEvents = 'none';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);

  const geometry = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  const lifeAttribute = new THREE.InstancedBufferAttribute(frame.life, 1);
  const alphaAttribute = new THREE.InstancedBufferAttribute(frame.alpha, 1);
  const variationAttribute = new THREE.InstancedBufferAttribute(frame.variation, 1);
  lifeAttribute.setUsage(THREE.DynamicDrawUsage);
  alphaAttribute.setUsage(THREE.DynamicDrawUsage);
  variationAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('instanceLife', lifeAttribute);
  geometry.setAttribute('instanceAlpha', alphaAttribute);
  geometry.setAttribute('instanceVariation', variationAttribute);

  const material = new THREE.ShaderMaterial({
    name: 'VisualLabCubeFlameMaterial',
    uniforms: {
      uColorA: { value: new THREE.Color(CUBE_FLAME_DEFAULTS.material.colors[0]) },
      uColorB: { value: new THREE.Color(CUBE_FLAME_DEFAULTS.material.colors[1]) },
      uColorC: { value: new THREE.Color(CUBE_FLAME_DEFAULTS.material.colors[2]) },
      uHoloShift: { value: CUBE_FLAME_DEFAULTS.material.holoShift },
    },
    vertexShader: cubeFlameVertexShader,
    fragmentShader: cubeFlameFragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, CUBE_FLAME_MAX_COUNT);
  mesh.name = 'VisualLabCubeFlameInstances';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  const dummy = new THREE.Object3D();
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(DEFAULT_WIDTH, DEFAULT_HEIGHT),
    CUBE_FLAME_DEFAULTS.material.bloom,
    0.42,
    0.36,
  );
  const ditherPass = new ShaderPass({
    name: 'VisualLabDitherPass',
    uniforms: {
      tDiffuse: { value: null },
      uAmount: { value: CUBE_FLAME_DEFAULTS.post.dither.amount },
      uPixelScale: { value: CUBE_FLAME_DEFAULTS.post.dither.pixelScale },
      uPosterize: { value: CUBE_FLAME_DEFAULTS.post.dither.posterize },
      uMode: { value: DITHER_MODES[CUBE_FLAME_DEFAULTS.post.dither.mode] },
    },
    vertexShader: ditherVertexShader,
    fragmentShader: ditherFragmentShader,
  });
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(ditherPass);
  composer.addPass(outputPass);

  function reportStats(payload) {
    if (typeof onStats !== 'function') return;
    try {
      onStats(payload);
    } catch (error) {
      console.error('[visualStage] onStats callback failed:', error);
    }
  }

  function applyBackground() {
    const background = BACKGROUNDS[currentBackground];
    renderer.setClearColor(background.color, background.alpha);
  }

  function applyParams(params) {
    material.uniforms.uColorA.value.set(params.material.colors[0]);
    material.uniforms.uColorB.value.set(params.material.colors[1]);
    material.uniforms.uColorC.value.set(params.material.colors[2]);
    material.uniforms.uHoloShift.value = params.material.holoShift;

    const qualityPreset = QUALITY_PRESETS[currentQuality];
    bloomPass.strength = params.material.bloom * 0.82;
    bloomPass.radius = 0.36 + params.material.bloom * 0.08;
    bloomPass.threshold = 0.34;
    bloomPass.enabled = qualityPreset.bloom && params.material.bloom > 0.001;

    const dither = params.post.dither;
    ditherPass.uniforms.uAmount.value = dither.amount;
    ditherPass.uniforms.uPixelScale.value = dither.pixelScale;
    ditherPass.uniforms.uPosterize.value = dither.posterize;
    ditherPass.uniforms.uMode.value = DITHER_MODES[dither.mode];
    ditherPass.enabled = dither.enabled && dither.amount > 0.001;
  }

  function resolveParams(paramsOverride) {
    const source = paramsOverride === undefined
      ? (paramsRef?.current ?? CUBE_FLAME_DEFAULTS)
      : paramsOverride;
    if (source !== lastParamsSource) {
      lastParamsSource = source;
      normalizedParams = normalizeCubeFlameParams(source);
      loopDurationSec = readLoopDuration(source);
      const fov = readCameraFov(source);
      if (camera.fov !== fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      applyParams(normalizedParams);
    }
    return normalizedParams;
  }

  function activeCubeCount(params) {
    const countScale = QUALITY_PRESETS[currentQuality].countScale;
    return Math.max(1, Math.min(
      CUBE_FLAME_MAX_COUNT,
      Math.round(params.emission.count * countScale),
    ));
  }

  function renderAt(seconds = 0, paramsOverride) {
    if (disposed || !contextAvailable) return null;
    const params = resolveParams(paramsOverride);
    const count = activeCubeCount(params);
    sampleNormalizedCubeFlameInto(
      seedTable,
      seconds,
      params,
      frame,
      loopDurationSec,
      count,
    );

    const positions = frame.positions;
    const rotations = frame.rotations;
    const scales = frame.scales;
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      dummy.position.set(positions[offset], positions[offset + 1], positions[offset + 2]);
      dummy.rotation.set(rotations[offset], rotations[offset + 1], rotations[offset + 2]);
      dummy.scale.setScalar(scales[index]);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    lifeAttribute.needsUpdate = true;
    alphaAttribute.needsUpdate = true;
    if (variationDirty) {
      variationAttribute.needsUpdate = true;
      variationDirty = false;
    }
    composer.render(0);
    return frame;
  }

  function stopRendererLoop() {
    if (!loopActive) return;
    renderer.setAnimationLoop(null);
    elapsedBeforeStartSec = lastRenderedTimeSec;
    startedAtMs = null;
    lastFrameTimestampMs = null;
    statsStartedAtMs = null;
    statsFrameCount = 0;
    loopActive = false;
  }

  function onAnimationFrame(timestampMs) {
    if (disposed || !contextAvailable) return;
    if (startedAtMs === null) {
      startedAtMs = timestampMs - elapsedBeforeStartSec * 1000;
      statsStartedAtMs = timestampMs;
      lastFrameTimestampMs = timestampMs;
    }

    lastRenderedTimeSec = Math.max(0, (timestampMs - startedAtMs) / 1000);
    renderAt(lastRenderedTimeSec);
    statsFrameCount += 1;

    if (timestampMs - statsStartedAtMs >= STATS_INTERVAL_MS) {
      const elapsedMs = timestampMs - statsStartedAtMs;
      const fps = statsFrameCount * 1000 / elapsedMs;
      reportStats({
        state: 'live',
        fps,
        frameMs: lastFrameTimestampMs === null ? 0 : timestampMs - lastFrameTimestampMs,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        activeCount: mesh.count,
        quality: currentQuality,
      });
      statsStartedAtMs = timestampMs;
      statsFrameCount = 0;
    }
    lastFrameTimestampMs = timestampMs;
  }

  function startRendererLoop() {
    if (disposed || !contextAvailable || loopActive) return;
    loopActive = true;
    startedAtMs = null;
    renderer.setAnimationLoop(onAnimationFrame);
  }

  const activity = registerVisualStageActivity({
    onActivate: startRendererLoop,
    onDeactivate: stopRendererLoop,
  });

  function updateEligibility() {
    const eligible = !disposed
      && contextAvailable
      && documentVisible
      && intersecting
      && !reducedMotion;
    activity.setEligible(eligible);
  }

  function resize(width, height) {
    if (disposed) return null;
    const measuredWidth = finiteOr(width, container.clientWidth || DEFAULT_WIDTH);
    const measuredHeight = finiteOr(height, container.clientHeight || DEFAULT_HEIGHT);
    const cssWidth = Math.max(1, measuredWidth);
    const cssHeight = Math.max(1, measuredHeight);
    const maxLongEdge = QUALITY_PRESETS[currentQuality].maxLongEdge;
    const scale = Math.min(1, maxLongEdge / Math.max(cssWidth, cssHeight));
    renderWidth = Math.max(1, Math.round(cssWidth * scale));
    renderHeight = Math.max(1, Math.round(cssHeight * scale));
    const pixelRatio = Math.min(
      getDevicePixelRatio(),
      QUALITY_PRESETS[currentQuality].pixelRatio,
    );

    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(renderWidth, renderHeight, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(renderWidth, renderHeight);
    camera.aspect = cssWidth / cssHeight;
    camera.updateProjectionMatrix();
    if (!loopActive) renderAt(lastRenderedTimeSec);
    return { width: renderWidth, height: renderHeight, pixelRatio };
  }

  function start() {
    if (disposed) return false;
    requestedRunning = true;
    activity.setRequested(true);
    if (!activity.isActive()) renderAt(lastRenderedTimeSec);
    return activity.isActive();
  }

  function pause() {
    if (disposed) return;
    requestedRunning = false;
    activity.setRequested(false);
  }

  function restart() {
    if (disposed) return;
    elapsedBeforeStartSec = 0;
    lastRenderedTimeSec = 0;
    startedAtMs = null;
    renderAt(0);
  }

  function setSeed(nextSeed) {
    if (disposed) return currentSeed;
    currentSeed = normalizeCubeFlameSeed(nextSeed);
    seedTable = createCubeSeedTable(currentSeed, CUBE_FLAME_MAX_COUNT);
    variationDirty = true;
    renderAt(lastRenderedTimeSec);
    return currentSeed;
  }

  function setBackground(nextBackground) {
    if (disposed) return currentBackground;
    currentBackground = normalizeBackground(nextBackground);
    applyBackground();
    renderAt(lastRenderedTimeSec);
    return currentBackground;
  }

  function setQuality(nextQuality) {
    if (disposed) return currentQuality;
    currentQuality = normalizeQuality(nextQuality);
    applyParams(normalizedParams);
    resize();
    return currentQuality;
  }

  function handleVisibilityChange() {
    documentVisible = !document.hidden;
    updateEligibility();
  }

  function handleContextLost(event) {
    event.preventDefault();
    contextAvailable = false;
    updateEligibility();
    reportStats({ state: 'context-lost', quality: currentQuality });
  }

  function handleContextRestored() {
    contextAvailable = true;
    variationDirty = true;
    updateEligibility();
    renderAt(lastRenderedTimeSec);
    reportStats({ state: requestedRunning ? 'restored' : 'paused', quality: currentQuality });
  }

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) resize(rect.width, rect.height);
    })
    : null;
  resizeObserver?.observe(container);

  const intersectionObserver = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      intersecting = entries[0]?.isIntersecting ?? true;
      updateEligibility();
    })
    : null;
  intersectionObserver?.observe(container);

  const motionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  reducedMotion = motionQuery?.matches ?? false;
  const handleMotionChange = (event) => {
    reducedMotion = event.matches;
    updateEligibility();
    if (reducedMotion) {
      renderAt(0);
      reportStats({ state: 'reduced-motion', quality: currentQuality });
    }
  };
  motionQuery?.addEventListener?.('change', handleMotionChange);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
  renderer.domElement.addEventListener('webglcontextlost', handleContextLost, false);
  renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored, false);

  applyBackground();
  applyParams(normalizedParams);
  updateEligibility();
  resize();
  renderAt(0);

  function dispose() {
    if (disposed) return;
    disposed = true;
    requestedRunning = false;
    activity.dispose();
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    motionQuery?.removeEventListener?.('change', handleMotionChange);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    renderer.domElement.removeEventListener('webglcontextlost', handleContextLost, false);
    renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored, false);

    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
    // UnrealBloomPass r166 does not include its high-pass shader in dispose().
    bloomPass.materialHighPassFilter.dispose();
    bloomPass.dispose();
    ditherPass.dispose();
    outputPass.dispose();
    composer.dispose();
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }

  return {
    start,
    pause,
    restart,
    resize,
    setSeed,
    setBackground,
    setQuality,
    renderAt,
    dispose,
  };
}

export default createVisualStage;

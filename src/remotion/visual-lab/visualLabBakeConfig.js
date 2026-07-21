import {
  CUBE_FLAME_CAMERA,
  CUBE_FLAME_DEFAULTS,
  normalizeCubeFlameParams,
  normalizeCubeFlameSeed,
} from '../../lib/visual-lab/presets/cubeFlame.js';

const DEFAULT_SCENE_BACKGROUND = Object.freeze({
  mode: 'transparent',
  color: '#0a0a0f',
});

export const DEFAULT_VISUAL_LAB_SCENE = Object.freeze({
  type: 'visual-scene',
  version: 1,
  preset: 'cube-flame',
  seed: 4317,
  loopDurationSec: 6,
  background: DEFAULT_SCENE_BACKGROUND,
  camera: Object.freeze({preset: 'three-quarter', fov: CUBE_FLAME_CAMERA.fov}),
  params: CUBE_FLAME_DEFAULTS,
  renderer: Object.freeze({
    engine: 'three',
    engineVersion: '0.166.1',
    presetVersion: 1,
  }),
});

export const DEFAULT_VISUAL_LAB_BAKE_PROPS = Object.freeze({
  scene: DEFAULT_VISUAL_LAB_SCENE,
  durationSec: 6,
  fps: 30,
  width: 1920,
  height: 1080,
  output: 'webm-alpha',
  matteColor: '#0a0a0f',
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const finiteNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const positiveInteger = (value, fallback, min, max) => {
  return Math.round(clamp(finiteNumber(value, fallback), min, max));
};

const validColor = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  return /^#[\da-f]{6}$/i.test(value.trim()) ? value.trim() : fallback;
};

export const normalizeVisualLabBakeScene = (scene) => {
  const source = scene && typeof scene === 'object' ? scene : DEFAULT_VISUAL_LAB_SCENE;
  const sourceParams = source.params?.channels ?? source.params ?? CUBE_FLAME_DEFAULTS;
  const background = source.background && typeof source.background === 'object'
    ? source.background
    : DEFAULT_SCENE_BACKGROUND;
  const camera = source.camera && typeof source.camera === 'object'
    ? source.camera
    : DEFAULT_VISUAL_LAB_SCENE.camera;

  return {
    ...DEFAULT_VISUAL_LAB_SCENE,
    ...source,
    preset: source.preset === 'cube-flame' ? source.preset : 'cube-flame',
    seed: normalizeCubeFlameSeed(source.seed ?? DEFAULT_VISUAL_LAB_SCENE.seed),
    loopDurationSec: clamp(
      finiteNumber(source.loopDurationSec, DEFAULT_VISUAL_LAB_SCENE.loopDurationSec),
      0.25,
      60,
    ),
    background: {
      mode: background.mode === 'transparent' ? 'transparent' : 'matte',
      color: validColor(background.color, DEFAULT_SCENE_BACKGROUND.color),
    },
    camera: {
      preset: 'three-quarter',
      fov: clamp(finiteNumber(camera.fov, DEFAULT_VISUAL_LAB_SCENE.camera.fov), 24, 72),
    },
    params: normalizeCubeFlameParams(sourceParams),
  };
};

export const resolveVisualLabBackground = ({scene, background, output, matteColor}) => {
  const requested = background && typeof background === 'object'
    ? background
    : scene.background;
  const forceAlpha = output === 'webm-alpha';
  const forceMatte = output === 'mp4-matte';
  const transparent = forceAlpha || (!forceMatte && requested.mode === 'transparent');

  return {
    transparent,
    color: validColor(
      matteColor ?? requested.color,
      DEFAULT_VISUAL_LAB_BAKE_PROPS.matteColor,
    ),
  };
};

const resolveBakeShape = (props = {}) => {
  const scene = normalizeVisualLabBakeScene(props.scene);
  const fps = finiteNumber(props.fps, DEFAULT_VISUAL_LAB_BAKE_PROPS.fps) === 60 ? 60 : 30;
  const durationSec = clamp(
    finiteNumber(props.durationSec, scene.loopDurationSec),
    0.25,
    60,
  );

  return {
    scene,
    fps,
    durationSec,
    width: positiveInteger(props.width, DEFAULT_VISUAL_LAB_BAKE_PROPS.width, 64, 4096),
    height: positiveInteger(props.height, DEFAULT_VISUAL_LAB_BAKE_PROPS.height, 64, 4096),
    output: props.output === 'mp4-matte' ? 'mp4-matte' : 'webm-alpha',
  };
};

export const calculateVisualLabBakeMetadata = ({props}) => {
  const shape = resolveBakeShape(props);
  const isAlpha = shape.output === 'webm-alpha';
  const extension = isAlpha ? 'webm' : 'mp4';

  return {
    durationInFrames: Math.max(1, Math.round(shape.durationSec * shape.fps)),
    fps: shape.fps,
    width: shape.width,
    height: shape.height,
    defaultOutName: `visual-lab-cube-flame-${shape.scene.seed}.${extension}`,
    defaultCodec: isAlpha ? 'vp9' : 'h264',
    defaultVideoImageFormat: isAlpha ? 'png' : 'jpeg',
    defaultPixelFormat: isAlpha ? 'yuva420p' : 'yuv420p',
  };
};

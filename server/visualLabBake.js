import {
  normalizeVisualScene,
  validateVisualScene,
} from '../src/canvas/visual-lab/contracts.js';

export const VISUAL_LAB_BAKE_CACHE_VERSION = 1;

const REQUEST_KEYS = new Set([
  'scene',
  'durationSec',
  'fps',
  'width',
  'height',
  'output',
  'quality',
]);

const SCENE_KEYS = new Set([
  'type',
  'version',
  'preset',
  'seed',
  'loopDurationSec',
  'background',
  'camera',
  'params',
  'renderer',
]);

const PARAM_KEYS = new Set(['emission', 'motion', 'material', 'post']);
const EMISSION_KEYS = new Set(['intensity', 'count', 'spread', 'cubeSize']);
const MOTION_KEYS = new Set(['riseSpeed', 'turbulence', 'swirl', 'flicker']);
const MATERIAL_KEYS = new Set(['opacity', 'bloom', 'holoShift', 'colors']);
const POST_KEYS = new Set(['dither']);
const DITHER_KEYS = new Set(['enabled', 'mode', 'amount', 'pixelScale', 'posterize']);
const BACKGROUND_KEYS = new Set(['mode', 'color']);
const CAMERA_KEYS = new Set(['preset', 'fov']);
const RENDERER_KEYS = new Set(['engine', 'engineVersion', 'presetVersion']);

const ALLOWED_DURATIONS = new Set([3, 5, 6, 8, 10]);
const ALLOWED_FPS = new Set([30, 60]);
const ALLOWED_RESOLUTIONS = new Set([
  '1080x1920',
  '1920x1080',
  '1080x1080',
]);
const ALLOWED_OUTPUTS = new Set(['webm-alpha', 'mp4-matte']);
const ALLOWED_QUALITY = new Set(['draft', 'production']);
const ALLOWED_BACKGROUND_MODES = new Set(['transparent', 'black', 'breadstick']);
const ALLOWED_DITHER_MODES = new Set(['bayer4', 'bayer8', 'noise']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export class VisualLabBakeValidationError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'VisualLabBakeValidationError';
  }
}

function fail(message) {
  throw new VisualLabBakeValidationError(message);
}

function assertRecord(value, path) {
  if (!isRecord(value)) fail(`${path} must be an object.`);
}

function assertOnlyKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key} is not supported.`);
  }
}

function assertFiniteNumbers(value, keys, path) {
  for (const key of keys) {
    if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]))) {
      fail(`${path}.${key} must be a finite number.`);
    }
  }
}

function assertHexColor(value, path) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.trim())) {
    fail(`${path} must be a six-digit hex color.`);
  }
}

function assertSceneShape(scene) {
  assertRecord(scene, 'scene');
  assertOnlyKeys(scene, SCENE_KEYS, 'scene');

  if (scene.type !== 'visual-scene' || scene.version !== 1) {
    fail('scene must be a visual-scene@1 payload.');
  }
  if (scene.preset !== 'cube-flame') {
    fail('scene.preset must be "cube-flame".');
  }
  assertFiniteNumbers(scene, ['seed', 'loopDurationSec'], 'scene');

  if (scene.background !== undefined) {
    assertRecord(scene.background, 'scene.background');
    assertOnlyKeys(scene.background, BACKGROUND_KEYS, 'scene.background');
    if (scene.background.mode !== undefined && !ALLOWED_BACKGROUND_MODES.has(scene.background.mode)) {
      fail('scene.background.mode must be transparent, black, or breadstick.');
    }
    if (scene.background.color !== undefined) {
      assertHexColor(scene.background.color, 'scene.background.color');
    }
  }

  if (scene.camera !== undefined) {
    assertRecord(scene.camera, 'scene.camera');
    assertOnlyKeys(scene.camera, CAMERA_KEYS, 'scene.camera');
    if (scene.camera.preset !== undefined && scene.camera.preset !== 'three-quarter') {
      fail('scene.camera.preset must be "three-quarter".');
    }
    assertFiniteNumbers(scene.camera, ['fov'], 'scene.camera');
  }

  if (scene.renderer !== undefined) {
    assertRecord(scene.renderer, 'scene.renderer');
    assertOnlyKeys(scene.renderer, RENDERER_KEYS, 'scene.renderer');
    if (scene.renderer.engine !== undefined && scene.renderer.engine !== 'three') {
      fail('scene.renderer.engine must be "three".');
    }
    if (scene.renderer.engineVersion !== undefined && scene.renderer.engineVersion !== '0.166.1') {
      fail('scene.renderer.engineVersion must be "0.166.1".');
    }
    if (scene.renderer.presetVersion !== undefined && scene.renderer.presetVersion !== 1) {
      fail('scene.renderer.presetVersion must be 1.');
    }
  }

  if (scene.params === undefined) return;
  assertRecord(scene.params, 'scene.params');
  assertOnlyKeys(scene.params, PARAM_KEYS, 'scene.params');

  if (scene.params.emission !== undefined) {
    assertRecord(scene.params.emission, 'scene.params.emission');
    assertOnlyKeys(scene.params.emission, EMISSION_KEYS, 'scene.params.emission');
    assertFiniteNumbers(scene.params.emission, EMISSION_KEYS, 'scene.params.emission');
  }

  if (scene.params.motion !== undefined) {
    assertRecord(scene.params.motion, 'scene.params.motion');
    assertOnlyKeys(scene.params.motion, MOTION_KEYS, 'scene.params.motion');
    assertFiniteNumbers(scene.params.motion, MOTION_KEYS, 'scene.params.motion');
  }

  if (scene.params.material !== undefined) {
    assertRecord(scene.params.material, 'scene.params.material');
    assertOnlyKeys(scene.params.material, MATERIAL_KEYS, 'scene.params.material');
    assertFiniteNumbers(scene.params.material, ['opacity', 'bloom', 'holoShift'], 'scene.params.material');

    if (scene.params.material.colors !== undefined) {
      if (!Array.isArray(scene.params.material.colors) || scene.params.material.colors.length !== 3) {
        fail('scene.params.material.colors must contain exactly three colors.');
      }
      scene.params.material.colors.forEach((color, index) => {
        assertHexColor(color, `scene.params.material.colors[${index}]`);
      });
    }
  }

  if (scene.params.post !== undefined) {
    assertRecord(scene.params.post, 'scene.params.post');
    assertOnlyKeys(scene.params.post, POST_KEYS, 'scene.params.post');
    if (scene.params.post.dither !== undefined) {
      const dither = scene.params.post.dither;
      assertRecord(dither, 'scene.params.post.dither');
      assertOnlyKeys(dither, DITHER_KEYS, 'scene.params.post.dither');
      if (dither.enabled !== undefined && typeof dither.enabled !== 'boolean') {
        fail('scene.params.post.dither.enabled must be a boolean.');
      }
      if (dither.mode !== undefined && !ALLOWED_DITHER_MODES.has(dither.mode)) {
        fail('scene.params.post.dither.mode must be bayer4, bayer8, or noise.');
      }
      assertFiniteNumbers(dither, ['amount', 'pixelScale', 'posterize'], 'scene.params.post.dither');
    }
  }
}

function assertEnum(value, allowed, path) {
  if (!allowed.has(value)) {
    fail(`${path} must be one of: ${[...allowed].join(', ')}.`);
  }
}

/**
 * Strict, untrusted-input boundary for POST /api/visual-lab/bake.
 *
 * Unknown keys are rejected before the shared client contract normalizer runs,
 * so the endpoint cannot be used to pass JavaScript, shader source, or other
 * renderer implementation details into Remotion.
 */
export function normalizeVisualBakeRequest(body) {
  assertRecord(body, 'request');
  assertOnlyKeys(body, REQUEST_KEYS, 'request');
  assertSceneShape(body.scene);

  assertEnum(body.durationSec, ALLOWED_DURATIONS, 'durationSec');
  assertEnum(body.fps, ALLOWED_FPS, 'fps');
  if (typeof body.width !== 'number' || typeof body.height !== 'number') {
    fail('width and height must be numbers.');
  }
  assertEnum(`${body.width}x${body.height}`, ALLOWED_RESOLUTIONS, 'resolution');
  assertEnum(body.output, ALLOWED_OUTPUTS, 'output');

  const quality = body.quality ?? 'production';
  assertEnum(quality, ALLOWED_QUALITY, 'quality');

  const checkedScene = validateVisualScene(body.scene);
  if (!checkedScene.ok) fail(checkedScene.error);

  // A bake is exactly one canonical cycle. This is deliberately authoritative
  // even when a stale graph payload carries a different preview loop duration.
  const scene = normalizeVisualScene({
    ...checkedScene.value,
    loopDurationSec: body.durationSec,
  });
  const alpha = body.output === 'webm-alpha';

  return {
    scene,
    durationSec: body.durationSec,
    durationFrames: body.durationSec * body.fps,
    fps: body.fps,
    width: body.width,
    height: body.height,
    output: body.output,
    quality,
    extension: alpha ? 'webm' : 'mp4',
    alpha,
  };
}

/**
 * Canonically ordered, JSON-safe input for renderCache.keyFor().
 */
export function createVisualBakeCacheParts(request) {
  return [
    'VisualLabBake',
    VISUAL_LAB_BAKE_CACHE_VERSION,
    request.scene,
    {
      durationSec: request.durationSec,
      fps: request.fps,
      width: request.width,
      height: request.height,
      output: request.output,
      quality: request.quality,
    },
  ];
}

function assertSafePathArgument(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    fail(`${name} must be a non-empty path without null bytes.`);
  }
}

/**
 * Produces an argument vector for execFile('npx', args). Paths remain their own
 * arguments; callers must not join this array into a shell command.
 */
export function buildVisualBakeRenderArgs({ target, propsFile, request }) {
  assertSafePathArgument(target, 'target');
  assertSafePathArgument(propsFile, 'propsFile');
  if (!isRecord(request) || !Number.isInteger(request.durationFrames) || request.durationFrames < 1) {
    fail('request must be a normalized Visual Lab bake request.');
  }

  const args = [
    'remotion',
    'render',
    'src/remotion/index.jsx',
    'VisualLabBake',
    '--output',
    target,
    '--props',
    propsFile,
    '--frames',
    `0-${request.durationFrames - 1}`,
    // ThreeCanvas needs one WebGL context per rendering tab. Keeping this
    // composition single-tab avoids SwiftShader/ANGLE context exhaustion and
    // makes deterministic frame sampling easier to reason about.
    '--concurrency',
    '1',
    '--gl',
    'angle',
  ];

  if (request.output === 'webm-alpha') {
    return [
      ...args,
      '--codec',
      'vp9',
      '--pixel-format',
      'yuva420p',
      '--image-format',
      'png',
    ];
  }

  if (request.output === 'mp4-matte') {
    return [
      ...args,
      '--codec',
      'h264',
      '--pixel-format',
      'yuv420p',
      '--image-format',
      'jpeg',
    ];
  }

  fail('request.output must be webm-alpha or mp4-matte.');
}

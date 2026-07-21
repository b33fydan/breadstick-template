const VISUAL_PARAMS_TYPE = 'visual-params';
const VISUAL_PARAMS_VERSION = 1;
const VISUAL_SCENE_TYPE = 'visual-scene';
const VISUAL_SCENE_VERSION = 1;
const CUBE_FLAME_PRESET = 'cube-flame';
const PRESET_VERSION = 1;
const THREE_ENGINE_VERSION = '0.166.1';

const DEFAULT_SCENE_SEED = 4317;
const DEFAULT_LOOP_DURATION_SEC = 6;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function deepFreeze(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
  }
  return value;
}
/**
 * The production parameter shape consumed by a visual preset. Packets wrap
 * this object in `channels`; renderer code should only ever receive a fresh,
 * normalized copy created by normalizeVisualParams().
 */
export const DEFAULT_VISUAL_PARAMS = deepFreeze({
  emission: {
    intensity: 1,
    count: 512,
    spread: 0.72,
    cubeSize: 0.065,
  },
  motion: {
    riseSpeed: 0.75,
    turbulence: 0.58,
    swirl: 0.22,
    flicker: 0.16,
  },
  material: {
    opacity: 0.82,
    bloom: 0.62,
    holoShift: 0.48,
    colors: ['#ffb000', '#ff0071', '#bdfcff'],
  },
  post: {
    dither: {
      enabled: true,
      mode: 'bayer4',
      amount: 0.18,
      pixelScale: 3,
      posterize: 12,
    },
  },
});

const PARAM_RULES = {
  emission: {
    intensity: { min: 0, max: 2 },
    count: { min: 64, max: 1200, integer: true },
    spread: { min: 0.1, max: 2 },
    cubeSize: { min: 0.01, max: 0.18 },
  },
  motion: {
    riseSpeed: { min: 0, max: 2.5 },
    turbulence: { min: 0, max: 2 },
    swirl: { min: -2, max: 2 },
    flicker: { min: 0, max: 1 },
  },
  material: {
    opacity: { min: 0.05, max: 1 },
    bloom: { min: 0, max: 1.5 },
    holoShift: { min: 0, max: 1 },
  },
  dither: {
    amount: { min: 0, max: 1 },
    pixelScale: { min: 1, max: 8, integer: true },
    posterize: { min: 2, max: 32, integer: true },
  },
};

function cloneDefaults() {
  return {
    emission: { ...DEFAULT_VISUAL_PARAMS.emission },
    motion: { ...DEFAULT_VISUAL_PARAMS.motion },
    material: {
      ...DEFAULT_VISUAL_PARAMS.material,
      colors: [...DEFAULT_VISUAL_PARAMS.material.colors],
    },
    post: { dither: { ...DEFAULT_VISUAL_PARAMS.post.dither } },
  };
}

function clampNumber(value, rule) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const clamped = Math.min(rule.max, Math.max(rule.min, value));
  return rule.integer ? Math.round(clamped) : clamped;
}

function normalizeHexColor(value) {
  if (typeof value !== 'string') return undefined;
  const color = value.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/.exec(color);
  if (short) {
    const [r, g, b] = short[1];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return /^#[0-9a-f]{6}$/.test(color) ? color : undefined;
}

function parameterSource(input) {
  if (!isRecord(input)) return null;
  if (isRecord(input.channels)) return input.channels;
  return input;
}

function applyNumericChannel(target, source, rules) {
  if (!isRecord(source)) return;
  for (const [field, rule] of Object.entries(rules)) {
    const next = clampNumber(source[field], rule);
    if (next !== undefined) target[field] = next;
  }
}

function applyParamsPatch(target, input) {
  const channels = parameterSource(input);
  if (!channels) return target;

  applyNumericChannel(target.emission, channels.emission, PARAM_RULES.emission);
  applyNumericChannel(target.motion, channels.motion, PARAM_RULES.motion);
  applyNumericChannel(target.material, channels.material, PARAM_RULES.material);

  if (isRecord(channels.material) && Array.isArray(channels.material.colors)) {
    for (let index = 0; index < 3; index += 1) {
      const color = normalizeHexColor(channels.material.colors[index]);
      if (color) target.material.colors[index] = color;
    }
  }

  const dither = channels.post?.dither;
  if (isRecord(dither)) {
    if (typeof dither.enabled === 'boolean') target.post.dither.enabled = dither.enabled;
    if (['bayer4', 'bayer8', 'noise'].includes(dither.mode)) target.post.dither.mode = dither.mode;
    applyNumericChannel(target.post.dither, dither, PARAM_RULES.dither);
  }

  return target;
}

/**
 * Produces a fresh, complete parameter object. `base` is useful for applying a
 * partial wired packet over already-normalized local values.
 */
export function normalizeVisualParams(input, base = DEFAULT_VISUAL_PARAMS) {
  const normalized = cloneDefaults();
  if (base !== DEFAULT_VISUAL_PARAMS) applyParamsPatch(normalized, base);
  return applyParamsPatch(normalized, input);
}

export function createVisualParamsPacket(params = DEFAULT_VISUAL_PARAMS, options = {}) {
  const inputPacket = isRecord(params) && params.type === VISUAL_PARAMS_TYPE ? params : null;
  const sourceKind = typeof options.sourceKind === 'string' && options.sourceKind.trim()
    ? options.sourceKind.trim()
    : (typeof inputPacket?.sourceKind === 'string' && inputPacket.sourceKind.trim()
      ? inputPacket.sourceKind.trim()
      : 'field-controls');
  const rawPriority = options.priority ?? inputPacket?.priority ?? 100;
  const priority = typeof rawPriority === 'number' && Number.isFinite(rawPriority)
    ? Math.round(Math.min(10000, Math.max(-10000, rawPriority)))
    : 100;

  return {
    type: VISUAL_PARAMS_TYPE,
    version: VISUAL_PARAMS_VERSION,
    sourceKind,
    priority,
    channels: normalizeVisualParams(inputPacket?.channels ?? params),
  };
}

function normalizeSceneNumber(value, fallback, min, max, integer = false) {
  const finite = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const clamped = Math.min(max, Math.max(min, finite));
  return integer ? Math.round(clamped) : clamped;
}

/**
 * Converts a compatible scene-like value into the canonical serializable v1
 * recipe. It throws only for incompatible renderer/preset contracts; callers
 * handling untrusted data should use validateVisualScene().
 */
export function normalizeVisualScene(input = {}) {
  if (!isRecord(input)) throw new TypeError('Visual scene must be an object.');

  if (input.type !== undefined && input.type !== VISUAL_SCENE_TYPE) {
    throw new TypeError(`Expected ${VISUAL_SCENE_TYPE}@${VISUAL_SCENE_VERSION}; received ${String(input.type)}@${String(input.version ?? '?')}.`);
  }
  if (input.version !== undefined && input.version !== VISUAL_SCENE_VERSION) {
    throw new TypeError(`Visual scene version mismatch: expected ${VISUAL_SCENE_TYPE}@${VISUAL_SCENE_VERSION}; received ${VISUAL_SCENE_TYPE}@${String(input.version)}.`);
  }

  const preset = input.preset ?? CUBE_FLAME_PRESET;
  if (preset !== CUBE_FLAME_PRESET) {
    throw new TypeError(`Unsupported Visual Lab preset "${String(preset)}"; expected "${CUBE_FLAME_PRESET}".`);
  }

  const renderer = isRecord(input.renderer) ? input.renderer : {};
  if (renderer.engine !== undefined && renderer.engine !== 'three') {
    throw new TypeError(`Unsupported Visual Lab renderer "${String(renderer.engine)}"; expected "three".`);
  }
  if (renderer.engineVersion !== undefined && renderer.engineVersion !== THREE_ENGINE_VERSION) {
    throw new TypeError(`Three.js version mismatch: expected ${THREE_ENGINE_VERSION}; received ${String(renderer.engineVersion)}.`);
  }
  if (renderer.presetVersion !== undefined && renderer.presetVersion !== PRESET_VERSION) {
    throw new TypeError(`Cube Flame preset version mismatch: expected ${PRESET_VERSION}; received ${String(renderer.presetVersion)}.`);
  }

  const backgroundInput = isRecord(input.background) ? input.background : {};
  const backgroundMode = ['transparent', 'black', 'breadstick'].includes(backgroundInput.mode)
    ? backgroundInput.mode
    : 'transparent';
  const backgroundColor = normalizeHexColor(backgroundInput.color) ?? '#000000';

  const cameraInput = isRecord(input.camera) ? input.camera : {};

  return {
    type: VISUAL_SCENE_TYPE,
    version: VISUAL_SCENE_VERSION,
    preset,
    seed: normalizeSceneNumber(input.seed, DEFAULT_SCENE_SEED, 0, 0xffffffff, true),
    loopDurationSec: normalizeSceneNumber(input.loopDurationSec, DEFAULT_LOOP_DURATION_SEC, 0.1, 60),
    background: {
      mode: backgroundMode,
      color: backgroundColor,
    },
    camera: {
      preset: cameraInput.preset === 'three-quarter' ? cameraInput.preset : 'three-quarter',
      fov: normalizeSceneNumber(cameraInput.fov, 42, 1, 179),
    },
    params: normalizeVisualParams(input.params),
    renderer: {
      engine: 'three',
      engineVersion: THREE_ENGINE_VERSION,
      presetVersion: PRESET_VERSION,
    },
  };
}

export function createVisualScene(options = {}) {
  const input = isRecord(options) ? options : {};
  return normalizeVisualScene({
    ...input,
    type: VISUAL_SCENE_TYPE,
    version: VISUAL_SCENE_VERSION,
  });
}

/**
 * Non-throwing validation boundary for graph outputs, persistence, and the
 * eventual bake request. Successful validation also returns the normalized
 * recipe that downstream code should use.
 */
export function validateVisualScene(scene) {
  if (!isRecord(scene)) {
    return { ok: false, error: 'Expected a visual-scene@1 object.', value: null };
  }
  if (scene.type !== VISUAL_SCENE_TYPE) {
    return {
      ok: false,
      error: `Expected ${VISUAL_SCENE_TYPE}@${VISUAL_SCENE_VERSION}; received ${String(scene.type ?? 'untyped')}@${String(scene.version ?? '?')}.`,
      value: null,
    };
  }
  if (scene.version !== VISUAL_SCENE_VERSION) {
    return {
      ok: false,
      error: `Visual scene version mismatch: expected ${VISUAL_SCENE_TYPE}@${VISUAL_SCENE_VERSION}; received ${VISUAL_SCENE_TYPE}@${String(scene.version)}.`,
      value: null,
    };
  }

  try {
    return { ok: true, value: normalizeVisualScene(scene), error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), value: null };
  }
}

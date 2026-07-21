// Deterministic CPU model for the Reactive Visual Lab cube-flame preset.
//
// This module deliberately has no DOM or Three.js dependency. Preview and bake
// consumers share the same seeded table and `sampleCubeFlameInto` function so a
// frame is always a pure function of seed + parameters + explicit scene time.

const TAU = Math.PI * 2;
const DEFAULT_LOOP_DURATION_SEC = 6;

export const CUBE_FLAME_PRESET_VERSION = 1;
export const CUBE_FLAME_MAX_COUNT = 1200;
export const CUBE_FLAME_CAMERA = Object.freeze({
  fov: 42,
  near: 0.1,
  far: 40,
  position: Object.freeze([3.35, 0.38, 6.1]),
  target: Object.freeze([0, 0.05, 0]),
});

export const CUBE_FLAME_LIMITS = Object.freeze({
  emission: Object.freeze({
    intensity: Object.freeze([0, 2]),
    count: Object.freeze([64, CUBE_FLAME_MAX_COUNT]),
    spread: Object.freeze([0.1, 2]),
    cubeSize: Object.freeze([0.01, 0.18]),
  }),
  motion: Object.freeze({
    riseSpeed: Object.freeze([0, 2.5]),
    turbulence: Object.freeze([0, 2]),
    swirl: Object.freeze([-2, 2]),
    flicker: Object.freeze([0, 1]),
  }),
  material: Object.freeze({
    opacity: Object.freeze([0.05, 1]),
    bloom: Object.freeze([0, 1.5]),
    holoShift: Object.freeze([0, 1]),
  }),
  post: Object.freeze({
    dither: Object.freeze({
      amount: Object.freeze([0, 1]),
      pixelScale: Object.freeze([1, 8]),
      posterize: Object.freeze([2, 32]),
    }),
  }),
});

const DEFAULT_COLORS = Object.freeze(['#ffb000', '#ff0071', '#bdfcff']);

export const CUBE_FLAME_DEFAULTS = Object.freeze({
  emission: Object.freeze({
    intensity: 1,
    count: 512,
    spread: 0.72,
    cubeSize: 0.065,
  }),
  motion: Object.freeze({
    riseSpeed: 0.75,
    turbulence: 0.58,
    swirl: 0.22,
    flicker: 0.16,
  }),
  material: Object.freeze({
    opacity: 0.82,
    bloom: 0.62,
    holoShift: 0.48,
    colors: DEFAULT_COLORS,
  }),
  post: Object.freeze({
    dither: Object.freeze({
      enabled: true,
      mode: 'bayer4',
      amount: 0.18,
      pixelScale: 3,
      posterize: 12,
    }),
  }),
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteOr(value, fallback) {
  const numeric = typeof value === 'string' && value.trim() !== ''
    ? Number(value)
    : value;
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizedNumber(source, key, fallback, limits, round = false) {
  const value = clamp(finiteOr(source?.[key], fallback), limits[0], limits[1]);
  return round ? Math.round(value) : value;
}

function normalizeHexColor(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : fallback;
}

function resolveParamsRoot(input) {
  if (!isRecord(input)) return {};
  const sceneParams = isRecord(input.params) ? input.params : input;
  return isRecord(sceneParams.channels) ? sceneParams.channels : sceneParams;
}

function resolveChannel(root, name) {
  return isRecord(root[name]) ? root[name] : root;
}

/**
 * Clamp any supported flat, channel-based, packet, or scene params object to
 * the serializable v1 cube-flame shape. Unknown fields are intentionally lost.
 */
export function normalizeCubeFlameParams(input = CUBE_FLAME_DEFAULTS) {
  const root = resolveParamsRoot(input);
  const emissionInput = resolveChannel(root, 'emission');
  const motionInput = resolveChannel(root, 'motion');
  const materialInput = resolveChannel(root, 'material');
  const postInput = resolveChannel(root, 'post');
  const ditherInput = isRecord(postInput.dither)
    ? postInput.dither
    : (isRecord(root.dither) ? root.dither : postInput);

  const colorInput = Array.isArray(materialInput.colors)
    ? materialInput.colors
    : [materialInput.colorA, materialInput.colorB, materialInput.colorC];

  const ditherMode = ['bayer4', 'bayer8', 'noise'].includes(ditherInput.mode)
    ? ditherInput.mode
    : CUBE_FLAME_DEFAULTS.post.dither.mode;

  return {
    emission: {
      intensity: normalizedNumber(
        emissionInput,
        'intensity',
        CUBE_FLAME_DEFAULTS.emission.intensity,
        CUBE_FLAME_LIMITS.emission.intensity,
      ),
      count: normalizedNumber(
        emissionInput,
        'count',
        CUBE_FLAME_DEFAULTS.emission.count,
        CUBE_FLAME_LIMITS.emission.count,
        true,
      ),
      spread: normalizedNumber(
        emissionInput,
        'spread',
        CUBE_FLAME_DEFAULTS.emission.spread,
        CUBE_FLAME_LIMITS.emission.spread,
      ),
      cubeSize: normalizedNumber(
        emissionInput,
        'cubeSize',
        CUBE_FLAME_DEFAULTS.emission.cubeSize,
        CUBE_FLAME_LIMITS.emission.cubeSize,
      ),
    },
    motion: {
      riseSpeed: normalizedNumber(
        motionInput,
        'riseSpeed',
        CUBE_FLAME_DEFAULTS.motion.riseSpeed,
        CUBE_FLAME_LIMITS.motion.riseSpeed,
      ),
      turbulence: normalizedNumber(
        motionInput,
        'turbulence',
        CUBE_FLAME_DEFAULTS.motion.turbulence,
        CUBE_FLAME_LIMITS.motion.turbulence,
      ),
      swirl: normalizedNumber(
        motionInput,
        'swirl',
        CUBE_FLAME_DEFAULTS.motion.swirl,
        CUBE_FLAME_LIMITS.motion.swirl,
      ),
      flicker: normalizedNumber(
        motionInput,
        'flicker',
        CUBE_FLAME_DEFAULTS.motion.flicker,
        CUBE_FLAME_LIMITS.motion.flicker,
      ),
    },
    material: {
      opacity: normalizedNumber(
        materialInput,
        'opacity',
        CUBE_FLAME_DEFAULTS.material.opacity,
        CUBE_FLAME_LIMITS.material.opacity,
      ),
      bloom: normalizedNumber(
        materialInput,
        'bloom',
        CUBE_FLAME_DEFAULTS.material.bloom,
        CUBE_FLAME_LIMITS.material.bloom,
      ),
      holoShift: normalizedNumber(
        materialInput,
        'holoShift',
        CUBE_FLAME_DEFAULTS.material.holoShift,
        CUBE_FLAME_LIMITS.material.holoShift,
      ),
      colors: [
        normalizeHexColor(colorInput[0], DEFAULT_COLORS[0]),
        normalizeHexColor(colorInput[1], DEFAULT_COLORS[1]),
        normalizeHexColor(colorInput[2], DEFAULT_COLORS[2]),
      ],
    },
    post: {
      dither: {
        enabled: typeof ditherInput.enabled === 'boolean'
          ? ditherInput.enabled
          : CUBE_FLAME_DEFAULTS.post.dither.enabled,
        mode: ditherMode,
        amount: normalizedNumber(
          ditherInput,
          'amount',
          CUBE_FLAME_DEFAULTS.post.dither.amount,
          CUBE_FLAME_LIMITS.post.dither.amount,
        ),
        pixelScale: normalizedNumber(
          ditherInput,
          'pixelScale',
          CUBE_FLAME_DEFAULTS.post.dither.pixelScale,
          CUBE_FLAME_LIMITS.post.dither.pixelScale,
        ),
        posterize: normalizedNumber(
          ditherInput,
          'posterize',
          CUBE_FLAME_DEFAULTS.post.dither.posterize,
          CUBE_FLAME_LIMITS.post.dither.posterize,
          true,
        ),
      },
    },
  };
}

function hexToRgb(color) {
  const value = Number.parseInt(color.slice(1), 16);
  return [
    (value >> 16) & 255,
    (value >> 8) & 255,
    value & 255,
  ];
}

function rgbToHex(red, green, blue) {
  const value = (Math.round(red) << 16) | (Math.round(green) << 8) | Math.round(blue);
  return `#${value.toString(16).padStart(6, '0')}`;
}

function mixNumber(from, to, progress) {
  return from + (to - from) * progress;
}

/**
 * Interpolate two valid or partial parameter objects. This is intentionally a
 * control-plane helper: disconnect transitions can call it for ~180 ms while
 * the render loop continues to read only the resulting mutable ref.
 */
export function interpolateCubeFlameParams(from, to, progress) {
  const a = normalizeCubeFlameParams(from);
  const b = normalizeCubeFlameParams(to);
  const amount = clamp(finiteOr(progress, 0), 0, 1);
  if (amount === 0) return a;
  if (amount === 1) return b;
  const colors = a.material.colors.map((color, index) => {
    const fromRgb = hexToRgb(color);
    const toRgb = hexToRgb(b.material.colors[index]);
    return rgbToHex(
      mixNumber(fromRgb[0], toRgb[0], amount),
      mixNumber(fromRgb[1], toRgb[1], amount),
      mixNumber(fromRgb[2], toRgb[2], amount),
    );
  });

  return {
    emission: {
      intensity: mixNumber(a.emission.intensity, b.emission.intensity, amount),
      count: Math.round(mixNumber(a.emission.count, b.emission.count, amount)),
      spread: mixNumber(a.emission.spread, b.emission.spread, amount),
      cubeSize: mixNumber(a.emission.cubeSize, b.emission.cubeSize, amount),
    },
    motion: {
      riseSpeed: mixNumber(a.motion.riseSpeed, b.motion.riseSpeed, amount),
      turbulence: mixNumber(a.motion.turbulence, b.motion.turbulence, amount),
      swirl: mixNumber(a.motion.swirl, b.motion.swirl, amount),
      flicker: mixNumber(a.motion.flicker, b.motion.flicker, amount),
    },
    material: {
      opacity: mixNumber(a.material.opacity, b.material.opacity, amount),
      bloom: mixNumber(a.material.bloom, b.material.bloom, amount),
      holoShift: mixNumber(a.material.holoShift, b.material.holoShift, amount),
      colors,
    },
    post: {
      dither: {
        enabled: amount < 0.5 ? a.post.dither.enabled : b.post.dither.enabled,
        mode: amount < 0.5 ? a.post.dither.mode : b.post.dither.mode,
        amount: mixNumber(a.post.dither.amount, b.post.dither.amount, amount),
        pixelScale: mixNumber(a.post.dither.pixelScale, b.post.dither.pixelScale, amount),
        posterize: Math.round(mixNumber(a.post.dither.posterize, b.post.dither.posterize, amount)),
      },
    },
  };
}

/** Normalize a numeric or string seed to a stable unsigned 32-bit integer. */
export function normalizeCubeFlameSeed(seed) {
  if (Number.isFinite(seed)) return Math.trunc(seed) >>> 0;

  const text = String(seed ?? 'cube-flame');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function createMulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeTableCount(count) {
  return clamp(Math.round(finiteOr(count, CUBE_FLAME_MAX_COUNT)), 1, CUBE_FLAME_MAX_COUNT);
}

/**
 * Build the immutable-in-practice seeded traits used by every sampled frame.
 * Typed arrays make the table cheap to share between preview and bake paths.
 */
export function createCubeSeedTable(seed, count = CUBE_FLAME_MAX_COUNT) {
  const normalizedSeed = normalizeCubeFlameSeed(seed);
  const normalizedCount = normalizeTableCount(count);
  const random = createMulberry32(normalizedSeed);
  const table = {
    version: CUBE_FLAME_PRESET_VERSION,
    seed: normalizedSeed,
    count: normalizedCount,
    phase: new Float32Array(normalizedCount),
    radius: new Float32Array(normalizedCount),
    angle: new Float32Array(normalizedCount),
    curlPhase: new Float32Array(normalizedCount),
    drift: new Float32Array(normalizedCount),
    size: new Float32Array(normalizedCount),
    spinX: new Float32Array(normalizedCount),
    spinY: new Float32Array(normalizedCount),
    spinZ: new Float32Array(normalizedCount),
    variation: new Float32Array(normalizedCount),
  };

  for (let index = 0; index < normalizedCount; index += 1) {
    table.phase[index] = random();
    table.radius[index] = Math.sqrt(random());
    table.angle[index] = random() * TAU;
    table.curlPhase[index] = random();
    table.drift[index] = random() * 2 - 1;
    table.size[index] = 0.62 + random() * 0.76;
    table.spinX[index] = (0.45 + random() * 0.95) * (random() > 0.5 ? 1 : -1);
    table.spinY[index] = (0.45 + random() * 1.15) * (random() > 0.5 ? 1 : -1);
    table.spinZ[index] = (0.35 + random() * 0.85) * (random() > 0.5 ? 1 : -1);
    table.variation[index] = random();
  }

  return table;
}

/** Allocate a reusable output frame. Runtime preview code allocates this once. */
export function createCubeFrame(count = CUBE_FLAME_MAX_COUNT) {
  const normalizedCount = normalizeTableCount(count);
  return {
    count: normalizedCount,
    positions: new Float32Array(normalizedCount * 3),
    rotations: new Float32Array(normalizedCount * 3),
    scales: new Float32Array(normalizedCount),
    life: new Float32Array(normalizedCount),
    alpha: new Float32Array(normalizedCount),
    variation: new Float32Array(normalizedCount),
  };
}

function fract(value) {
  return value - Math.floor(value);
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function normalizedLoopTime(timeSec, loopDurationSec) {
  const duration = Math.max(0.001, finiteOr(loopDurationSec, DEFAULT_LOOP_DURATION_SEC));
  const time = finiteOr(timeSec, 0);
  return (((time % duration) + duration) % duration) / duration;
}

function assertFrameCapacity(seedTable, target, count) {
  if (!seedTable || !Number.isInteger(seedTable.count)) {
    throw new TypeError('cubeFlame: a seed table from createCubeSeedTable() is required');
  }
  if (!target || !(target.positions instanceof Float32Array)) {
    throw new TypeError('cubeFlame: a target frame from createCubeFrame() is required');
  }
  const requiredVectorLength = count * 3;
  if (
    target.positions.length < requiredVectorLength
    || target.rotations.length < requiredVectorLength
    || target.scales.length < count
    || target.life.length < count
    || target.alpha.length < count
    || target.variation.length < count
  ) {
    throw new RangeError(`cubeFlame: target frame capacity is smaller than ${count}`);
  }
}

/**
 * Allocation-free sampler for callers that already normalized their params.
 * Rise speed shapes the periodic ascent curve rather than changing the number
 * of lifecycles, preserving a genuinely seamless loop for every slider value.
 */
export function sampleNormalizedCubeFlameInto(
  seedTable,
  timeSec,
  params,
  target,
  loopDurationSec = DEFAULT_LOOP_DURATION_SEC,
  requestedCount = seedTable?.count,
) {
  const count = Math.min(
    seedTable?.count ?? 0,
    Math.max(1, Math.round(finiteOr(requestedCount, seedTable?.count ?? 1))),
  );
  assertFrameCapacity(seedTable, target, count);

  const emission = params.emission;
  const motion = params.motion;
  const material = params.material;
  const loopTime = normalizedLoopTime(timeSec, loopDurationSec);
  const loopAngle = loopTime * TAU;
  const speedRatio = motion.riseSpeed / CUBE_FLAME_LIMITS.motion.riseSpeed[1];
  const riseExponent = 1.65 - speedRatio * 1.05;
  const phaseWarp = Math.sin(loopAngle) * (motion.riseSpeed - 0.75) * 0.075;
  const phaseAdvance = loopTime + phaseWarp;
  const energy = emission.intensity;
  const energyScale = Math.sqrt(energy);
  const energyAlpha = clamp(energy, 0, 1);
  const heightEnergy = 0.72 + Math.min(energy, 1) * 0.28 + Math.max(0, energy - 1) * 0.12;

  const positions = target.positions;
  const rotations = target.rotations;
  const scales = target.scales;
  const lives = target.life;
  const alphas = target.alpha;
  const variations = target.variation;

  for (let index = 0; index < count; index += 1) {
    const vectorOffset = index * 3;
    const life = fract(seedTable.phase[index] + phaseAdvance);
    const plume = Math.max(0, Math.sin(Math.PI * life));
    const radiusEnvelope = Math.pow(plume, 0.78) * (1 - life * 0.42);
    const flameEnvelope = Math.pow(plume, 0.48) * (1 - life * 0.22);
    const heightLife = Math.pow(life, riseExponent);
    const curlPhase = seedTable.curlPhase[index] * TAU;
    const curlA = Math.sin(loopAngle * 2 + curlPhase);
    const curlB = Math.cos(loopAngle * 3 - curlPhase * 0.73);
    const flickerWave = Math.sin(loopAngle * 3 + curlPhase) * 0.22
      + Math.cos(loopAngle * 7 - curlPhase * 1.31) * 0.12;
    const flickerScale = Math.max(0.2, 1 + motion.flicker * flickerWave);
    const radialDistance = emission.spread
      * (0.06 + seedTable.radius[index] * 0.82)
      * radiusEnvelope;
    const angle = seedTable.angle[index]
      + motion.swirl * TAU * life
      + motion.turbulence * 0.42 * curlA;
    const turbulenceOffset = motion.turbulence * 0.14 * radiusEnvelope;
    const tipLean = seedTable.drift[index] * emission.spread * 0.13 * life * radiusEnvelope;
    const scale = emission.cubeSize
      * seedTable.size[index]
      * flameEnvelope
      * flickerScale
      * energyScale;
    const fadeIn = smoothstep(0, 0.075, life);
    const fadeOut = 1 - smoothstep(0.72, 1, life);
    const alpha = material.opacity
      * energyAlpha
      * fadeIn
      * fadeOut
      * (0.72 + 0.28 * (0.5 + 0.5 * curlB));

    positions[vectorOffset] = Math.cos(angle) * radialDistance
      + curlA * turbulenceOffset
      + tipLean;
    positions[vectorOffset + 1] = -1.48 + 3.16 * heightLife * heightEnergy;
    positions[vectorOffset + 2] = Math.sin(angle) * radialDistance * 0.64
      + curlB * turbulenceOffset * 0.72;

    rotations[vectorOffset] = seedTable.spinX[index]
      * Math.sin(loopAngle + curlPhase);
    rotations[vectorOffset + 1] = angle
      + seedTable.spinY[index] * Math.cos(loopAngle * 2 - curlPhase);
    rotations[vectorOffset + 2] = seedTable.spinZ[index]
      * Math.sin(loopAngle * 3 + curlPhase * 0.61);

    scales[index] = scale;
    lives[index] = life;
    alphas[index] = alpha;
    variations[index] = seedTable.variation[index];
  }

  target.count = count;
  return target;
}

/** Normalize params, then write a deterministic frame into caller-owned arrays. */
export function sampleCubeFlameInto(
  seedTable,
  timeSec,
  params,
  target,
  { loopDurationSec = DEFAULT_LOOP_DURATION_SEC, count = seedTable?.count } = {},
) {
  return sampleNormalizedCubeFlameInto(
    seedTable,
    timeSec,
    normalizeCubeFlameParams(params),
    target,
    loopDurationSec,
    count,
  );
}

/** Convenience sampler for tests, bake setup, and one-off deterministic frames. */
export function sampleCubeFlame({
  seed = 4317,
  timeSec = 0,
  loopDurationSec = DEFAULT_LOOP_DURATION_SEC,
  params = CUBE_FLAME_DEFAULTS,
  count = CUBE_FLAME_DEFAULTS.emission.count,
} = {}) {
  const seedTable = createCubeSeedTable(seed, count);
  const target = createCubeFrame(count);
  return sampleCubeFlameInto(seedTable, timeSec, params, target, {
    loopDurationSec,
    count,
  });
}

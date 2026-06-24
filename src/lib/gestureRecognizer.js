// Pure registry + dispatcher for per-prop gesture recognizers.
// Each prop (Cube, Disc, Wire, Scale) registers a recognizer module here
// in its own file (e.g. src/lib/gestures/cube.js does
// `registerPropRecognizer('cube', cubeRecognizer)` at module load).
//
// Phase 1 ships the registry only. Phase 2+ adds the per-prop modules.

const _registry = new Map();

export function registerPropRecognizer(propName, recognizerFn) {
  if (typeof recognizerFn !== 'function') {
    throw new Error(`recognizerFn must be a function, got ${typeof recognizerFn}`);
  }
  _registry.set(propName, recognizerFn);
}

export function recognize(landmarks, propName) {
  if (!landmarks || (!landmarks.leftHand && !landmarks.rightHand)) {
    return { gesture: 'idle' };
  }
  if (!propName) {
    return { gesture: 'idle' };
  }
  const fn = _registry.get(propName);
  if (!fn) {
    return { gesture: 'idle' };
  }
  return fn(landmarks);
}

// For tests + debug — never use in production code paths.
export function _resetRegistry() {
  _registry.clear();
}

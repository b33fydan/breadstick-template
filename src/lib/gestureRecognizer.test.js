import { describe, it, expect, afterEach } from 'vitest';
import { recognize, registerPropRecognizer, _resetRegistry } from './gestureRecognizer.js';

const synthLandmarks = (count = 21) =>
  Array.from({ length: count }, (_, i) => ({ x: i * 0.01, y: i * 0.01, z: 0 }));

describe('gestureRecognizer', () => {
  afterEach(() => _resetRegistry());

  it('returns idle when no prop is selected', () => {
    const result = recognize({ leftHand: synthLandmarks(), rightHand: null }, null);
    expect(result.gesture).toBe('idle');
  });

  it('returns idle when prop has no registered recognizer', () => {
    const result = recognize({ leftHand: synthLandmarks(), rightHand: null }, 'no-such-prop');
    expect(result.gesture).toBe('idle');
  });

  it('dispatches to a registered prop recognizer', () => {
    registerPropRecognizer('test-prop', (landmarks) => ({
      gesture: 'test-gesture',
      hand: landmarks.leftHand ? 'left' : 'right',
    }));

    const result = recognize({ leftHand: synthLandmarks(), rightHand: null }, 'test-prop');
    expect(result.gesture).toBe('test-gesture');
    expect(result.hand).toBe('left');
  });

  it('returns idle when both hands are null', () => {
    const result = recognize({ leftHand: null, rightHand: null }, 'test-prop');
    expect(result.gesture).toBe('idle');
  });
});

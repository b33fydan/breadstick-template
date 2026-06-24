import { describe, test, expect } from 'vitest';
import { validateHyperframesRequest } from './hyperframesValidate.js';

describe('validateHyperframesRequest', () => {
  test('lower-third accepts lowerName (new field)', () => {
    expect(validateHyperframesRequest({ effect: 'lower-third', lowerName: 'Mia' })).toBeNull();
  });
  test('lower-third still accepts legacy name (backward compatible)', () => {
    expect(validateHyperframesRequest({ effect: 'lower-third', name: 'op_123' })).toBeNull();
  });
  test('lower-third rejects when neither lowerName nor name', () => {
    expect(validateHyperframesRequest({ effect: 'lower-third' })).toMatch(/name required/);
  });
  test('hook-caption requires caption', () => {
    expect(validateHyperframesRequest({ effect: 'hook-caption' })).toMatch(/caption/);
    expect(validateHyperframesRequest({ effect: 'hook-caption', caption: 'hi' })).toBeNull();
  });
  test('highlight-sweep requires caption and targetWord', () => {
    expect(validateHyperframesRequest({ effect: 'highlight-sweep', caption: 'hi' })).toMatch(/targetWord/);
    expect(validateHyperframesRequest({ effect: 'highlight-sweep', caption: 'hi', targetWord: 'now' })).toBeNull();
  });
  test('title-card requires title', () => {
    expect(validateHyperframesRequest({ effect: 'title-card' })).toMatch(/title/);
  });
  test('burst-lines needs nothing', () => {
    expect(validateHyperframesRequest({ effect: 'burst-lines' })).toBeNull();
  });
  test('unknown effect rejected', () => {
    expect(validateHyperframesRequest({ effect: 'nope' })).toMatch(/unknown effect/);
  });
});

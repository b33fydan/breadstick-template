import { describe, test, expect } from 'vitest';
import { validateOverlay, buildOverlayBody } from './studioRender';

describe('validateOverlay', () => {
  test('hook-caption requires caption', () => {
    expect(validateOverlay('hook-caption', {})).toMatch(/caption/);
    expect(validateOverlay('hook-caption', { caption: 'hi' })).toBeNull();
  });
  test('highlight-sweep requires caption + targetWord', () => {
    expect(validateOverlay('highlight-sweep', { caption: 'hi' })).toMatch(/targetWord/);
    expect(validateOverlay('highlight-sweep', { caption: 'hi', targetWord: 'now' })).toBeNull();
  });
  test('title-card requires title', () => {
    expect(validateOverlay('title-card', {})).toMatch(/title/);
    expect(validateOverlay('title-card', { title: 'T' })).toBeNull();
  });
  test('lower-third requires lowerName', () => {
    expect(validateOverlay('lower-third', {})).toMatch(/name required/);
    expect(validateOverlay('lower-third', { lowerName: 'Mia' })).toBeNull();
  });
  test('burst-lines needs nothing', () => {
    expect(validateOverlay('burst-lines', {})).toBeNull();
  });
});

describe('buildOverlayBody', () => {
  const base = { videoPath: 'E:/v.mp4', name: 'op_1' };
  test('always sets name to the opId and includes shared fields', () => {
    const b = buildOverlayBody({ effect: 'hook-caption', params: { caption: 'hi' }, ...base });
    expect(b.name).toBe('op_1');
    expect(b.videoUrl).toBe('E:/v.mp4');
    expect(b.effect).toBe('hook-caption');
    expect(b.accentColor).toBe('#C9A227');
    expect(b.quality).toBe('standard');
    expect(b.caption).toBe('hi');
    expect(b.position).toBe('bottom');
  });
  test('lower-third sends lowerName (person) and keeps name as opId', () => {
    const b = buildOverlayBody({ effect: 'lower-third', params: { lowerName: 'Mia', role: 'Birder', side: 'right' }, ...base });
    expect(b.lowerName).toBe('Mia');
    expect(b.name).toBe('op_1');           // opId, NOT the person
    expect(b.role).toBe('Birder');
    expect(b.side).toBe('right');
  });
  test('title-card carries title + subtitle', () => {
    const b = buildOverlayBody({ effect: 'title-card', params: { title: 'T', subtitle: 'S' }, ...base });
    expect(b).toMatchObject({ title: 'T', subtitle: 'S' });
  });
  test('highlight-sweep carries caption/targetWord/direction/position', () => {
    const b = buildOverlayBody({ effect: 'highlight-sweep', params: { caption: 'c', targetWord: 'w' }, ...base });
    expect(b).toMatchObject({ caption: 'c', targetWord: 'w', direction: 'ltr', position: 'bottom' });
  });
  test('burst-lines coerces timestamp and defaults density', () => {
    const b = buildOverlayBody({ effect: 'burst-lines', params: { timestamp: '2.5' }, ...base });
    expect(b.timestamp).toBe(2.5);
    expect(b.density).toBe('medium');
  });
  test('burst-lines keeps a valid 0 timestamp and falls back only on NaN', () => {
    expect(buildOverlayBody({ effect: 'burst-lines', params: { timestamp: 0 }, ...base }).timestamp).toBe(0);
    expect(buildOverlayBody({ effect: 'burst-lines', params: { timestamp: 'abc' }, ...base }).timestamp).toBe(0.5);
    expect(buildOverlayBody({ effect: 'burst-lines', params: {}, ...base }).timestamp).toBe(0.5);
  });
  test('accentColor + quality overridable', () => {
    const b = buildOverlayBody({ effect: 'hook-caption', params: { caption: 'h' }, accentColor: '#fff', quality: 'high', ...base });
    expect(b.accentColor).toBe('#fff');
    expect(b.quality).toBe('high');
  });
});

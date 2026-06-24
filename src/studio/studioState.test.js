import { describe, test, expect } from 'vitest';
import { selectShot, addComment, getSelectedShot, setVideo, clearVideo, setOverlayEffect, setOverlayParam, startRender, renderSucceeded, renderFailed, setViewing } from './studioState';
import { NEON_VEIL_PROJECT } from './studioFixture';

describe('selectShot', () => {
  test('sets selectedShotId when the shot exists', () => {
    const next = selectShot(NEON_VEIL_PROJECT, 'shot-1');
    expect(next.selectedShotId).toBe('shot-1');
  });
  test('returns the project unchanged when the shot is unknown', () => {
    const next = selectShot(NEON_VEIL_PROJECT, 'nope');
    expect(next).toBe(NEON_VEIL_PROJECT);
  });
  test('does not mutate the input', () => {
    selectShot(NEON_VEIL_PROJECT, 'shot-2');
    expect(NEON_VEIL_PROJECT.selectedShotId).toBe('shot-3');
  });
  test('returns the same reference when the shot is already selected', () => {
    expect(selectShot(NEON_VEIL_PROJECT, 'shot-3')).toBe(NEON_VEIL_PROJECT);
  });
});

describe('addComment', () => {
  const comment = { id: 'c-new', kind: 'change-request', author: 'Sam Lee', date: '2026-06-20', text: 'tighten this' };
  test('appends a comment to the target shot', () => {
    const next = addComment(NEON_VEIL_PROJECT, 'shot-2', comment);
    const shot2 = next.shots.find((s) => s.id === 'shot-2');
    expect(shot2.comments).toHaveLength(1);
    expect(shot2.comments[0]).toEqual(comment);
  });
  test('leaves other shots untouched', () => {
    const next = addComment(NEON_VEIL_PROJECT, 'shot-2', comment);
    const shot3 = next.shots.find((s) => s.id === 'shot-3');
    expect(shot3.comments).toHaveLength(2);
    expect(next.shots.find((s) => s.id === 'shot-3')).toBe(
      NEON_VEIL_PROJECT.shots.find((s) => s.id === 'shot-3')
    );
  });
  test('returns the project unchanged when the shot is unknown', () => {
    const next = addComment(NEON_VEIL_PROJECT, 'nope', comment);
    expect(next).toBe(NEON_VEIL_PROJECT);
  });
  test('does not mutate the input', () => {
    addComment(NEON_VEIL_PROJECT, 'shot-2', comment);
    expect(NEON_VEIL_PROJECT.shots.find((s) => s.id === 'shot-2').comments).toHaveLength(0);
  });
});

describe('getSelectedShot', () => {
  test('returns the shot matching selectedShotId', () => {
    expect(getSelectedShot(NEON_VEIL_PROJECT).id).toBe('shot-3');
  });
  test('returns null when selection points at nothing', () => {
    expect(getSelectedShot({ ...NEON_VEIL_PROJECT, selectedShotId: 'nope' })).toBeNull();
  });
});

const VIDEO = { path: 'E:/v.mp4', url: 'http://localhost:3001/api/local-video?path=E%3A%2Fv.mp4', width: 1920, height: 1080, durationSec: 12 };

describe('setVideo', () => {
  test('sets the video and resets render state', () => {
    const dirty = { ...NEON_VEIL_PROJECT, render: { status: 'done', resultUrl: 'http://x/old.mp4', error: null, viewing: 'composited' } };
    const next = setVideo(dirty, VIDEO);
    expect(next.video).toEqual(VIDEO);
    expect(next.render).toEqual({ status: 'idle', resultUrl: null, error: null, viewing: 'original' });
  });
  test('clearVideo nulls the video and resets render', () => {
    const next = clearVideo({ ...NEON_VEIL_PROJECT, video: VIDEO });
    expect(next.video).toBeNull();
    expect(next.render.status).toBe('idle');
  });
});

describe('setOverlayEffect', () => {
  test('sets overlays[0] type and blank params when type changes', () => {
    const next = setOverlayEffect(NEON_VEIL_PROJECT, 'shot-3', 'title-card');
    const shot = next.shots.find((s) => s.id === 'shot-3');
    expect(shot.overlays[0].type).toBe('title-card');
    expect(shot.overlays[0].params).toEqual({});
  });
  test('re-selecting the SAME type is a no-op (preserves params)', () => {
    const withParams = setOverlayParam(NEON_VEIL_PROJECT, 'shot-3', 'role', 'Birder'); // shot-3 seeded type is lower-third
    const next = setOverlayEffect(withParams, 'shot-3', 'lower-third');
    expect(next).toBe(withParams);
  });
});

describe('setOverlayParam', () => {
  test('updates overlays[0].params[key]', () => {
    const next = setOverlayParam(NEON_VEIL_PROJECT, 'shot-3', 'role', 'Host');
    expect(next.shots.find((s) => s.id === 'shot-3').overlays[0].params.role).toBe('Host');
  });
  test('creates overlays[0] on a shot that has none', () => {
    const next = setOverlayParam(NEON_VEIL_PROJECT, 'shot-2', 'caption', 'hi'); // shot-2 seeded overlays: []
    expect(next.shots.find((s) => s.id === 'shot-2').overlays[0].params.caption).toBe('hi');
  });
});

describe('render transitions', () => {
  test('startRender sets rendering and clears prior result/error', () => {
    const next = startRender({ ...NEON_VEIL_PROJECT, render: { status: 'error', resultUrl: 'http://x/o.mp4', error: 'boom', viewing: 'composited' } });
    expect(next.render.status).toBe('rendering');
    expect(next.render.resultUrl).toBeNull();
    expect(next.render.error).toBeNull();
  });
  test('renderSucceeded stores url and switches to composited', () => {
    const next = renderSucceeded(NEON_VEIL_PROJECT, 'http://localhost:3001/renders/hyperframes/op.mp4');
    expect(next.render).toEqual({ status: 'done', resultUrl: 'http://localhost:3001/renders/hyperframes/op.mp4', error: null, viewing: 'composited' });
  });
  test('renderFailed records the message', () => {
    const next = renderFailed(NEON_VEIL_PROJECT, 'ffmpeg exploded');
    expect(next.render.status).toBe('error');
    expect(next.render.error).toBe('ffmpeg exploded');
  });
  test('setViewing flips the toggle', () => {
    expect(setViewing(NEON_VEIL_PROJECT, 'composited').render.viewing).toBe('composited');
  });
  test('does not mutate the input', () => {
    startRender(NEON_VEIL_PROJECT);
    expect(NEON_VEIL_PROJECT.render.status).toBe('idle');
  });
});

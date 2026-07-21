import { describe, it, expect } from 'vitest';
import { DEFAULT_VISUAL_LAB_BAKE_PROPS, resolveVisualLabBackground } from './visualLabBakeConfig.js';

const sceneWith = (color) => ({ background: { mode: 'solid', color } });

describe('resolveVisualLabBackground', () => {
  it('mp4-matte fills with the scene background color when no matteColor prop is given', () => {
    const r = resolveVisualLabBackground({ scene: sceneWith('#123456'), output: 'mp4-matte', matteColor: undefined });
    expect(r.transparent).toBe(false);
    expect(r.color).toBe('#123456');
  });
  it('an explicit matteColor prop overrides the scene color', () => {
    const r = resolveVisualLabBackground({ scene: sceneWith('#123456'), output: 'mp4-matte', matteColor: '#ff00ff' });
    expect(r.color).toBe('#ff00ff');
  });
  it('invalid scene color falls back to the default matte', () => {
    const r = resolveVisualLabBackground({ scene: sceneWith('not-a-color'), output: 'mp4-matte', matteColor: undefined });
    expect(r.color).toBe(DEFAULT_VISUAL_LAB_BAKE_PROPS.matteColor);
  });
  it('webm-alpha stays transparent regardless', () => {
    const r = resolveVisualLabBackground({ scene: sceneWith('#123456'), output: 'webm-alpha', matteColor: undefined });
    expect(r.transparent).toBe(true);
  });
});

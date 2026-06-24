import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import StudioView from './StudioView';

describe('StudioView (static render)', () => {
  const html = renderToStaticMarkup(<StudioView />);

  test('renders the board title and meta', () => {
    expect(html).toContain('Neon Veil TVC');
    expect(html).toContain('neon_veil_theme.mp3');
  });
  test('renders all five shot labels', () => {
    for (const label of ['Wide aerial', 'Low backlit', 'OTS', 'Dolly in', 'Close-up']) {
      expect(html).toContain(label);
    }
  });
  test('inspector defaults to shot 3 with its seeded comments', () => {
    expect(html).toContain('Shot 3');
    expect(html).toContain('add muffled SFX, song picks up here');
    expect(html).toContain('this is the hook shot');
  });
  test('overlay catalog shows the unattached snippet types', () => {
    expect(html).toContain('Hook caption');
    expect(html).toContain('Burst lines');
  });
});

describe('StudioView v2 (static render)', () => {
  const html = renderToStaticMarkup(<StudioView />);
  test('shows the import path field', () => {
    expect(html).toContain('Import video');
    expect(html.toLowerCase()).toContain('paste a local video path');
  });
  test('shot-3 (seeded lower-third) renders its param form + a Render button', () => {
    // seeded selectedShotId is shot-3 with a lower-third overlay
    expect(html).toContain('Render overlay');
    expect(html).toContain('Name');   // lower-third param label
  });
});

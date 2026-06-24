import { describe, it, expect } from 'vitest';
import { FEWSHOTS } from './fewshots';
import { validateSpec } from './applier';
import { compileCatalogPrompt } from './catalog';

describe('few-shot lane specs', () => {
  it('ships all four canonical lanes', () => {
    expect(FEWSHOTS.map((f) => f.spec.lane).sort()).toEqual(
      ['16gami', 'carousel-video', 'ugc', 'video']);
  });

  it('every few-shot validates with at most the soft deliverable warning', () => {
    for (const f of FEWSHOTS) {
      const r = validateSpec(f.spec);
      expect(r.ok, f.ask).toBe(true);
      const hard = r.warnings.filter((w) => !w.toLowerCase().includes('deliverable'));
      expect(hard, `${f.ask}: ${hard.join(' | ')}`).toEqual([]);
    }
  });
});

describe('compileCatalogPrompt', () => {
  const prompt = compileCatalogPrompt({ characters: [{ id: 'mia-chen', name: 'Mia Chen', niche: 'backyard birding' }], scriptTypes: [{ id: 'st-story', name: 'Story' }], conversionLevels: [{ id: 'cv-soft', name: 'Soft' }] });

  it('teaches the envelope contract', () => {
    expect(prompt).toContain('"reply"');
    expect(prompt).toContain('"spec"');
  });
  it('lists every catalog type', () => {
    expect(prompt).toContain('ugc-gen');
    expect(prompt).toContain('frame-sandwich');
  });
  it('includes runtime context (character ids)', () => {
    expect(prompt).toContain('mia-chen');
  });
  it('embeds all four few-shots', () => {
    expect(prompt.match(/EXAMPLE/g).length).toBeGreaterThanOrEqual(4);
  });
  it('states the composition rules', () => {
    expect(prompt).toMatch(/QC Gate/i);
    expect(prompt).toMatch(/self-contained/i);
  });
});

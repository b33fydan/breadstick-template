// src/canvas/engine/prompts.test.js
import { describe, it, expect } from 'vitest';
import { parseSlides, buildGamiPrompt, buildGamiCtaPrompt, buildTitleCardPrompt, GAMI_ART_STYLE, TITLE_CARD_STYLE } from './prompts.js';

describe('parseSlides', () => {
  it('parses numbered slides and joins continuation lines', () => {
    const slides = parseSlides('1. First slide.\ncontinues here\n2) Second slide.');
    expect(slides).toEqual([
      { num: 1, text: 'First slide. continues here' },
      { num: 2, text: 'Second slide.' },
    ]);
  });
  it('falls back to one slide per non-bracket line when nothing is numbered', () => {
    const slides = parseSlides('[meta]\nplain line one\nplain line two');
    expect(slides.map(s => s.text)).toEqual(['plain line one', 'plain line two']);
  });
});

describe('prompt builders', () => {
  it('buildGamiPrompt embeds the style block and the narrative', () => {
    const p = buildGamiPrompt('a fox guards the henhouse');
    expect(p).toContain(GAMI_ART_STYLE);
    expect(p).toContain('a fox guards the henhouse');
  });
  it('buildGamiCtaPrompt is the fixed AI-agent diorama', () => {
    expect(buildGamiCtaPrompt()).toContain('small AI Agent');
  });
  it('buildTitleCardPrompt truncates long slide text to 8 words + ellipsis', () => {
    const p = buildTitleCardPrompt('one two three four five six seven eight nine ten');
    expect(p).toContain(TITLE_CARD_STYLE);
    expect(p).toContain('one two three four five six seven eight...');
  });
});

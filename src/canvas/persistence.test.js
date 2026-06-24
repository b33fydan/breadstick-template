// src/canvas/persistence.test.js
import { describe, it, expect } from 'vitest';
import {
  EPHEMERAL_STATUSES,
  IN_FLIGHT_STATUSES,
  scrubEphemeralOutput,
  scrubEphemeralOutputs,
} from './persistence.js';

describe('scrubEphemeralOutput (per-field scrub)', () => {
  it('drops an in-flight renderStatus but keeps durable fields (2026-06-12 stuck-carousel incident)', () => {
    // Tab closed mid-legacy-carousel-render: output had renderStatus:'rendering'
    // and no top-level status, so the whole-output drop missed it and the
    // "Render Carousel" button hydrated permanently disabled.
    const out = { renderStatus: 'rendering', slides: ['slide1.png'], topic: 'birding' };
    const scrubbed = scrubEphemeralOutput(out);
    expect(scrubbed).toEqual({ slides: ['slide1.png'], topic: 'birding' });
    expect('renderStatus' in scrubbed).toBe(false);
  });

  it('drops an in-flight batchStatus', () => {
    const out = { batchStatus: 'generating', items: [1, 2] };
    expect(scrubEphemeralOutput(out)).toEqual({ items: [1, 2] });
  });

  it("drops batchStatus:'grading' (FFmpeg grade node — in-flight value outside the legacy 4)", () => {
    const out = { batchStatus: 'grading', graded: [] };
    expect(scrubEphemeralOutput(out)).toEqual({ graded: [] });
  });

  it('drops other in-flight *Status fields (animateStatus, suggestStatus, planStatus, bakeStatus, scanStatus)', () => {
    expect(scrubEphemeralOutput({ animateStatus: 'animating' })).toEqual({});
    expect(scrubEphemeralOutput({ suggestStatus: 'thinking' })).toEqual({});
    expect(scrubEphemeralOutput({ planStatus: 'planning' })).toEqual({});
    expect(scrubEphemeralOutput({ bakeStatus: 'baking' })).toEqual({});
    expect(scrubEphemeralOutput({ scanStatus: 'scanning' })).toEqual({});
  });

  it("drops a top-level status holding an in-flight value outside the whole-drop set (Blotato 'posting')", () => {
    const out = { status: 'posting', caption: 'hello' };
    expect(scrubEphemeralOutput(out)).toEqual({ caption: 'hello' });
  });

  it('drops several ephemeral fields from the same output in one pass', () => {
    const out = { renderStatus: 'rendering', animateStatus: 'animating', slides: ['a'] };
    expect(scrubEphemeralOutput(out)).toEqual({ slides: ['a'] });
  });

  it('keeps terminal statuses (done / error / idle / skipped / kie taskStatus echoes)', () => {
    const out = {
      status: 'done',
      renderStatus: 'error',
      batchStatus: 'done',
      animateStatus: 'skipped',
      taskStatus: 'completed',
    };
    expect(scrubEphemeralOutput(out)).toBe(out); // untouched → same reference
  });

  it('returns the same reference when there is nothing to scrub', () => {
    const out = { slides: ['a'], status: 'done' };
    expect(scrubEphemeralOutput(out)).toBe(out);
  });

  it('does not mutate the input output', () => {
    const out = { renderStatus: 'rendering', slides: ['a'] };
    scrubEphemeralOutput(out);
    expect(out).toEqual({ renderStatus: 'rendering', slides: ['a'] });
  });

  it('only scrubs status-named fields — other fields holding in-flight words survive', () => {
    const out = { label: 'rendering', mode: 'generating' };
    expect(scrubEphemeralOutput(out)).toBe(out);
  });

  it('stays shallow: nested in-flight markers are left alone (sprite-forge resumes those itself)', () => {
    // Sprite Forge persists results[i].status:'polling' + taskId in its own
    // localStorage key and resumes the poll on mount — the canvas scrub must
    // not reach into nested structures.
    const out = { batchStatus: 'done', results: [{ status: 'polling', taskId: 't1' }] };
    expect(scrubEphemeralOutput(out)).toBe(out);
  });

  it('passes through non-object outputs unchanged', () => {
    expect(scrubEphemeralOutput(null)).toBe(null);
    expect(scrubEphemeralOutput(undefined)).toBe(undefined);
    expect(scrubEphemeralOutput('text')).toBe('text');
    const arr = [1, 2];
    expect(scrubEphemeralOutput(arr)).toBe(arr);
  });
});

describe('scrubEphemeralOutputs (save/restore map scrub)', () => {
  it('still drops whole outputs whose top-level status is in EPHEMERAL_STATUSES', () => {
    const result = scrubEphemeralOutputs({
      a: { status: 'rendering', partial: true },
      b: { status: 'submitting' },
      c: { status: 'polling' },
      d: { status: 'generating' },
      e: { status: 'done', url: 'x.mp4' },
    });
    expect(Object.keys(result)).toEqual(['e']);
    expect(result.e).toEqual({ status: 'done', url: 'x.mp4' });
  });

  it('field-scrubs outputs that the whole-output drop misses', () => {
    const result = scrubEphemeralOutputs({
      carousel: { renderStatus: 'rendering', slides: ['s.png'] },
      grade: { batchStatus: 'grading', videoUrls: ['v.mp4'] },
    });
    expect(result.carousel).toEqual({ slides: ['s.png'] });
    expect(result.grade).toEqual({ videoUrls: ['v.mp4'] });
  });

  it('keeps falsy entries verbatim (legacy save-loop behavior)', () => {
    const result = scrubEphemeralOutputs({ ghost: null });
    expect('ghost' in result).toBe(true);
    expect(result.ghost).toBe(null);
  });

  it('returns a fresh map and keeps clean outputs by reference', () => {
    const clean = { status: 'done', url: 'x.png' };
    const input = { n1: clean };
    const result = scrubEphemeralOutputs(input);
    expect(result).not.toBe(input);
    expect(result.n1).toBe(clean);
  });

  it('handles an empty map', () => {
    expect(scrubEphemeralOutputs({})).toEqual({});
  });
});

describe('status sets', () => {
  it('IN_FLIGHT_STATUSES is a superset of EPHEMERAL_STATUSES', () => {
    // If a value is ephemeral enough to drop a whole output on `status`, the
    // per-field scrub must also catch it on batchStatus/renderStatus — keep
    // the sets from drifting apart.
    for (const s of EPHEMERAL_STATUSES) {
      expect(IN_FLIGHT_STATUSES.has(s)).toBe(true);
    }
  });
});

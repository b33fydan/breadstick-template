import { describe, expect, it, vi } from 'vitest';
import {
  getVisualStageActivitySnapshot,
  registerVisualStageActivity,
} from './visualScheduler.js';

describe('visual stage activity governor', () => {
  it('caps activity at two and resumes a queued stage when a slot opens', () => {
    const a = { activate: vi.fn(), deactivate: vi.fn() };
    const b = { activate: vi.fn(), deactivate: vi.fn() };
    const c = { activate: vi.fn(), deactivate: vi.fn() };
    const registrations = [a, b, c].map((callbacks) => registerVisualStageActivity({
      onActivate: callbacks.activate,
      onDeactivate: callbacks.deactivate,
    }));

    registrations[0].setRequested(true);
    registrations[1].setRequested(true);
    expect(getVisualStageActivitySnapshot().filter((entry) => entry.active)).toHaveLength(2);

    registrations[2].setRequested(true);
    expect(getVisualStageActivitySnapshot().filter((entry) => entry.active)).toHaveLength(2);
    expect(a.deactivate).toHaveBeenCalledTimes(1);
    expect(c.activate).toHaveBeenCalledTimes(1);

    registrations[2].setEligible(false);
    expect(getVisualStageActivitySnapshot().filter((entry) => entry.active)).toHaveLength(2);
    expect(c.deactivate).toHaveBeenCalledTimes(1);
    expect(a.activate).toHaveBeenCalledTimes(2);

    for (const registration of registrations) registration.dispose();
    expect(getVisualStageActivitySnapshot()).toEqual([]);
  });
});

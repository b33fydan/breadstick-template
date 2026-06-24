import { describe, it, expect } from 'vitest';
import { formatDiaryTicket } from './ticket.js';

const DATE = new Date('2026-06-21T09:00:00Z');

describe('formatDiaryTicket', () => {
  it('summarizes clips, seconds, and distinct lanes', () => {
    const draft = { chunks: [
      { lane: 'DJI Air 3', durationSec: 12 }, { lane: 'Lumix G7', durationSec: 12 },
      { lane: 'DJI Air 3', durationSec: 11 },
    ], totalSec: 35 };
    const s = formatDiaryTicket(draft, DATE);
    expect(s).toContain('week of 2026-06-21');
    expect(s).toContain('3 clips');
    expect(s).toContain('35s');
    expect(s).toContain('DJI Air 3, Lumix G7');
    expect(s).toContain('diary');               // tells the user the verb
  });
  it('handles an empty pool without throwing', () => {
    const s = formatDiaryTicket({ chunks: [], totalSec: 0 }, DATE);
    expect(s).toContain('0 clips');
  });
});

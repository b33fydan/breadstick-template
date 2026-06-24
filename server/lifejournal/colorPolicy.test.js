import { describe, it, expect } from 'vitest';
import { isLog } from './colorPolicy.js';

const base = { lane: 'Drone/Mini 4 Pro', rel: 'Drone/Mini 4 Pro/x.mp4', colorTransfer: 'bt709' };

describe('isLog', () => {
  it('defaults to LOG (apply LUT) when nothing excludes it', () => {
    expect(isLog(base, {})).toBe(true);
  });
  it('skips HLG footage (a reliable negative)', () => {
    expect(isLog({ ...base, colorTransfer: 'arib-std-b67' }, {})).toBe(false);
  });
  it('skips lanes in nonLogLanes', () => {
    expect(isLog(base, { nonLogLanes: ['Drone/Mini 4 Pro'] })).toBe(false);
  });
  it('skips rels in nonLogRels', () => {
    expect(isLog(base, { nonLogRels: [base.rel] })).toBe(false);
  });
  it('returns false when logDefault is off', () => {
    expect(isLog(base, { logDefault: false })).toBe(false);
  });
});

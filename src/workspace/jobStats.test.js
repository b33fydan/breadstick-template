// src/workspace/jobStats.test.js
import { describe, it, expect } from 'vitest';
import { summarizeJobs } from './jobStats';

describe('summarizeJobs', () => {
  it('returns zeros for empty or undefined', () => {
    expect(summarizeJobs([])).toEqual({ running: 0, queued: 0, error: 0 });
    expect(summarizeJobs(undefined)).toEqual({ running: 0, queued: 0, error: 0 });
  });
  it('counts running/queued/error and ignores done + cancelled', () => {
    const jobs = [
      { status: 'running' }, { status: 'running' },
      { status: 'queued' },
      { status: 'done' }, { status: 'cancelled' },
      { status: 'error' },
    ];
    expect(summarizeJobs(jobs)).toEqual({ running: 2, queued: 1, error: 1 });
  });
  it('counts multiple errors', () => {
    expect(summarizeJobs([{ status: 'error' }, { status: 'error' }])).toEqual({ running: 0, queued: 0, error: 2 });
  });
});

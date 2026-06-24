// src/workspace/jobStats.js — pure job-queue counts for the status strip.
// Unit-tested without IO; the strip polls GET /api/jobs and passes data.jobs.
export function summarizeJobs(jobs) {
  const out = { running: 0, queued: 0, error: 0 };
  for (const j of jobs || []) {
    if (j.status === 'running') out.running += 1;
    else if (j.status === 'queued') out.queued += 1;
    else if (j.status === 'error') out.error += 1;
  }
  return out;
}

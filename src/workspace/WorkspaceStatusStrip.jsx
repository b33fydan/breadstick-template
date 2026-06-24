// src/workspace/WorkspaceStatusStrip.jsx — compact ambient header strip:
// active character + character count + live job-queue state (polled).
import { useState, useEffect } from 'react';
import { summarizeJobs } from './jobStats';
import './WorkspaceStatusStrip.css';

const POLL_MS = 8000;

export default function WorkspaceStatusStrip({ activeCharacterName, characterCount }) {
  const [jobs, setJobs] = useState({ running: 0, queued: 0, error: 0 });

  useEffect(() => {
    let timer = null;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/jobs');
        const data = await res.json();
        if (!cancelled) setJobs(summarizeJobs(data.jobs));
      } catch {
        // server down / transient — keep last stats, no spam
      }
    };
    const start = () => { if (!timer) { poll(); timer = setInterval(poll, POLL_MS); } };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVis = () => (document.visibilityState === 'visible' ? start() : stop());

    document.addEventListener('visibilitychange', onVis);
    if (document.visibilityState === 'visible') start();
    return () => { cancelled = true; stop(); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const active = jobs.running + jobs.queued;
  const jobParts = [];
  if (jobs.running) jobParts.push(`${jobs.running} running`);
  if (jobs.queued) jobParts.push(`${jobs.queued} queued`);

  return (
    <div className="ws-strip" title="Workspace status">
      <span className="ws-strip-pill ws-strip-muted">{activeCharacterName || '—'}</span>
      <span className="ws-strip-pill ws-strip-muted">
        {characterCount} {characterCount === 1 ? 'character' : 'characters'}
      </span>
      <span className="ws-strip-pill ws-strip-jobs">
        {active > 0 ? `▶ ${jobParts.join(' · ')}` : 'idle'}
        {jobs.error > 0 && <span className="ws-strip-error-dot" title={`${jobs.error} errored`} />}
      </span>
    </div>
  );
}

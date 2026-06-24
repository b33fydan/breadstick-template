import { spawn as realSpawn, exec } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import process from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VOICE_AGENT_DIR = join(__dirname, '..', 'voice-agent');
const RING = 50;

function defaultKill(pid, child) {
  if (process.platform === 'win32') {
    // uv -> python -> children; /T kills the whole tree, /F forces it.
    exec(`taskkill /PID ${pid} /T /F`, () => {});
  } else {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
}

export function createVoiceWorker({ spawnFn = realSpawn, killFn = defaultKill } = {}) {
  let child = null;
  let pid = null;
  let startedAt = null;
  const log = [];

  function pushLog(chunk) {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) { log.push(line); if (log.length > RING) log.shift(); }
    }
  }

  function status() {
    return { running: !!child, pid, startedAt, recentLog: log.slice(-RING) };
  }

  function start() {
    if (child) return { running: true, pid };
    log.length = 0;
    const c = spawnFn('uv', ['run', 'python', 'src/agent.py', 'dev'], {
      cwd: VOICE_AGENT_DIR,
      env: process.env, // inherits keys (server backfills blanked vars from .env)
      shell: true,      // Windows: resolve `uv` from PATH
    });
    child = c; pid = c.pid; startedAt = Date.now();
    c.stdout?.on('data', pushLog);
    c.stderr?.on('data', pushLog);
    c.on('exit', (code) => { pushLog(`[worker exited: ${code}]`); child = null; pid = null; startedAt = null; });
    return { running: true, pid };
  }

  function stop() {
    if (!child) return { running: false };
    const target = pid;
    const c = child;
    child = null; pid = null; startedAt = null;
    killFn(target, c);
    return { running: false };
  }

  return { start, stop, status };
}

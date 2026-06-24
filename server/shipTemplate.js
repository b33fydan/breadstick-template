// server/shipTemplate.js
// Voice-to-deploy orchestrator. Pure control flow over injected adapters:
// branch -> claude-apply -> build-gate -> commit/push -> Vercel preview-poll.
// FAILURE = throw (so the job queue lands it in 'error'); SUCCESS = {ok:true,...}.
// The invariant gate-fail => git.push never called is the safety contract.
import { resolve, sep } from 'path';
import { realpathSync } from 'fs';
import { scanInstruction } from '../src/lib/shipGate.js';

const DEFAULT_BRANCH_PREFIX = 'ship';

function slugify(instruction) {
  return (instruction || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'change';
}

// Remove a secret token (and the embedded-credential URL form) from any string.
export function scrubToken(text, token) {
  let s = String(text == null ? '' : text);
  if (token) s = s.split(token).join('***');
  s = s.replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@');
  return s;
}

// Quarantine-safe, short, tail-kept reason from a raw error/build log.
function tidyReason(raw, token) {
  let s = scrubToken(raw, token).replace(/`+/g, '').replace(/\r/g, '');
  s = s.replace(/\n{2,}/g, '\n').trim();
  if (s.length > 280) s = '…' + s.slice(-280);
  return s || 'unknown error';
}

// Resolve symlinks/junctions so a link can't disguise a target as non-breadstick.
// realpathSync throws if the path doesn't exist yet → fall back to the lexical path.
function defaultRealpath(p) {
  try { return realpathSync(p); } catch { return p; }
}

// True if target IS the breadstick repo, or an ancestor/descendant of it.
// realpath-resolves both sides first (symlink guard) before the lexical compare.
function isBreadstickRepo(targetPath, breadstickRoot, realpath = defaultRealpath) {
  const norm = (p) => {
    let r = resolve(realpath(p));
    if (process.platform === 'win32') r = r.toLowerCase();
    return r.replace(/[\\/]+$/, '');
  };
  const t = norm(targetPath), b = norm(breadstickRoot);
  return t === b || b.startsWith(t + sep) || t.startsWith(b + sep);
}

export function createShipTemplate({
  runClaude, git, runGate, vercel, now,
  repoPath, breadstickRoot, githubToken,
  branchPrefix = DEFAULT_BRANCH_PREFIX, logger = console,
  realpath = defaultRealpath, scan = scanInstruction,
}) {
  function fail(stage, raw, extra = {}) {
    const err = new Error(`${stage}: ${tidyReason(raw, githubToken)}`);
    err.stage = stage;
    Object.assign(err, extra);
    throw err;
  }

  async function run(input = {}, ctx = {}) {
    const { signal } = ctx;
    const instruction = (input && typeof input.instruction === 'string') ? input.instruction.trim() : '';
    if (!instruction) fail('input', 'empty instruction');
    if (!repoPath || typeof repoPath !== 'string') fail('config', 'SHIP_TEMPLATE_REPO_PATH is not set');
    if (isBreadstickRepo(repoPath, breadstickRoot, realpath)) fail('guard', 'refusing to operate on the breadstick repo');
    // Inbound instruction scan: untrusted WhatsApp/Slack text drives a skip-perms agent.
    // Deterministic injection gate (no LLM in the verdict) — blocks before any branch/claude work.
    const verdict = scan(instruction);
    if (verdict && verdict.verdict !== 'SHIP') {
      fail('scan', `instruction blocked by injection gate (taint ${Number(verdict.taintScore || 0).toFixed(2)})`);
    }

    const branch = `${branchPrefix}/${slugify(instruction)}-${now()}`;

    try { await git.prepareBranch({ branch, cwd: repoPath, signal }); }
    catch (e) { fail('branch', e.message); }

    let applied;
    try { applied = await runClaude(instruction, { cwd: repoPath, signal }); }
    catch (e) { fail('apply', e.message); }
    if (!applied || !applied.ok) fail('apply', (applied && (applied.stderr || applied.stdout)) || 'claude exited non-zero');

    let gate;
    try { gate = await runGate({ cwd: repoPath, signal }); }
    catch (e) { fail('gate', e.message); }
    if (!gate || !gate.ok) fail('gate', (gate && gate.log) || 'build failed'); // <-- CRITICAL: nothing below runs on red

    let sha;
    try {
      await git.commitAll({ message: `ship: ${instruction}`.slice(0, 200), cwd: repoPath, signal });
      sha = await git.headSha({ cwd: repoPath });
      await git.push({ branch, cwd: repoPath, signal });
    } catch (e) { fail('push', e.message); }

    let preview;
    try { preview = await vercel.waitForPreview({ sha, branch, signal }); }
    catch (e) { fail('preview', `pushed ${branch} but ${tidyReason(e.message, githubToken)}`, { branch, sha }); }
    if (!preview || !preview.url) fail('preview', `pushed ${branch} but no preview URL`, { branch, sha });

    logger.log(`[shipTemplate] shipped ${branch} -> ${preview.url}`);
    return { ok: true, previewUrl: preview.url, branch, sha };
  }

  return { run };
}

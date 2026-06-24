// server/jobTypes.js
/**
 * Job-type registry. The only edit-tool-aware code in the queue stack.
 * Built with the server-side helpers it needs (injected, not imported) so it
 * stays unit-testable. Each type declares how to build its CLI args, its
 * timeout, and how to phrase the done/error WhatsApp message. Adding a lane =
 * one TYPES entry (no queue changes) — see docs/.../2026-06-13-footage-job-queue.md.
 *
 * shortform-process pack→args mirrors the legacy handlers exactly:
 *   - named pack  → ['process','--overlay',<pack>,'--no-grade']   (text command)
 *   - 'none'      → ['process','--no-overlay','--no-grade']        (text command)
 *   - default     → ['process']                                   (WhatsApp video upload)
 */
const SHORTFORM_TIMEOUT_MS = 1800000; // 30 min
const LONGFORM_TIMEOUT_MS = 3600000;  // 60 min — longform runs are heavier

export function createJobTypes({ runCli, paths, extract, shipTemplate, lifejournal }) {
  function packToArgs(pack) {
    if (pack === 'none') return ['process', '--no-overlay', '--no-grade'];
    if (!pack || pack === 'default') return ['process'];
    return ['process', '--overlay', pack, '--no-grade'];
  }

  const TYPES = {
    'shortform-process': {
      args: (input) => packToArgs(input.pack),
      timeout: SHORTFORM_TIMEOUT_MS,
      done: (r) => (r && r.driveUrl ? `Processed.\n${r.driveUrl}` : 'Processed — check /Short form OUT/.'),
      error: (e) => `Process failed.\n${e}`,
    },
    longform: {
      args: (input) => ['longform', '--pov', input.fileId, ...(input.silenceCut ? ['--silence-cut'] : [])],
      timeout: LONGFORM_TIMEOUT_MS,
      done: (r) => (r && r.driveUrl ? `Longform done.\n${r.driveUrl}` : 'Longform done — check /Short form OUT/.'),
      error: (e) => `Longform failed.\n${e}`,
    },
    'ship-template': {
      run: (input, ctx) => shipTemplate.run(input, ctx),
      done: (r) => (r && r.previewUrl ? `Shipped 🚀 ${r.previewUrl}` : `Pushed ${r && r.branch} (no preview URL).`),
      error: (e) => `Couldn't ship — ${e}`,
    },
    'lifejournal-diary': {
      run: (input, ctx) => lifejournal.assemble(input, ctx),
      done: (r) => {
        if (!r || !r.outputs || !r.outputs.length) return 'Diary entry done.';
        const tag = r.capped ? ' (silent — daily TTS cap)' : r.silent ? ' (silent)' : '';
        const n = r.outputs.length;
        const lines = r.outputs.map((o) => `• ${o.series}: ${o.driveUrl || o.outPath}`).join('\n');
        const fail = (r.failed && r.failed.length) ? ` (${r.failed.length} failed: ${r.failed.join(', ')})` : '';
        return `Diary ${r.entryId} ready${tag} — ${n} look${n > 1 ? 's' : ''}${fail}.\n${lines}`;
      },
      error: (e) => `Diary build failed.\n${e}`,
    },
  };

  function has(type) {
    return Object.prototype.hasOwnProperty.call(TYPES, type);
  }

  async function run({ type, input = {}, signal }) {
    const spec = TYPES[type];
    if (!spec) throw new Error(`unknown job type: ${type}`);
    if (spec.run) return spec.run(input, { signal });
    const r = await runCli(paths.SHORTFORM_CLI, spec.args(input), spec.timeout, { signal });
    if (r.exitCode !== 0) throw new Error(`exit ${r.exitCode}: ${(r.stderr || '').slice(0, 400)}`);
    return { driveUrl: extract.drive(r.stdout) || null };
  }

  function formatDone(type, result) {
    const spec = TYPES[type];
    return spec ? spec.done(result) : 'Done.';
  }

  function formatError(type, error) {
    const spec = TYPES[type];
    return spec ? spec.error(error) : `Failed.\n${error}`;
  }

  return { run, formatDone, formatError, has };
}

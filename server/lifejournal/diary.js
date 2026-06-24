// server/lifejournal/diary.js
// LifeJournal orchestrator. draft() = dry-run selection (+ optional script). assemble() =
// VO (optional) → footage selection to VO length → ffmpeg → ledger append. Heavy IO injected.
import fs from 'node:fs';
import path from 'node:path';
import { createFootagePool } from './footagePool.js';
import { createClipLedger } from './clipLedger.js';
import { isLog } from './colorPolicy.js';
import { selectChunks } from './selector.js';
import { buildAssembleCommands } from './assembler.js';

export function createDiary({
  indexPath, ledgerPath, lutDir, config,
  tts, probeDuration, runCmd, shapeScript,
  ttsBudget = null, deliver = null,
  now = () => Date.now(),
  pool = createFootagePool({ indexPath }),
  ledger = createClipLedger({ ledgerPath }),
}) {
  const policy = () => ({ logDefault: config.logDefault, nonLogLanes: config.nonLogLanes, nonLogRels: config.nonLogRels });
  const isLogFn = (clip) => isLog(clip, policy());

  function nextEntryId() {
    let n = 0;
    try { n = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter((l) => l.trim()).length; } catch { n = 0; }
    return `entry-${String(n + 1).padStart(4, '0')}`;
  }

  async function resolveScript(thought, scriptText) {
    if (scriptText) return scriptText;
    if (thought && shapeScript) return shapeScript(thought);
    return null;
  }

  async function draft({ thought = null, scriptText = null, lanes = null, targetSec = config.targetSec, seed = 1 } = {}) {
    const availableByLane = pool.available(ledger.usedSet(), { lanes });
    const sel = selectChunks({ availableByLane, targetSec, beats: config.beats, windowSec: config.windowSec, seed, isLogFn });
    return { entryId: nextEntryId(), script: await resolveScript(thought, scriptText), ...sel };
  }

  async function assemble({ thought = null, scriptText = null, voiceId = config.voiceId, lanes = null, targetSec = config.targetSec, seed = 1, series: seriesArg } = {}, { signal } = {}) {
    const entryId = nextEntryId();
    fs.mkdirSync(config.outDir, { recursive: true });

    // Resolve which looks to render.
    const names = (seriesArg && seriesArg.length) ? seriesArg : (config.defaultSeries || []);
    if (!names.length) throw new Error('LifeJournal: no series configured');
    const defs = names.map((n) => {
      const d = config.series?.[n];
      if (!d) throw new Error(`LifeJournal: unknown series "${n}"`);
      return { name: n, ...d };
    });

    // One base temp dir per entry; cleaned up in finally regardless of outcome.
    const baseTmp = fs.mkdtempSync(path.join(config.outDir, `${entryId}-tmp-`));
    try {
      // 1. Script + VO — happens ONCE regardless of look count.
      const script = await resolveScript(thought, scriptText);
      let voPath = null;
      let capped = false;
      let durationSec = targetSec;
      if (script && voiceId && tts) {
        if (!ttsBudget || ttsBudget.check(script.length)) {
          voPath = path.join(baseTmp, 'vo.mp3');
          await tts({ text: script, voiceId, outPath: voPath });
          ttsBudget?.record(script.length);
          durationSec = await probeDuration(voPath);
        } else {
          capped = true;
        }
      }

      // 2. Select footage to VO (or target) length — ONCE.
      const availableByLane = pool.available(ledger.usedSet(), { lanes });
      const sel = selectChunks({ availableByLane, targetSec: durationSec, beats: config.beats, windowSec: config.windowSec, seed, isLogFn });
      if (!sel.chunks.length) throw new Error('LifeJournal: no footage available (pool exhausted?)');

      // 3. Loop looks — each gets its own sub-dir inside baseTmp + output file in outDir.
      const outputs = [];
      const failed = [];

      for (const def of defs) {
        const lookTmp = path.join(baseTmp, def.name);
        fs.mkdirSync(lookTmp, { recursive: true });
        const outPath = path.join(config.outDir, `${entryId}-${def.name}.mp4`);
        try {
          const { cmds } = buildAssembleCommands({
            chunks: sel.chunks, voPath, outPath, tmpDir: lookTmp,
            canvas: def.canvas,
            lut: path.join(lutDir, def.lut),
            grain: def.grain,
            fit: def.fit,
            muteOriginal: config.muteOriginal,
          });
          for (const cmd of cmds) {
            if (cmd.concatList) {
              const body = cmd.concatList.files.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n') + '\n';
              fs.writeFileSync(cmd.concatList.path, body);
            }
            await runCmd({ bin: cmd.bin, args: cmd.args, signal });
          }

          // Best-effort deliver.
          let driveUrl = null;
          if (deliver) {
            try { driveUrl = await deliver({ outPath, entryId }); }
            catch (e) { console.error('[lifejournal] deliver failed:', e.message); }
          }
          outputs.push({ series: def.name, outPath, driveUrl });
        } catch (e) {
          console.error(`[lifejournal] look "${def.name}" failed:`, e.message);
          failed.push(def.name);
        }
      }

      if (!outputs.length) throw new Error(`LifeJournal: all looks failed (${failed.join(', ')})`);

      // 4. Persist no-reuse — ONCE after all looks.
      ledger.append({ entryId, ts: new Date(now()).toISOString(), clipRels: sel.consumedRels });

      return { entryId, silent: !voPath, capped, durationSec: sel.totalSec, clipsUsed: sel.consumedRels, outputs, failed };
    } finally {
      try { fs.rmSync(baseTmp, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }

  return { draft, assemble };
}

// lib/elevenlabs.js — shared ElevenLabs TTS + duration probe (ESM).
// Extracted from maestro-cli.js so LifeJournal and Maestro share one call path.
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';

const DEFAULT_MODEL = 'eleven_multilingual_v2';
const DEFAULT_VOICE_SETTINGS = { stability: 0.65, similarity_boost: 0.80, style: 0.15, use_speaker_boost: true };

export async function elevenLabsTTS({
  text, voiceId, outPath,
  apiKey = process.env.ELEVENLABS_API_KEY,
  model = DEFAULT_MODEL,
  voiceSettings = DEFAULT_VOICE_SETTINGS,
  fetchFn = fetch,
  writeFn = writeFile,
}) {
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');
  if (!voiceId) throw new Error('voiceId required (set LIFEJOURNAL_VOICE_ID)');
  const resp = await fetchFn(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey, Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model, voice_settings: voiceSettings }),
  });
  if (!resp.ok) {
    let detail = ''; try { detail = (await resp.text()).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`ElevenLabs TTS ${resp.status}: ${detail}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  await writeFn(outPath, buf);
  return { path: outPath, bytes: buf.length };
}

export function probeDurationSec(path, { runFn = execFile } = {}) {
  return new Promise((resolve, reject) => {
    runFn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path], (err, stdout) => {
      if (err) return reject(err);
      const sec = parseFloat(String(stdout).trim());
      if (!Number.isFinite(sec)) return reject(new Error(`ffprobe: unparseable duration for ${path}`));
      resolve(sec);
    });
  });
}

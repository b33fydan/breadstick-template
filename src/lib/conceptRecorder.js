// MediaRecorder wrapper — captures the composed stage canvas + mic stream
// to webm, POSTs the blob to the save endpoint, returns the saved URL.
//
// Lifecycle:
//   const rec = createConceptRecorder({ canvas, audioStream, propName });
//   await rec.start();
//   ... user performs gestures, narrates ...
//   const { url } = await rec.stop();

const SOFT_CAP_SEC = 60;
const HARD_CAP_SEC = 300;

export function createConceptRecorder({ canvas, audioStream, propName = 'preview' }) {
  if (!canvas) throw new Error('conceptRecorder: canvas required');

  const canvasStream = canvas.captureStream(30); // 30 FPS
  // Compose video track from canvas + audio track from mic stream
  const tracks = [
    ...canvasStream.getVideoTracks(),
    ...(audioStream ? audioStream.getAudioTracks() : []),
  ];
  const composedStream = new MediaStream(tracks);

  let recorder = null;
  let chunks = [];
  let startTime = 0;
  let hardCapTimeout = null;

  return {
    async start() {
      chunks = [];
      const mimeType = pickMime();
      recorder = new MediaRecorder(composedStream, { mimeType, videoBitsPerSecond: 8_000_000 });
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.start(1000); // 1s chunks for safety
      startTime = performance.now();
      hardCapTimeout = setTimeout(() => {
        if (recorder && recorder.state === 'recording') recorder.stop();
      }, HARD_CAP_SEC * 1000);
    },

    async stop() {
      if (!recorder || recorder.state !== 'recording') {
        throw new Error('conceptRecorder: not currently recording');
      }
      if (hardCapTimeout) clearTimeout(hardCapTimeout);
      const stopped = new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      recorder.stop();
      await stopped;
      const blob = new Blob(chunks, { type: chunks[0]?.type || 'video/webm' });
      const url = await uploadBlob(blob, propName);
      return { url, blob, durationSec: (performance.now() - startTime) / 1000 };
    },

    getElapsedSec() {
      return recorder ? (performance.now() - startTime) / 1000 : 0;
    },

    isOverSoftCap() {
      return this.getElapsedSec() > SOFT_CAP_SEC;
    },
  };
}

function pickMime() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'video/webm';
}

async function uploadBlob(blob, propName) {
  // MediaRecorder sets blob.type to e.g. 'video/webm;codecs=vp9,opus'. That's
  // RFC-invalid (unquoted comma in a parameter value) — the `content-type`
  // library that body-parser uses throws on it, `type-is` returns null, and
  // express.raw() falls through without consuming the body. The bytes are
  // still real webm, so we strip the codecs hint and send the clean base type.
  const contentType = (blob.type || 'video/webm').split(';')[0] || 'video/webm';
  console.log('[conceptRecorder] uploading', { rawType: blob.type, sentType: contentType, size: blob.size });

  // Express API runs on :3001; Vite serves the page on :5173. No proxy is
  // configured (codebase convention is absolute URLs for /api/*).
  const res = await fetch(
    `http://localhost:3001/api/concept-composer/save?prop=${encodeURIComponent(propName)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: blob,
    }
  );
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  const json = await res.json();
  return json.url;
}

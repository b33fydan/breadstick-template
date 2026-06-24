// Video source factories — owns the "where do pixels come from" decision
// that handTracker.js used to own.
//
// Two flavors:
//   attachWebcam({ videoEl })         → live mic+camera via getUserMedia
//   attachFile({ videoEl, file })     → playback of a local File-object
//
// Both return:
//   {
//     dimensions: { w, h },   // native source resolution
//     stream: MediaStream|null, // present for webcam (audio track), null for file
//     dispose(): void          // stops tracks / revokes object URLs
//   }
//
// The videoEl is fully wired and playing by the time the promise resolves.

const WEBCAM_REQUEST = { width: 1280, height: 720, facingMode: 'user' };

export async function attachWebcam({ videoEl }) {
  if (!videoEl) throw new Error('attachWebcam: videoEl required');

  const stream = await navigator.mediaDevices.getUserMedia({
    video: WEBCAM_REQUEST,
    audio: true,
  });
  videoEl.srcObject = stream;
  videoEl.muted = true;       // we render the video element invisibly; audio comes via the recorder track
  videoEl.loop = false;
  videoEl.removeAttribute('src');
  await waitForMetadata(videoEl);
  await videoEl.play();

  return {
    dimensions: { w: videoEl.videoWidth, h: videoEl.videoHeight },
    stream,
    dispose() {
      stream.getTracks().forEach((t) => t.stop());
      videoEl.srcObject = null;
    },
  };
}

export async function attachFile({ videoEl, file }) {
  if (!videoEl) throw new Error('attachFile: videoEl required');
  if (!file) throw new Error('attachFile: file required');

  // URL.createObjectURL is the standard way to feed a File into <video>.
  // Browser keeps a reference until URL.revokeObjectURL is called; we do
  // that in dispose() so the GC can reclaim the bytes when the source is
  // swapped out.
  const url = URL.createObjectURL(file);
  videoEl.srcObject = null;
  videoEl.src = url;
  videoEl.muted = true;       // Audio is recorded separately on a lav mic; video file audio is ignored
  videoEl.loop = true;        // loop so prop animations replay against the same gesture
  videoEl.playsInline = true;
  await waitForMetadata(videoEl);
  await videoEl.play();

  return {
    dimensions: { w: videoEl.videoWidth, h: videoEl.videoHeight },
    stream: null,
    dispose() {
      videoEl.pause();
      videoEl.removeAttribute('src');
      videoEl.load();
      URL.revokeObjectURL(url);
    },
  };
}

function waitForMetadata(videoEl) {
  if (videoEl.readyState >= 1 && videoEl.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onMeta = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error('video metadata load failed')); };
    function cleanup() {
      videoEl.removeEventListener('loadedmetadata', onMeta);
      videoEl.removeEventListener('error', onErr);
    }
    videoEl.addEventListener('loadedmetadata', onMeta);
    videoEl.addEventListener('error', onErr);
  });
}

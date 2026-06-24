/**
 * withRemotionBrowserRetry — retry the well-known ~25s Remotion Chrome-launch flake.
 *
 * Remotion hardcodes a 25000ms browser-connect timeout in @remotion/renderer
 * (open-browser.js) with no env/CLI knob. On a busy machine the FIRST render of
 * a fresh process can miss the launch race and abort with a TimeoutError from
 * BrowserRunner. A second attempt nearly always succeeds (Chrome files are hot
 * in the page cache).
 *
 * Mirrors the inline wrapper in server.js so the CLI and server agree on what
 * "the flaky timeout" is. Lives here (pure, testable) and is used by
 * shortform-cli.js, whose renders are synchronous execSync — so the detector
 * scans err.stderr/err.stdout too, where execSync stashes the real Remotion text
 * (err.message is only "Command failed: <cmd>").
 */

export function isBrowserConnectTimeout(err) {
  if (!err) return false;
  const blob = [err.message, err.stderr, err.stdout]
    .map((x) => (x == null ? '' : String(x)))
    .join(' ')
    .toLowerCase();
  return (
    blob.includes('trying to connect to the browser') ||
    (blob.includes('timeouterror') && blob.includes('browserrunner'))
  );
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withRemotionBrowserRetry(fn, opts = {}) {
  const { label = 'remotion', retries = 1, delayMs = 1000, sleep = defaultSleep } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isBrowserConnectTimeout(err)) throw err;
      attempt += 1;
      console.warn(`[${label}] browser-connect timeout — retry ${attempt}/${retries} after ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
}

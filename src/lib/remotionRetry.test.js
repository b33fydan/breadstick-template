import { describe, it, expect, vi } from 'vitest';
import { isBrowserConnectTimeout, withRemotionBrowserRetry } from './remotionRetry.js';

describe('isBrowserConnectTimeout', () => {
  it('detects the "trying to connect to the browser" message', () => {
    expect(isBrowserConnectTimeout(new Error('Trying to connect to the browser...'))).toBe(true);
  });

  it('detects TimeoutError + BrowserRunner combo', () => {
    expect(isBrowserConnectTimeout(new Error('TimeoutError thrown by BrowserRunner'))).toBe(true);
  });

  it('detects the timeout when it lives in err.stderr (the execSync case)', () => {
    // execSync throws "Command failed: npx remotion render ..." in .message,
    // and the real Remotion error text only appears in .stderr.
    const err = new Error('Command failed: npx remotion render ...');
    err.stderr = 'A delayRender() "Trying to connect to the browser" timed out after 25000ms';
    expect(isBrowserConnectTimeout(err)).toBe(true);
  });

  it('is false for an unrelated render error', () => {
    const err = new Error('Command failed');
    err.stderr = 'Error: Could not find composition "SkyframeOverlay"';
    expect(isBrowserConnectTimeout(err)).toBe(false);
  });

  it('is false for null/undefined', () => {
    expect(isBrowserConnectTimeout(null)).toBe(false);
    expect(isBrowserConnectTimeout(undefined)).toBe(false);
  });
});

describe('withRemotionBrowserRetry', () => {
  it('returns the result without retrying when fn succeeds first try', async () => {
    const fn = vi.fn().mockReturnValue('ok');
    const sleep = vi.fn().mockResolvedValue();
    const out = await withRemotionBrowserRetry(fn, { sleep });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries once on a browser-connect timeout, then succeeds', async () => {
    const timeoutErr = new Error('Command failed');
    timeoutErr.stderr = 'Trying to connect to the browser timed out after 25000ms';
    const fn = vi.fn()
      .mockImplementationOnce(() => { throw timeoutErr; })
      .mockReturnValueOnce('healed');
    const sleep = vi.fn().mockResolvedValue();
    const out = await withRemotionBrowserRetry(fn, { sleep, delayMs: 1000 });
    expect(out).toBe('healed');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('rethrows immediately on a non-timeout error (no retry)', async () => {
    const realErr = new Error('Could not find composition "SkyframeOverlay"');
    const fn = vi.fn().mockImplementation(() => { throw realErr; });
    const sleep = vi.fn().mockResolvedValue();
    await expect(withRemotionBrowserRetry(fn, { sleep })).rejects.toThrow(/Could not find composition/);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('throws after exhausting retries on a persistent timeout', async () => {
    const timeoutErr = new Error('Command failed');
    timeoutErr.stderr = 'TimeoutError from BrowserRunner';
    const fn = vi.fn().mockImplementation(() => { throw timeoutErr; });
    const sleep = vi.fn().mockResolvedValue();
    await expect(withRemotionBrowserRetry(fn, { sleep, retries: 1 })).rejects.toBe(timeoutErr);
    expect(fn).toHaveBeenCalledTimes(2); // initial + 1 retry
  });
});

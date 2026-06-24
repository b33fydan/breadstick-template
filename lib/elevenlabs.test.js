// lib/elevenlabs.test.js
import { describe, it, expect, vi } from 'vitest';
import { elevenLabsTTS, probeDurationSec } from './elevenlabs.js';

describe('elevenLabsTTS', () => {
  it('posts to the voice endpoint and writes the audio buffer', async () => {
    const writes = [];
    const fetchFn = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('MP3').buffer }));
    const writeFn = async (p, buf) => { writes.push({ p, len: buf.length }); };
    const r = await elevenLabsTTS({ text: 'hi', voiceId: 'V1', outPath: '/tmp/vo.mp3', apiKey: 'k', fetchFn, writeFn });
    expect(fetchFn).toHaveBeenCalledWith('https://api.elevenlabs.io/v1/text-to-speech/V1', expect.objectContaining({ method: 'POST' }));
    expect(r).toEqual({ path: '/tmp/vo.mp3', bytes: 3 });
    expect(writes[0].len).toBe(3);
  });
  it('throws without an api key', async () => {
    await expect(elevenLabsTTS({ text: 'x', voiceId: 'V', outPath: '/tmp/x', apiKey: '', fetchFn: vi.fn() }))
      .rejects.toThrow('ELEVENLABS_API_KEY');
  });
  it('throws without a voiceId', async () => {
    await expect(elevenLabsTTS({ text: 'x', voiceId: '', outPath: '/tmp/x', apiKey: 'k', fetchFn: vi.fn() }))
      .rejects.toThrow('voiceId');
  });
});

describe('probeDurationSec', () => {
  it('parses the ffprobe duration', async () => {
    const runFn = (bin, args, cb) => cb(null, '12.34\n');
    expect(await probeDurationSec('/v.mp3', { runFn })).toBeCloseTo(12.34);
  });
  it('rejects on unparseable output', async () => {
    const runFn = (bin, args, cb) => cb(null, 'N/A');
    await expect(probeDurationSec('/v.mp3', { runFn })).rejects.toThrow('unparseable');
  });
});

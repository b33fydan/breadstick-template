import { describe, it, expect, vi } from 'vitest';
import { createVoiceWorker } from './voiceWorker.js';

function fakeChild() {
  return { pid: 1234, stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn(), kill: vi.fn() };
}

describe('voiceWorker', () => {
  it('starts a worker and reports running', () => {
    const spawnFn = vi.fn(() => fakeChild());
    const w = createVoiceWorker({ spawnFn, killFn: vi.fn() });
    expect(w.status().running).toBe(false);
    expect(w.start()).toEqual({ running: true, pid: 1234 });
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(w.status().running).toBe(true);
  });

  it('is idempotent — a second start does not spawn again', () => {
    const spawnFn = vi.fn(() => fakeChild());
    const w = createVoiceWorker({ spawnFn, killFn: vi.fn() });
    w.start();
    w.start();
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it('stop kills the worker and clears state', () => {
    const killFn = vi.fn();
    const w = createVoiceWorker({ spawnFn: vi.fn(() => fakeChild()), killFn });
    w.start();
    expect(w.stop()).toEqual({ running: false });
    expect(killFn).toHaveBeenCalledWith(1234, expect.anything());
    expect(w.status().running).toBe(false);
  });

  it('stop is safe when nothing is running', () => {
    const w = createVoiceWorker({ spawnFn: vi.fn(), killFn: vi.fn() });
    expect(() => w.stop()).not.toThrow();
    expect(w.status().running).toBe(false);
  });
});

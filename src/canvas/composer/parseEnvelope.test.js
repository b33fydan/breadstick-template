import { describe, it, expect } from 'vitest';
import { parseEnvelope } from './parseEnvelope';

describe('parseEnvelope', () => {
  it('parses a bare JSON envelope', () => {
    const r = parseEnvelope('{"reply":"hi","spec":null}');
    expect(r.ok).toBe(true);
    expect(r.reply).toBe('hi');
    expect(r.spec).toBeNull();
  });

  it('strips ```json code fences before parsing (haiku/caption lesson)', () => {
    const r = parseEnvelope('```json\n{"reply":"fenced"}\n```');
    expect(r.ok).toBe(true);
    expect(r.reply).toBe('fenced');
  });

  it('strips bare ``` fences', () => {
    const r = parseEnvelope('```\n{"reply":"bare"}\n```');
    expect(r.ok).toBe(true);
    expect(r.reply).toBe('bare');
  });

  it('extracts the first {...} block when the model wraps JSON in prose', () => {
    const r = parseEnvelope('Sure! Here you go:\n{"reply":"embedded","spec":null}\nLet me know.');
    expect(r.ok).toBe(true);
    expect(r.reply).toBe('embedded');
  });

  it('fails clean on non-JSON', () => {
    const r = parseEnvelope('I could not produce a graph.');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/JSON/i);
    expect(r.raw).toBe('I could not produce a graph.');
  });

  it('fails clean when reply is missing', () => {
    const r = parseEnvelope('{"spec":{"nodes":[]}}');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/reply/);
  });

  it('passes spec through untouched when present', () => {
    const spec = { intent: 'x', lane: 'ugc', nodes: [], edges: [] };
    const r = parseEnvelope(JSON.stringify({ reply: 'ok', spec }));
    expect(r.spec).toEqual(spec);
  });

  it('handles null/undefined input gracefully', () => {
    expect(parseEnvelope(null).ok).toBe(false);
    expect(parseEnvelope(undefined).ok).toBe(false);
  });

  it('extracts a balanced block even with trailing prose braces', () => {
    const r = parseEnvelope('Result:\n{"reply":"ok","spec":{"nodes":[]}}\nNote: {context}.');
    expect(r.ok).toBe(true);
    expect(r.reply).toBe('ok');
    expect(r.spec).toEqual({ nodes: [] });
  });

  it('rejects whitespace-only reply', () => {
    expect(parseEnvelope('{"reply":"   "}').ok).toBe(false);
  });

  it('handles \\r\\n fenced responses', () => {
    const r = parseEnvelope('```json\r\n{"reply":"crlf"}\r\n```');
    expect(r.ok).toBe(true);
    expect(r.reply).toBe('crlf');
  });
});

import { describe, it, expect } from 'vitest';
import { extractBreadstickMeta, extractPostIds, buildPostMeta } from './postizMeta.js';

describe('extractBreadstickMeta', () => {
  it('strips the breadstick sideband from the forwarded body', () => {
    const body = { type: 'draft', posts: [], breadstick: { lane: 'tiktok-shop', angle: 'shop-demo-first' } };
    const { forwardBody, sideband } = extractBreadstickMeta(body);
    expect(forwardBody).not.toHaveProperty('breadstick');
    expect(forwardBody.type).toBe('draft');
    expect(sideband.lane).toBe('tiktok-shop');
  });

  it('tolerates a missing or malformed sideband', () => {
    expect(extractBreadstickMeta({ type: 'now' }).sideband).toEqual({});
    expect(extractBreadstickMeta({ breadstick: 'nope' }).sideband).toEqual({});
    expect(extractBreadstickMeta(undefined).sideband).toEqual({});
  });
});

describe('extractPostIds', () => {
  it('collects ids from array responses', () => {
    expect(extractPostIds([{ id: 'a1' }, { id: 'b2' }])).toEqual(['a1', 'b2']);
  });

  it('collects postId keys — the real /posts schedule response shape', () => {
    expect(extractPostIds([{ postId: 'cmq9ke8zw02rd', integration: 'cmoojhfm004ch' }])).toEqual(['cmq9ke8zw02rd']);
  });

  it('collects ids from nested posts and dedupes', () => {
    const res = { id: 'root', posts: [{ id: 'p1' }, { id: 'p1' }] };
    expect(extractPostIds(res)).toEqual(['root', 'p1']);
  });

  it('returns empty for scalar or null payloads', () => {
    expect(extractPostIds(null)).toEqual([]);
    expect(extractPostIds('error text')).toEqual([]);
  });

  it('extracts from a single non-array {postId} object', () => {
    expect(extractPostIds({ postId: 'cmq9solo', integration: 'int-1' })).toEqual(['cmq9solo']);
  });

  it('coerces numeric ids to strings', () => {
    expect(extractPostIds([{ postId: 123 }, { id: 456 }])).toEqual(['123', '456']);
  });

  it('reaches ids nested under a `post` container key', () => {
    expect(extractPostIds({ post: { id: 'deep-1' } })).toEqual(['deep-1']);
  });

  it('returns empty for the 2xx empty-array response', () => {
    // Live-fired 2026-06-11T14:00:03Z: Postiz created cmq9ke8zw02rdk30yj5chapou
    // but answered the schedule call with no ids — its createPost service has a
    // literal `return []` branch on success (posts.service.ts). Parsing cannot
    // recover an id from an empty body; buildPostMeta flags it instead.
    expect(extractPostIds([])).toEqual([]);
  });
});

describe('buildPostMeta', () => {
  it('folds lane, angle, integrations and post ids into ledger meta', () => {
    const body = { type: 'draft', posts: [{ integration: { id: 'int-x' }, value: [] }] };
    const meta = buildPostMeta({ lane: 'pov', angle: 'pov-build-along' }, body, [{ id: 'post-9' }]);
    expect(meta).toMatchObject({
      lane: 'pov',
      angle: 'pov-build-along',
      postType: 'draft',
      integrations: ['int-x'],
      postizPostIds: ['post-9'],
    });
  });

  it('defaults untagged lanes so old callers keep working', () => {
    const meta = buildPostMeta({}, { type: 'now', posts: [] }, {});
    expect(meta.lane).toBe('untagged');
    expect(meta.angle).toBe('untagged');
  });
});

describe('buildPostMeta — POSTIZ_ID_MISSING', () => {
  it('flags the ledger event loudly when the response carried no ids', () => {
    const meta = buildPostMeta({ lane: 'tiktok-shop' }, { type: 'draft', posts: [] }, []);
    expect(meta.postizPostIds).toEqual([]);
    expect(meta.note).toBe('POSTIZ_ID_MISSING');
    expect(meta.rawResponse).toBe('[]');
  });

  it('keeps the caller note alongside the marker', () => {
    const meta = buildPostMeta({ note: 'phase-1 smoke' }, { type: 'draft', posts: [] }, []);
    expect(meta.note).toBe('POSTIZ_ID_MISSING — phase-1 smoke');
  });

  it('captures non-JSON rawText bodies for forensics', () => {
    const meta = buildPostMeta({}, { type: 'now', posts: [] }, { rawText: 'Created' });
    expect(meta.note).toBe('POSTIZ_ID_MISSING');
    expect(meta.rawResponse).toContain('Created');
  });

  it('caps the captured raw response so ledger lines stay sane', () => {
    const meta = buildPostMeta({}, { type: 'now', posts: [] }, { blob: 'x'.repeat(5000) });
    expect(meta.rawResponse.length).toBeLessThanOrEqual(2000);
  });

  it('adds no forensic fields when ids extracted fine', () => {
    const meta = buildPostMeta({ note: 'phase-1 smoke' }, { type: 'draft', posts: [] }, [{ postId: 'ok-1' }]);
    expect(meta.note).toBe('phase-1 smoke');
    expect(meta).not.toHaveProperty('rawResponse');
    expect(meta.postizPostIds).toEqual(['ok-1']);
  });
});

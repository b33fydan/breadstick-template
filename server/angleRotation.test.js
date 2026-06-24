import { describe, it, expect } from 'vitest';
import { rotateAngles } from './angleRotation.js';

const ANGLES = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const post = (angle, metricValue) => ({ angle, metricValue });

describe('rotateAngles', () => {
  it('stays in exploration (equal shares) until every arm has enough measured posts', () => {
    const out = rotateAngles({
      angles: ANGLES,
      posts: [post('a', 10), post('a', 12), post('a', 9), post('b', 5)],
      minPostsPerAngle: 3,
    });
    expect(out.decided).toBe(false);
    expect(out.shares).toEqual({ a: 0.33, b: 0.33, c: 0.33 });
    expect(out.reason).toContain('b has 1/3');
    expect(out.reason).toContain('c has 0/3');
  });

  it('promotes the best mean to leaderShare once all arms qualify', () => {
    const posts = [
      post('a', 10), post('a', 10), post('a', 10),
      post('b', 30), post('b', 30), post('b', 30),
      post('c', 20), post('c', 20), post('c', 20),
    ];
    const out = rotateAngles({ angles: ANGLES, posts, minPostsPerAngle: 3, leaderShare: 0.6 });
    expect(out.decided).toBe(true);
    expect(out.leader).toBe('b');
    expect(out.shares).toEqual({ a: 0.2, b: 0.6, c: 0.2 });
  });

  it('ignores posts without a finite metric value', () => {
    const posts = [post('a', 10), { angle: 'a' }, { angle: 'a', metricValue: NaN }];
    const out = rotateAngles({ angles: [{ id: 'a' }], posts, minPostsPerAngle: 3 });
    expect(out.decided).toBe(false);
    expect(out.table[0].posts).toBe(1);
  });

  it('breaks ties deterministically (alphabetical id wins)', () => {
    const posts = [
      post('a', 20), post('a', 20), post('a', 20),
      post('b', 20), post('b', 20), post('b', 20),
      post('c', 20), post('c', 20), post('c', 20),
    ];
    const out = rotateAngles({ angles: ANGLES, posts, minPostsPerAngle: 3 });
    expect(out.decided).toBe(true);
    expect(out.leader).toBe('a');
  });

  it('handles an empty angle bank without throwing', () => {
    const out = rotateAngles({ angles: [], posts: [] });
    expect(out.decided).toBe(false);
    expect(out.reason).toContain('no angles');
  });
});

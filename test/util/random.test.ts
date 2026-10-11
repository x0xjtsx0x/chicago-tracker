import { describe, it, expect } from 'vitest';
import { randomToken, randomTopic } from '../../src/server/util/random.js';

describe('random', () => {
  it('tokens are base64url with ≥ 128 bits', () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length * 6).toBeGreaterThanOrEqual(128);
  });
  it('default ntfy topics are ct- plus ≥ 26 base32 chars (≥ 128 bits) and unique', () => {
    const a = randomTopic(), b = randomTopic();
    expect(a).toMatch(/^ct-[a-z2-7]{26,}$/);
    expect((a.length - 3) * 5).toBeGreaterThanOrEqual(128);
    expect(a).not.toBe(b);
  });
});

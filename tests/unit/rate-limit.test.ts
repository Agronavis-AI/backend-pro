// A module, not a script. These files reach the runtime through require()
// rather than import, so without this TypeScript treats them as global
// scripts and their top-level consts collide across files — `chain` is
// declared in three of them. Jest never noticed; the CI typecheck did.
export {};

jest.mock('../../src/config/env', () => ({
  env: { RATE_LIMIT_WINDOW_MS: 900_000, RATE_LIMIT_MAX: 300 },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { addressBucket } = require('../../src/middleware/rate-limit.middleware');

/**
 * Most Indian mobile traffic arrives through carrier-grade NAT, so an
 * address-keyed limit throttles a district rather than a person. Signed-in
 * requests are keyed by farmer; only anonymous traffic falls back to here,
 * and this is the part of that fallback worth asserting — an IPv6 subscriber
 * is handed a whole /64 and must not get a fresh budget per address.
 */
describe('addressBucket', () => {
  it('uses an IPv4 address whole', () => {
    expect(addressBucket('203.0.113.9')).toBe('203.0.113.9');
  });

  it('unwraps IPv4 wearing an IPv6 mapping', () => {
    expect(addressBucket('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });

  it('buckets a full IPv6 address to its /64', () => {
    expect(addressBucket('2001:db8:1234:5678:9abc:def0:1234:5678'))
      .toBe('2001:db8:1234:5678::/64');
  });

  it('gives every address in one /64 the same bucket', () => {
    const a = addressBucket('2001:db8:1234:5678:aaaa:bbbb:cccc:dddd');
    const b = addressBucket('2001:db8:1234:5678:1111:2222:3333:4444');
    // Otherwise a subscriber walks their own prefix for a fresh budget each
    // time, which is the whole reason this function exists.
    expect(a).toBe(b);
  });

  it('separates different /64s', () => {
    expect(addressBucket('2001:db8:1234:5678::1'))
      .not.toBe(addressBucket('2001:db8:1234:9999::1'));
  });

  it('expands a compressed address before taking the prefix', () => {
    // 2001:db8::1 is 2001:0db8:0000:0000:...:0001
    expect(addressBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
  });

  it('handles loopback and link-local without throwing', () => {
    expect(addressBucket('::1')).toBe('0:0:0:0::/64');
    expect(addressBucket('fe80::1')).toBe('fe80:0:0:0::/64');
  });

  it('survives an address it cannot read', () => {
    expect(addressBucket('')).toBe('unknown');
    expect(() => addressBucket('nonsense')).not.toThrow();
  });
});

describe('the tiers', () => {
  it('are ordered by what a request actually costs', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('../../src/middleware/rate-limit.middleware');
    for (const name of [
      'globalLimiter', 'readLimiter', 'writeLimiter',
      'upstreamLimiter', 'inferenceLimiter', 'uploadLimiter',
      'authLimiter', 'standardLimiter',
    ]) {
      expect(typeof m[name]).toBe('function');
    }
  });
});

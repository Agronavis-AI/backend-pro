import axios from 'axios';

/**
 * The one way this feature can genuinely hurt someone is by saying a field is
 * clear when it has not actually looked.
 *
 * A farmer who reads "nothing burning nearby" does not go outside to check.
 * So every path that can produce an empty list — no key, a rejected key, a
 * timeout, a database error — is asserted here to report that it could not
 * answer, rather than to report zero. Each of these was a real bug: `near()`
 * returned `[]` for all four.
 */

jest.mock('axios');
jest.mock('../../src/config/env', () => ({
  env: { FIRMS_MAP_KEY: 'test-key', SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' },
}));

const chain = {
  select: jest.fn().mockReturnThis(),
  gte: jest.fn().mockReturnThis(),
  lte: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  limit: jest.fn(),
  upsert: jest.fn().mockResolvedValue({ error: null }),
};
jest.mock('../../src/config/supabase', () => ({
  db: { from: jest.fn(() => chain) },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { env } = require('../../src/config/env') as { env: { FIRMS_MAP_KEY: string | undefined } };
/* eslint-disable @typescript-eslint/no-require-imports */
const {
  firesService,
  MAX_DAY_RANGE,
  __resetFireCaches,
} = require('../../src/modules/fires/fires.service');
/* eslint-enable @typescript-eslint/no-require-imports */

const mockedAxios = axios as jest.Mocked<typeof axios>;

/** A real FIRMS response. Note there is no country_id column. */
const CSV = [
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
  '30.91,75.84,331.2,0.4,0.36,2026-10-15,1955,N,VIIRS,n,2.0NRT,285.1,1.2,N',
  '30.95,75.90,352.7,0.4,0.36,2026-10-15,1956,N,VIIRS,h,2.0NRT,290.3,4.8,N',
].join('\n');

beforeEach(() => {
  jest.clearAllMocks();
  // A cold service each time: otherwise a test is answered from the cache the
  // previous one filled, and never exercises the path it is testing.
  __resetFireCaches();
  env.FIRMS_MAP_KEY = 'test-key';
  chain.select.mockReturnThis();
  chain.gte.mockReturnThis();
  chain.lte.mockReturnThis();
  chain.order.mockReturnThis();
  chain.limit.mockResolvedValue({ data: [], error: null });
  chain.upsert.mockResolvedValue({ error: null });
});

describe('near() never reports an all-clear it has not earned', () => {
  it('reports unavailable when no key is configured', async () => {
    env.FIRMS_MAP_KEY = undefined;
    const result = await firesService.near(30.9, 75.85, 60, 1);

    expect(result.available).toBe(false);
    expect(result.reason).toBe('not_configured');
    expect(result.fires).toEqual([]);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('reports unavailable when FIRMS rejects the key', async () => {
    mockedAxios.get.mockResolvedValue({ data: 'Invalid MAP_KEY.' });
    const result = await firesService.near(30.9, 75.85, 60, 1);

    expect(result.available).toBe(false);
    expect(result.reason).toBe('rejected');
    expect(result.fires).toEqual([]);
  });

  it('reports unavailable when the request fails', async () => {
    mockedAxios.get.mockRejectedValue(new Error('ETIMEDOUT'));
    const result = await firesService.near(30.9, 75.85, 60, 1);

    expect(result.available).toBe(false);
    expect(result.reason).toBe('unreachable');
    expect(result.fires).toEqual([]);
  });

  it('retries a connection failure and succeeds on the second try', async () => {
    // Exactly what production threw: NASA's host unreachable for a moment.
    const timeout = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    mockedAxios.get.mockRejectedValueOnce(timeout).mockResolvedValueOnce({ data: CSV });

    const result = await firesService.near(30.9, 75.85, 60, 1);

    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(result.available).toBe(true);
    expect(result.fires).toHaveLength(2);
  });

  it('does not retry a rejection that will fail the same way again', async () => {
    const refused = Object.assign(new Error('bad request'), { code: 'ERR_BAD_REQUEST' });
    mockedAxios.get.mockRejectedValue(refused);

    await firesService.near(30.9, 75.85, 60, 1);

    // A bad key or an invalid day range is not worth asking twice.
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable when the body is not text', async () => {
    mockedAxios.get.mockResolvedValue({ data: { error: 'nope' } });
    const result = await firesService.near(30.9, 75.85, 60, 1);

    expect(result.available).toBe(false);
    expect(result.fires).toEqual([]);
  });

  it('distinguishes a genuine zero from a failure', async () => {
    // Header only: the service answered, and the answer is none.
    mockedAxios.get.mockResolvedValue({ data: CSV.split('\n')[0] });
    const result = await firesService.near(30.9, 75.85, 60, 1);

    expect(result.available).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.fires).toEqual([]);
  });

  it('returns the detections when they are there', async () => {
    mockedAxios.get.mockResolvedValue({ data: CSV });
    const result = await firesService.near(30.9, 75.85, 60, 1);

    expect(result.available).toBe(true);
    expect(result.fires).toHaveLength(2);
    expect(result.fires[0]).toMatchObject({ latitude: 30.91, longitude: 75.84 });
  });

  it('drops detections inside the box but outside the circle', async () => {
    mockedAxios.get.mockResolvedValue({ data: CSV });
    // 1 km radius: both rows are in the bounding box, neither within 1 km.
    const result = await firesService.near(30.0, 75.0, 1, 1);

    expect(result.available).toBe(true);
    expect(result.fires).toEqual([]);
  });

  it('never asks FIRMS for more days than it will answer', async () => {
    mockedAxios.get.mockResolvedValue({ data: CSV });
    await firesService.near(30.9, 75.85, 60, 180);

    const url = mockedAxios.get.mock.calls[0]![0] as string;
    expect(url.endsWith(`/${MAX_DAY_RANGE}`)).toBe(true);
  });
});

describe('a long history still shows the fires happening now', () => {
  /**
   * The dashboard card asks for two days and the fires screen asks for six
   * months. They were answered by different code paths, so the card warned
   * "1 fire upwind, 18 km away" while the screen underneath it said "nothing
   * burning within 150 km" — the long request skipped the live fetch
   * entirely and read only a store that had not been backfilled yet.
   */
  it('caps the live request rather than skipping it', async () => {
    mockedAxios.get.mockResolvedValue({ data: CSV });
    await firesService.near(30.9, 75.85, 150, 180);

    expect(mockedAxios.get).toHaveBeenCalled();
    const url = mockedAxios.get.mock.calls[0]![0] as string;
    expect(url.endsWith(`/${MAX_DAY_RANGE}`)).toBe(true);
  });

  it('never sends a day range FIRMS rejects', async () => {
    mockedAxios.get.mockResolvedValue({ data: CSV });

    // 7 was the old clamp, and FIRMS answers it with "Invalid day range.
    // Expects [1..5]" — which parsed to zero fires and read as an all-clear.
    for (const requested of [1, 2, 3, 5, 7, 30, 180]) {
      mockedAxios.get.mockClear();
      // Cold each time: 7, 30 and 180 all cap to the same five-day window, so
      // the cache would answer them and no request would be made to inspect.
      __resetFireCaches();
      await firesService.near(30.9, 75.85, 150, requested);
      const range = Number((mockedAxios.get.mock.calls[0]![0] as string).split('/').pop());
      expect(range).toBeGreaterThanOrEqual(1);
      expect(range).toBeLessThanOrEqual(MAX_DAY_RANGE);
    }
  });
});

describe('stored() — the fallback that stands in for a failed request', () => {
  it('returns nothing and no timestamp when the store errors', async () => {
    chain.limit.mockResolvedValue({ data: null, error: { message: 'down' } });
    const result = await firesService.stored(30.9, 75.85, 60, 180);

    expect(result.fires).toEqual([]);
    expect(result.lastUpdated).toBeNull();
  });

  it('returns nothing and no timestamp when the store is empty', async () => {
    chain.limit.mockResolvedValue({ data: [], error: null });
    const result = await firesService.stored(30.9, 75.85, 60, 180);

    expect(result.fires).toEqual([]);
    expect(result.lastUpdated).toBeNull();
  });

  it('maps a stored row back into a detection, newest first', async () => {
    chain.limit.mockResolvedValue({
      data: [
        { latitude: 30.91, longitude: 75.84, brightness_k: 331, confidence: 'n', acquired_at: '2026-10-15T19:55:00Z' },
      ],
      error: null,
    });
    const result = await firesService.stored(30.9, 75.85, 60, 180);

    expect(result.fires).toHaveLength(1);
    expect(result.fires[0]).toMatchObject({
      latitude: 30.91,
      brightnessK: 331,
      acquiredDate: '2026-10-15',
      acquiredTime: '1955',
    });
    expect(result.lastUpdated).toBe('2026-10-15T19:55:00Z');
  });

  it('applies the circle to stored rows as well as fetched ones', async () => {
    chain.limit.mockResolvedValue({
      data: [
        { latitude: 40.0, longitude: 85.0, brightness_k: 0, confidence: null, acquired_at: '2026-10-15T00:00:00Z' },
      ],
      error: null,
    });
    const result = await firesService.stored(30.9, 75.85, 60, 180);

    expect(result.fires).toEqual([]);
    // The row existed, so there is still a last-updated time to report.
    expect(result.lastUpdated).toBe('2026-10-15T00:00:00Z');
  });

  it('asks the store for a box that widens as latitude rises', async () => {
    chain.limit.mockResolvedValue({ data: [], error: null });
    await firesService.stored(60, 10, 111, 30);

    // At 60°N a degree of longitude is half a degree of latitude's distance,
    // so the longitude half-width must be about twice the latitude one.
    const lats = chain.gte.mock.calls.find((c) => c[0] === 'latitude')!;
    const lons = chain.gte.mock.calls.find((c) => c[0] === 'longitude')!;
    expect(60 - (lats[1] as number)).toBeCloseTo(1, 1);
    expect(10 - (lons[1] as number)).toBeCloseTo(2, 0);
  });
});

describe('summary() — a country that cannot be reached is not an empty country', () => {
  it('marks every region unavailable when there is no key', async () => {
    env.FIRMS_MAP_KEY = undefined;
    const result = await firesService.summary(1);

    expect(result.totalFires).toBe(0);
    expect(result.unavailable.length).toBeGreaterThan(0);
    expect(result.regions).toEqual([]);
  });

  it('answers a second time from cache without asking FIRMS again', async () => {
    mockedAxios.get.mockResolvedValue({ data: CSV });
    await firesService.summary(2);
    const callsAfterFirst = mockedAxios.get.mock.calls.length;

    await firesService.summary(2);
    expect(mockedAxios.get.mock.calls.length).toBe(callsAfterFirst);
  });

  it('serves the last good picture, marked stale, when every region fails', async () => {
    const realNow = Date.now;
    let clock = realNow();
    jest.spyOn(Date, 'now').mockImplementation(() => clock);

    try {
      // One good run fills the fallback.
      mockedAxios.get.mockResolvedValue({ data: CSV });
      const good = await firesService.summary(4);
      expect(good.totalFires).toBeGreaterThan(0);
      expect(good.stale).toBe(false);

      // Past the half-hour TTL, so the cache misses and FIRMS is asked again.
      clock += 31 * 60_000;
      mockedAxios.get.mockRejectedValue(new Error('ETIMEDOUT'));
      const stale = await firesService.summary(4);

      // Served from the earlier run rather than reported as a clear country.
      expect(stale.stale).toBe(true);
      expect(stale.totalFires).toBe(good.totalFires);
      expect(stale.regions).toEqual(good.regions);
      expect(stale.fetchedAt).toEqual(expect.any(String));
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }
  });

  it('counts a region that fails as unavailable, not as zero', async () => {
    const realNow = Date.now;
    let clock = realNow();
    jest.spyOn(Date, 'now').mockImplementation(() => clock);

    try {
      // Every region answers except the first, which times out.
      mockedAxios.get.mockImplementation((url: unknown) =>
        String(url).includes('73.8')
          ? Promise.reject(new Error('ETIMEDOUT'))
          : Promise.resolve({ data: CSV }),
      );

      clock += 61 * 60_000;
      const result = await firesService.summary(6);

      expect(result.unavailable.length).toBeGreaterThan(0);
      expect(result.stale).toBe(false);
      // The failed region contributes nothing to the total rather than a zero
      // that would read as "nothing burning there".
      expect(result.regions.every((r: { region: string }) =>
        !result.unavailable.includes(r.region))).toBe(true);
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }
  });
});

describe('backfill() — real history, never invented', () => {
  it('does nothing without a key', async () => {
    env.FIRMS_MAP_KEY = undefined;
    const result = await firesService.backfill(30.9, 75.85, 60, 180);

    expect(result).toEqual({ windows: 0, fetched: 0, stored: 0 });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('walks six months in windows FIRMS will actually answer', async () => {
    mockedAxios.get.mockResolvedValue({ data: CSV.split('\n')[0] });
    const result = await firesService.backfill(30.9, 75.85, 60, 180);

    expect(result.windows).toBe(180 / MAX_DAY_RANGE);
    for (const call of mockedAxios.get.mock.calls) {
      const url = call[0] as string;
      // .../{box}/{dayRange}/{startDate}
      expect(url).toMatch(new RegExp(`/${MAX_DAY_RANGE}/\\d{4}-\\d{2}-\\d{2}$`));
    }
  });

  it('falls back to the archive source when near real time has nothing', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: CSV.split('\n')[0] }) // NRT: header only
      .mockResolvedValue({ data: CSV }); // SP: rows

    await firesService.backfill(30.9, 75.85, 60, MAX_DAY_RANGE);

    const sources = mockedAxios.get.mock.calls.map((c) => String(c[0]));
    expect(sources[0]).toContain('VIIRS_SNPP_NRT');
    expect(sources[1]).toContain('VIIRS_SNPP_SP');
  });

  it('stores nothing when a window comes back empty', async () => {
    mockedAxios.get.mockResolvedValue({ data: CSV.split('\n')[0] });
    const result = await firesService.backfill(30.9, 75.85, 60, MAX_DAY_RANGE);

    expect(result.fetched).toBe(0);
    expect(result.stored).toBe(0);
    expect(chain.upsert).not.toHaveBeenCalled();
  });

  it('counts a window as fetched but not stored when the write fails', async () => {
    mockedAxios.get.mockResolvedValue({ data: CSV });
    chain.upsert.mockResolvedValue({ error: { message: 'constraint' } });

    const result = await firesService.backfill(30.9, 75.85, 60, MAX_DAY_RANGE);

    expect(result.fetched).toBe(2);
    expect(result.stored).toBe(0);
  });

  it('writes rows that can be de-duplicated against the poller', async () => {
    mockedAxios.get.mockResolvedValue({ data: CSV });
    await firesService.backfill(30.9, 75.85, 60, MAX_DAY_RANGE);

    const [rows, options] = chain.upsert.mock.calls[0]!;
    expect(options).toMatchObject({
      onConflict: 'latitude,longitude,acquired_at,source',
      ignoreDuplicates: true,
    });
    expect((rows as { acquired_at: string }[])[0]!.acquired_at).toBe('2026-10-15T19:55:00.000Z');
  });
});

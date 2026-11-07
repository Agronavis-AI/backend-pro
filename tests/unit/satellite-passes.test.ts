import axios from 'axios';

/**
 * The farm monitoring screen tells a farmer when a satellite last saw their
 * field. The rule it has to keep is the one the fire feature taught us: a
 * catalogue that cannot be reached must never read as "the satellite has
 * never been over", because that is the one statement that is certainly
 * false.
 */
jest.mock('axios');
jest.mock('../../src/config/env', () => ({ env: {} }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { satelliteService, CLEAR_CLOUD_MAX } = require('../../src/modules/satellite/satellite.service');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const scene = (date: string, cloud: number) => ({
  properties: { datetime: `${date}T04:52:00Z`, 'eo:cloud_cover': cloud },
  assets: { thumbnail: { href: `https://example.invalid/${date}.jpg` } },
});

beforeEach(() => jest.clearAllMocks());

// Each test uses its own coordinates: the service caches by position, and a
// shared one would be answered from the previous test's result.
let n = 0;
const where = () => [22.7 + 0.001 * n++, 88.37] as const;

describe('passes', () => {
  it('reports the newest clear pass, not merely the newest', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { features: [scene('2026-10-15', 73), scene('2026-10-10', 3)] },
    });

    const [lat, lon] = where();
    const report = await satelliteService.passesFor(lat, lon, 30);

    expect(report.available).toBe(true);
    expect(report.passes[0]!.date).toBe('2026-10-15');
    // The newest pass saw nothing but cloud, so it is not the last clear one.
    expect(report.lastClear!.date).toBe('2026-10-10');
  });

  it('orders passes newest first whatever order they arrive in', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { features: [scene('2026-09-27', 5), scene('2026-10-15', 5), scene('2026-10-05', 5)] },
    });

    const [lat, lon] = where();
    const { passes } = await satelliteService.passesFor(lat, lon, 30);
    expect(passes.map((p: { date: string }) => p.date)).toEqual(
      ['2026-10-15', '2026-10-05', '2026-09-27'],
    );
  });

  it.each([
    [0, true],
    [CLEAR_CLOUD_MAX, true],
    [CLEAR_CLOUD_MAX + 0.1, false],
    [100, false],
  ])('calls %s%% cloud clear=%s, including at the boundary', async (cloud, clear) => {
    mockedAxios.post.mockResolvedValue({ data: { features: [scene('2026-10-15', cloud as number)] } });

    const [lat, lon] = where();
    const { passes } = await satelliteService.passesFor(lat, lon, 30);
    expect(passes[0]!.clear).toBe(clear);
  });

  it('treats a scene with no cloud figure as unusable rather than perfect', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { features: [{ properties: { datetime: '2026-10-15T04:52:00Z' } }] },
    });

    const [lat, lon] = where();
    const { passes, lastClear } = await satelliteService.passesFor(lat, lon, 30);
    expect(passes[0]!.cloudPercent).toBe(100);
    expect(lastClear).toBeNull();
  });

  it('says when to look again, a revisit after the last pass', async () => {
    mockedAxios.post.mockResolvedValue({ data: { features: [scene('2026-10-15', 3)] } });

    const [lat, lon] = where();
    const { nextExpected } = await satelliteService.passesFor(lat, lon, 30);
    expect(nextExpected).toBe('2026-10-20');
  });

  it('reports no clear pass when every one was clouded out', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { features: [scene('2026-10-15', 73), scene('2026-10-10', 88)] },
    });

    const [lat, lon] = where();
    const report = await satelliteService.passesFor(lat, lon, 30);
    expect(report.available).toBe(true);
    expect(report.passes).toHaveLength(2);
    expect(report.lastClear).toBeNull();
  });

  // ── The rule from the fire feature ────────────────────────────────────
  it('reports unavailable when the catalogue cannot be reached', async () => {
    mockedAxios.post.mockRejectedValue(new Error('ETIMEDOUT'));

    const [lat, lon] = where();
    const report = await satelliteService.passesFor(lat, lon, 30);

    expect(report.available).toBe(false);
    expect(report.passes).toEqual([]);
    expect(report.lastClear).toBeNull();
  });

  it('serves the earlier answer when a later request fails', async () => {
    const [lat, lon] = where();

    mockedAxios.post.mockResolvedValue({ data: { features: [scene('2026-10-15', 3)] } });
    await satelliteService.passesFor(lat, lon, 30);

    mockedAxios.post.mockRejectedValue(new Error('ETIMEDOUT'));
    const again = await satelliteService.passesFor(lat, lon, 30);

    // Cached, so still available and still carrying the real pass.
    expect(again.available).toBe(true);
    expect(again.lastClear!.date).toBe('2026-10-15');
  });

  it('handles a catalogue that returns nothing at all', async () => {
    mockedAxios.post.mockResolvedValue({ data: {} });

    const [lat, lon] = where();
    const report = await satelliteService.passesFor(lat, lon, 30);
    expect(report.available).toBe(true);
    expect(report.passes).toEqual([]);
    expect(report.nextExpected).toBeNull();
  });
});

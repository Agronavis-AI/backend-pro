// A module, not a script. These files reach the runtime through require()
// rather than import, so without this TypeScript treats them as global
// scripts and their top-level consts collide across files — `chain` is
// declared in three of them. Jest never noticed; the CI typecheck did.
export {};

/**
 * NDVI is the number a farmer would act on — a fall between passes is meant to
 * send them out to walk the field. So the arithmetic is pinned, and so is the
 * rule every remote-data feature here follows: unreachable must never render
 * as a reading.
 */
jest.mock('axios');
jest.mock('../../src/config/env', () => ({ env: {} }));

const chain = {
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  not: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  limit: jest.fn(),
};
jest.mock('../../src/config/supabase', () => ({ db: { from: jest.fn(() => chain) } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ndviService } = require('../../src/modules/satellite/ndvi.service');

const row = (date: string, ndvi: number, cloud = 3) => ({
  captured_on: date, ndvi, pixels: 400, cloud_percent: cloud,
});

beforeEach(() => {
  jest.clearAllMocks();
  chain.select.mockReturnThis();
  chain.eq.mockReturnThis();
  chain.not.mockReturnThis();
  chain.order.mockReturnThis();
});

describe('stored readings', () => {
  it('asks only for readings taken with cloud masking', async () => {
    chain.limit.mockResolvedValue({ data: [], error: null });
    await ndviService.storedFor('field-1');

    // A row without a grid predates masking. One such reading averaged snow
    // and reported -0.025 for ground that reads 0.769, so none are served.
    expect(chain.not).toHaveBeenCalledWith('grid', 'is', null);
  });

  it('returns the newest reading and the change from the one before', async () => {
    chain.limit.mockResolvedValue({
      data: [row('2026-10-15', 0.273), row('2026-10-05', 0.251)],
      error: null,
    });

    const report = await ndviService.storedFor('field-1');

    expect(report.available).toBe(true);
    expect(report.latest.ndvi).toBe(0.273);
    expect(report.previous.ndvi).toBe(0.251);
    // (0.273 - 0.251) / 0.251 = 8.8%
    expect(report.change).toBeCloseTo(0.088, 3);
  });

  it('reports a fall as a negative change', async () => {
    chain.limit.mockResolvedValue({
      data: [row('2026-10-15', 0.40), row('2026-10-05', 0.50)],
      error: null,
    });

    const { change } = await ndviService.storedFor('field-1');
    expect(change).toBeCloseTo(-0.2, 3);
  });

  it('has no change to report from a single pass', async () => {
    chain.limit.mockResolvedValue({ data: [row('2026-10-15', 0.42)], error: null });

    const report = await ndviService.storedFor('field-1');
    expect(report.latest.ndvi).toBe(0.42);
    expect(report.previous).toBeNull();
    expect(report.change).toBeNull();
  });

  it('answers with an empty history for a field never measured', async () => {
    chain.limit.mockResolvedValue({ data: [], error: null });

    const report = await ndviService.storedFor('field-1');
    // Answered, and the answer is "nothing yet" — not "could not look".
    expect(report.available).toBe(true);
    expect(report.latest).toBeNull();
    expect(report.history).toEqual([]);
  });

  it('reports unavailable when the store cannot be read', async () => {
    chain.limit.mockResolvedValue({ data: null, error: { message: 'down' } });

    const report = await ndviService.storedFor('field-1');
    expect(report.available).toBe(false);
    expect(report.latest).toBeNull();
  });

  it('keeps the history newest first for a chart', async () => {
    chain.limit.mockResolvedValue({
      data: [row('2026-10-15', 0.3), row('2026-10-05', 0.25), row('2026-09-25', 0.2)],
      error: null,
    });

    const { history } = await ndviService.storedFor('field-1');
    expect(history.map((h: { date: string }) => h.date)).toEqual(
      ['2026-10-15', '2026-10-05', '2026-09-25'],
    );
  });

  it('survives a reading with no cloud figure recorded', async () => {
    chain.limit.mockResolvedValue({
      data: [{ captured_on: '2026-10-15', ndvi: 0.3, pixels: 400, cloud_percent: null }],
      error: null,
    });

    const { latest } = await ndviService.storedFor('field-1');
    expect(latest.cloudPercent).toBe(0);
  });
});

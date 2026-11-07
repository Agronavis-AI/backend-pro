import type { SolarDay } from '@agronavis/shared-types';
import {
  buildIrrigationAdvisory,
  latestRootWetness,
} from '../../src/modules/advisory/advisory.service';

/**
 * The water balance is a model and only knows the rain POWER recorded. It
 * cannot see a canal turn, a pump run, or a shower the satellite missed, so on
 * its own it will confidently send a farmer to water an already-wet field.
 * These pin the measurement's right to contradict it — and, just as important,
 * that it never withholds advice when it has nothing to say.
 */
const day = (date: string, root: number | null): SolarDay =>
  ({
    date,
    solarRadiation: 20,
    et0: 5,
    precipitation: 0,
    temperatureMax: 32,
    temperatureMin: 18,
    humidity: 60,
    windSpeed2m: 2,
    soilWetnessSurface: null,
    soilWetnessRoot: root,
    substituted: [],
  }) as SolarDay;

describe('latestRootWetness', () => {
  it('takes the most recent day that has a reading', () => {
    expect(
      latestRootWetness([day('2026-10-06', 0.3), day('2026-10-07', 0.42)]),
    ).toEqual({ value: 0.42, date: '2026-10-07' });
  });

  it('skips days POWER left out rather than reading past them', () => {
    expect(
      latestRootWetness([day('2026-10-06', 0.31), day('2026-10-07', null)]),
    ).toEqual({ value: 0.31, date: '2026-10-06' });
  });

  it('is null when no day carries one', () => {
    expect(latestRootWetness([day('2026-10-07', null)])).toBeNull();
  });

  it('is null for no data at all', () => {
    expect(latestRootWetness([])).toBeNull();
  });
});

describe('irrigation advice against a measured root zone', () => {
  it('refuses to send a farmer to water a wet field', () => {
    const a = buildIrrigationAdvisory(12, { value: 0.62, date: '2026-10-08' });
    expect(a?.title).toBe('Check before you irrigate');
    expect(a?.severity).toBe('low');
    expect(a?.metadata).toMatchObject({ conflict: true });
    expect(a?.body).toContain('62%');
    expect(a?.body).toContain('2026-10-08');
  });

  it('still says irrigate when the measurement agrees, and says that it does', () => {
    const a = buildIrrigationAdvisory(21, { value: 0.18, date: '2026-10-08' });
    expect(a?.title).toBe('Irrigate today');
    expect(a?.body).toContain('agrees');
    expect(a?.metadata).not.toMatchObject({ conflict: true });
  });

  it('behaves exactly as before when there is no reading', () => {
    // Under a frozen clock. An advisory carries validUntil, which is computed
    // from Date.now(), so two calls that straddle a millisecond are unequal
    // for a reason that has nothing to do with what is being asserted — this
    // passed locally and failed on a slower runner.
    jest.useFakeTimers().setSystemTime(new Date('2026-10-15T06:00:00.000Z'));
    try {
      const without = buildIrrigationAdvisory(21, null);
      expect(without?.title).toBe('Irrigate today');
      expect(without?.body).not.toContain('agrees');
      expect(buildIrrigationAdvisory(21)).toEqual(without);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not let a wet root zone invent advice where there was none', () => {
    // Under the 4 mm floor the balance stays quiet; a wet reading agrees with
    // staying quiet and must not turn that into a notification.
    expect(buildIrrigationAdvisory(2, { value: 0.7, date: '2026-10-08' })).toBeNull();
  });

  it('leaves a dry reading to the thresholds it already had', () => {
    expect(buildIrrigationAdvisory(6, { value: 0.2, date: '2026-10-08' })?.title).toBe(
      'Check soil moisture',
    );
  });
});

import type { ForecastDay } from '@agronavis/shared-types';
import { dewPoint } from '../../src/modules/weather/et0';
import {
  buildDiseaseRiskAdvisory,
  leavesWetOvernight,
} from '../../src/modules/advisory/advisory.service';

/**
 * The fungal rule used to ask whether the air was humid. It now asks whether
 * the night reaches the dew point, because that is what actually wets a leaf —
 * and a wet leaf for a few hours is what a spore needs.
 *
 * The two questions disagree in both directions, and both disagreements are
 * worth catching: a muggy afternoon that never cools is not a risk, and a clear
 * night at moderate humidity very much is.
 */
const day = (o: Partial<ForecastDay>): ForecastDay => ({
  date: '2026-10-14',
  tempMin: 20,
  tempMax: 30,
  humidity: 70,
  rainMm: 0,
  windSpeed: 5,
  windFromDeg: null,
  description: '',
  icon: '01d',
  rainProbability: 0,
  ...o,
});

describe('dewPoint', () => {
  it('equals the temperature at saturation', () => {
    expect(dewPoint(20, 100)).toBeCloseTo(20, 1);
  });

  it.each([
    [20, 50, 9.3],
    [30, 85, 27.2],
    [25, 60, 16.7],
    [35, 40, 19.4],
  ])('is %i°C at %i%% → %f°C', (t, rh, expected) => {
    expect(dewPoint(t, rh)).toBeCloseTo(expected, 1);
  });

  it('never runs away on an impossible reading', () => {
    expect(Number.isFinite(dewPoint(25, 0))).toBe(true);
    expect(dewPoint(25, 200)).toBeCloseTo(25, 1);
  });

  it('rises with humidity and never exceeds the temperature', () => {
    expect(dewPoint(25, 40)).toBeLessThan(dewPoint(25, 80));
    expect(dewPoint(25, 99)).toBeLessThanOrEqual(25);
  });
});

describe('leavesWetOvernight', () => {
  it('catches a clear night that cools to the dew point at moderate humidity', () => {
    // 78% is under the old 85% threshold, but a 19°C low over a 24.5°C mean
    // puts the night within reach of the dew point. The old rule missed this.
    expect(leavesWetOvernight(day({ tempMin: 19, tempMax: 30, humidity: 78 }))).toBe(true);
  });

  it('ignores a muggy day that never cools', () => {
    // Humid by the old test, but the night stays far above the dew point, so
    // nothing condenses on the crop.
    expect(leavesWetOvernight(day({ tempMin: 29, tempMax: 41, humidity: 55 }))).toBe(false);
  });

  it('ignores a dry night', () => {
    expect(leavesWetOvernight(day({ tempMin: 18, tempMax: 34, humidity: 25 }))).toBe(false);
  });
});

describe('buildDiseaseRiskAdvisory', () => {
  const wetMild = day({ tempMin: 20, tempMax: 28, humidity: 92 });

  it('warns when two or more nights wet the leaves in the fungal band', () => {
    const a = buildDiseaseRiskAdvisory([
      { ...wetMild, date: '2026-10-14' },
      { ...wetMild, date: '2026-10-15' },
    ]);
    expect(a?.title).toBe('Fungal disease risk rising');
    expect(a?.body).toContain('dew point');
    expect(a?.metadata).toMatchObject({ riskDays: ['2026-10-14', '2026-10-15'] });
  });

  it('stays quiet for a single night', () => {
    expect(buildDiseaseRiskAdvisory([wetMild])).toBeNull();
  });

  it('stays quiet when the nights are too cold for the fungus', () => {
    const cold = day({ tempMin: 8, tempMax: 18, humidity: 95 });
    expect(buildDiseaseRiskAdvisory([cold, { ...cold, date: '2026-10-15' }])).toBeNull();
  });

  it('stays quiet when the days are too hot for the fungus', () => {
    const hot = day({ tempMin: 26, tempMax: 40, humidity: 90 });
    expect(buildDiseaseRiskAdvisory([hot, { ...hot, date: '2026-10-15' }])).toBeNull();
  });

  it('stays quiet on an empty forecast', () => {
    expect(buildDiseaseRiskAdvisory([])).toBeNull();
  });
});

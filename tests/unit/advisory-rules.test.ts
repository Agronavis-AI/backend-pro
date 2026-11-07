import type { ForecastDay } from '@agronavis/shared-types';
import {
  buildDiseaseRiskAdvisory,
  buildIrrigationAdvisory,
  buildPestAdvisory,
  buildWeatherAdvisory,
} from '../../src/modules/advisory/advisory.service';

const day = (overrides: Partial<ForecastDay>): ForecastDay => ({
  date: '2026-09-05',
  tempMin: 24,
  tempMax: 33,
  humidity: 60,
  rainMm: 0,
  windSpeed: 10,
  windFromDeg: null,
  description: 'clear sky',
  icon: '01d',
  rainProbability: 10,
  ...overrides,
});

describe('irrigation rule', () => {
  it('stays silent when the water balance is satisfied', () => {
    expect(buildIrrigationAdvisory(2)).toBeNull();
  });

  it('escalates with the size of the deficit', () => {
    expect(buildIrrigationAdvisory(6)?.severity).toBe('medium');
    expect(buildIrrigationAdvisory(14)?.severity).toBe('high');
    expect(buildIrrigationAdvisory(22)?.severity).toBe('critical');
  });

  it('keys de-duplication by day so a 30-minute poll cannot spam', () => {
    const first = buildIrrigationAdvisory(20);
    const second = buildIrrigationAdvisory(21);
    expect(first?.dedupeKey).toBe(second?.dedupeKey);
  });
});

describe('weather rule', () => {
  it('warns about heavy rain before heat or wind', () => {
    const advisory = buildWeatherAdvisory([day({ rainMm: 45, rainProbability: 90, tempMax: 43 })]);
    expect(advisory?.title).toMatch(/rain/i);
    expect(advisory?.severity).toBe('high');
  });

  it('treats extreme rainfall as critical', () => {
    expect(buildWeatherAdvisory([day({ rainMm: 70, rainProbability: 95 })])?.severity).toBe('critical');
  });

  it('returns nothing for ordinary weather', () => {
    expect(buildWeatherAdvisory([day({}), day({ date: '2026-09-06' })])).toBeNull();
  });
});

describe('disease risk rule', () => {
  it('needs at least two humid mild days', () => {
    const humid = day({ humidity: 90, tempMin: 20, tempMax: 30 });
    expect(buildDiseaseRiskAdvisory([humid])).toBeNull();
    expect(buildDiseaseRiskAdvisory([humid, { ...humid, date: '2026-09-06' }])).not.toBeNull();
  });
});

describe('pest advisory', () => {
  it('scales severity with model confidence', () => {
    expect(buildPestAdvisory('Rice Blast', 0.5).severity).toBe('medium');
    expect(buildPestAdvisory('Rice Blast', 0.7).severity).toBe('high');
    expect(buildPestAdvisory('Rice Blast', 0.92).severity).toBe('critical');
  });

  it('puts the confidence in the title the farmer reads', () => {
    expect(buildPestAdvisory('Late Blight', 0.87).title).toContain('87%');
  });
});

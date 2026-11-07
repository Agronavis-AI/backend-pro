import {
  buildIrrigationAdvisory,
  buildWeatherAdvisory,
  buildDiseaseRiskAdvisory,
} from '../../src/modules/advisory/advisory.service';
import type { ForecastDay } from '@agronavis/shared-types';

/**
 * Every advisory is stored as a notification and listed in the app. Severity
 * decides only which ones also light up the handset: the service pushes
 * critical and high and marks the rest `skipped`.
 *
 * The line matters in both directions. Push too little and the warning that
 * mattered is missed; push everything and notifications get turned off, which
 * loses the same warning by a different route. These pin where each advisory
 * sits so a future edit to the wording cannot quietly move one across it.
 */
const PUSHES = ['critical', 'high'];

const day = (o: Partial<ForecastDay>): ForecastDay => ({
  date: '2026-10-15',
  tempMin: 20,
  tempMax: 28,
  humidity: 92,
  rainMm: 0,
  windSpeed: 5,
  windFromDeg: null,
  description: '',
  icon: '01d',
  rainProbability: 0,
  ...o,
});

describe('which stored alerts are allowed to interrupt a farmer', () => {
  it('pushes a severe water shortfall', () => {
    expect(PUSHES).toContain(buildIrrigationAdvisory(21)!.severity);
  });

  it('pushes a shortfall needing action in two days', () => {
    expect(PUSHES).toContain(buildIrrigationAdvisory(12)!.severity);
  });

  it('does not push a mild shortfall worth only a check', () => {
    expect(PUSHES).not.toContain(buildIrrigationAdvisory(6)!.severity);
  });

  it('does not push when a measurement contradicts the model', () => {
    // Asking someone to go and dig is not a buzz-worthy emergency.
    const a = buildIrrigationAdvisory(12, { value: 0.7, date: '2026-10-13' });
    expect(a!.severity).toBe('low');
    expect(PUSHES).not.toContain(a!.severity);
  });

  it('pushes heavy rain, because spraying today would be wasted', () => {
    const a = buildWeatherAdvisory([day({ rainMm: 45, rainProbability: 90 })]);
    expect(PUSHES).toContain(a!.severity);
  });

  it('pushes extreme heat', () => {
    const a = buildWeatherAdvisory([day({ tempMax: 46, tempMin: 30 })]);
    expect(PUSHES).toContain(a!.severity);
  });

  it('does not push high wind, which is a caution rather than an emergency', () => {
    const a = buildWeatherAdvisory([day({ windSpeed: 50 })]);
    expect(a!.severity).toBe('medium');
    expect(PUSHES).not.toContain(a!.severity);
  });

  it('does not push fungal risk — it is days away, not hours', () => {
    const wet = day({ tempMin: 20, tempMax: 28, humidity: 92 });
    const a = buildDiseaseRiskAdvisory([wet, { ...wet, date: '2026-10-16' }]);
    expect(a!.severity).toBe('medium');
    expect(PUSHES).not.toContain(a!.severity);
  });
});

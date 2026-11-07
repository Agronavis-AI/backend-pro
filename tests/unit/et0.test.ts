import { extraterrestrialRadiation, referenceEt0 } from '../../src/modules/weather/et0';

/**
 * Reference values come from FAO Irrigation & Drainage Paper 56. If these drift,
 * every irrigation advisory the platform sends has drifted with them.
 */
describe('FAO-56 reference evapotranspiration', () => {
  it('matches the worked example in Box 11 (Bangkok, 15 May)', () => {
    // Ra for 13.73°N on day 135 is 38.06 MJ/m²/day in the paper.
    const ra = extraterrestrialRadiation(13.73, 135);
    expect(ra).toBeGreaterThan(37.5);
    expect(ra).toBeLessThan(38.6);
  });

  it('produces a plausible ET0 for a hot dry Indian summer day', () => {
    const et0 = referenceEt0({
      tMax: 41,
      tMin: 26,
      rhMean: 35,
      windSpeed2m: 2.5,
      solarRadiation: 24,
      latitude: 28.6,
      dayOfYear: 150,
      elevation: 216,
    });
    // Peak-summer north Indian ET0 sits around 7-11 mm/day.
    expect(et0).toBeGreaterThan(6);
    expect(et0).toBeLessThan(12);
  });

  it('produces a lower ET0 for a humid monsoon day', () => {
    const dry = referenceEt0({
      tMax: 38,
      tMin: 25,
      rhMean: 30,
      windSpeed2m: 3,
      solarRadiation: 25,
      latitude: 19,
      dayOfYear: 120,
    });
    const humid = referenceEt0({
      tMax: 30,
      tMin: 24,
      rhMean: 90,
      windSpeed2m: 1,
      solarRadiation: 12,
      latitude: 19,
      dayOfYear: 200,
    });
    expect(humid).toBeLessThan(dry);
    expect(humid).toBeGreaterThan(0);
  });

  it('never returns a negative value', () => {
    const et0 = referenceEt0({
      tMax: 5,
      tMin: -2,
      rhMean: 99,
      windSpeed2m: 0,
      solarRadiation: 1,
      latitude: 34,
      dayOfYear: 15,
    });
    expect(et0).toBeGreaterThanOrEqual(0);
  });

  it('clamps the sunset hour angle inside the polar circle', () => {
    expect(Number.isFinite(extraterrestrialRadiation(78, 172))).toBe(true);
    expect(Number.isFinite(extraterrestrialRadiation(-78, 172))).toBe(true);
  });
});

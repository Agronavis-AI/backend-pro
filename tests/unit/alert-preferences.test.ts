// A module, not a script — see the note in rate-limit.test.ts.
export {};

/**
 * Whether a farmer's phone buzzes.
 *
 * The onboarding switches used to be decorative: four of them, for categories
 * nothing produced, thrown away on Finish. Now they decide delivery, so the
 * default matters more than the toggle — a farmer who has never opened the
 * setting must still be warned about a storm. Absent therefore reads as on,
 * and only an explicit false mutes.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ALERT_CATEGORIES } = require('../../src/modules/notifications/alert-categories');

jest.mock('../../src/config/env', () => ({ env: { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' } }));
jest.mock('../../src/config/supabase', () => ({ db: { from: jest.fn() } }));
jest.mock('../../src/config/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readAlertPreferences } = require('../../src/modules/farmers/farmers.service');

describe('reading the alert preferences', () => {
  it('turns every category on for a farmer who has never set them', () => {
    for (const settings of [null, undefined, {}, { alerts: {} }]) {
      expect(readAlertPreferences(settings)).toEqual(
        Object.fromEntries(ALERT_CATEGORIES.map((c: string) => [c, true])),
      );
    }
  });

  it('mutes only what was explicitly switched off', () => {
    const prefs = readAlertPreferences({ alerts: { weather_alert: false } });

    expect(prefs.weather_alert).toBe(false);
    expect(prefs.irrigation).toBe(true);
    expect(prefs.pest_control).toBe(true);
  });

  it('ignores a category that is no longer offered', () => {
    // "Market prices" was a switch in the old onboarding screen. A stored
    // value for it must not appear in, or break, the current set.
    const prefs = readAlertPreferences({ alerts: { market: false, irrigation: false } });

    expect(Object.keys(prefs).sort()).toEqual([...ALERT_CATEGORIES].sort());
    expect(prefs.irrigation).toBe(false);
  });

  it('is not confused by other things kept in profile_settings', () => {
    const prefs = readAlertPreferences({ theme: 'dark', alerts: { pest_control: false } });

    expect(prefs.pest_control).toBe(false);
    expect(prefs.weather_alert).toBe(true);
  });

  it('reads a truthy-but-not-true value as on rather than off', () => {
    // Only an explicit false mutes. Anything else and a farmer stops being
    // told about storms because of a type coercion.
    expect(readAlertPreferences({ alerts: { weather_alert: 'no' } }).weather_alert).toBe(true);
    expect(readAlertPreferences({ alerts: { weather_alert: 0 } }).weather_alert).toBe(true);
  });
});

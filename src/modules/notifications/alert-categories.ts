import type { AlertCategory } from '@agronavis/shared-types';

/**
 * The alert categories, as a runtime list.
 *
 * Declared here rather than in `@agronavis/shared-types` because that package
 * points `main` at its own TypeScript source. That works only while every
 * import of it is an `import type` and vanishes at compile time — the moment
 * the built server imported a real value from it, Node loaded `src/index.ts`,
 * failed on its extensionless relative imports, and the API would not start.
 *
 * The check below keeps this honest: add a category to the union and this
 * file stops compiling until it is listed here too.
 */
export const ALERT_CATEGORIES = [
  'weather_alert',
  'irrigation',
  'pest_control',
] as const satisfies readonly AlertCategory[];

/** Fails to compile if a category in the union is missing from the list. */
type Unlisted = Exclude<AlertCategory, (typeof ALERT_CATEGORIES)[number]>;
const _everyCategoryIsListed: Unlisted extends never ? true : never = true;
void _everyCategoryIsListed;

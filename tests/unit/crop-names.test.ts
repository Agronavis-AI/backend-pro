import fs from 'node:fs';
import path from 'node:path';
import { readableClass } from '../../src/modules/crops/diagnose.service';

/**
 * The training set names two crops twice — `grape_*` against `healthy_grapes`,
 * `bell_pepper_*` against `healthy_pepper` — which reached the farmer as four
 * entries in the library's crop filter instead of two. The class list cannot be
 * renamed to fix it, because its order is the model's output order, so the
 * reconciliation lives in readableClass and these hold it there.
 */
const keys: string[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../model/class_names.json'), 'utf8'),
);

describe('crop names', () => {
  it('gives every one of the 86 classes a crop and a condition', () => {
    expect(keys).toHaveLength(86);
    for (const key of keys) {
      const { crop, condition } = readableClass(key);
      expect(crop).not.toBe('');
      expect(condition).not.toBe('');
    }
  });

  it('names each crop exactly once', () => {
    const crops = [...new Set(keys.map((k) => readableClass(k).crop))];
    expect(crops).toHaveLength(19);
    expect(crops).not.toContain('Grapes');
    expect(crops).not.toContain('Pepper');
  });

  it.each([
    ['healthy_grapes', 'Grape', 'Healthy'],
    ['grape_black_rot', 'Grape', 'Black Rot'],
    ['healthy_pepper', 'Bell Pepper', 'Healthy'],
    ['bell_pepper_bacterial_spot', 'Bell Pepper', 'Bacterial Spot'],
    ['wheat_yellow_rust', 'Wheat', 'Yellow Rust'],
  ])('reads %s as %s / %s', (key, crop, condition) => {
    expect(readableClass(key)).toMatchObject({ crop, condition });
  });
});

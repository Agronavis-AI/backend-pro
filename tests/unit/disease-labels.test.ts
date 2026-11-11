import {
  cropKey,
  labelsFromV1,
  parseLabelSet,
  readForCrop,
  softmax,
  type LabelSet,
} from '../../src/modules/crops/disease-labels';

const v1 = labelsFromV1([
  'healthy_rice',
  'rice_bacterial_blight',
  'diseased_rice',
  'tomato_late_blight',
  'potato_late_blight',
  'healthy_potato',
]);

describe('cropKey', () => {
  it('maps what farmers call their crop to the name the model uses', () => {
    expect(cropKey('Paddy (Dhan)')).toBe('rice');
    expect(cropKey('Boro rice')).toBe('rice');
    expect(cropKey('Aloo')).toBe('potato');
    expect(cropKey('Maize')).toBe('corn');
    expect(cropKey('Shimla mirch (Capsicum)')).toBe('bell pepper');
    expect(cropKey('Bell Pepper')).toBe('bell pepper');
  });

  it('says nothing rather than guess', () => {
    expect(cropKey('Dragon fruit')).toBeNull();
    expect(cropKey('')).toBeNull();
    expect(cropKey(undefined)).toBeNull();
  });
});

describe('softmax', () => {
  it('sums to one and a higher temperature softens it', () => {
    const sharp = softmax([4, 1, 0]);
    const soft = softmax([4, 1, 0], 2);
    expect(sharp.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(soft[0]!).toBeLessThan(sharp[0]!);
  });
});

describe('readForCrop', () => {
  // Most belief on tomato blight: the photograph is probably not rice at all.
  const scores = [0.05, 0.1, 0.05, 0.6, 0.15, 0.05];

  it('ranks only that crop, renormalised, and reports how much belief sat on it', () => {
    const reading = readForCrop(scores, v1, 'Paddy')!;
    expect(reading.ranked.map((r) => v1.classes[r.index]!.key)).toEqual([
      'rice_bacterial_blight',
      'healthy_rice',
      'diseased_rice',
    ]);
    expect(reading.ranked[0]!.confidence).toBeCloseTo(0.5, 6);
    expect(reading.cropMass).toBeCloseTo(0.2, 6);
  });

  it('never names a disease of another crop', () => {
    const reading = readForCrop(scores, v1, 'potato')!;
    expect(reading.ranked.every((r) => v1.classes[r.index]!.crop === 'Potato')).toBe(true);
  });

  it('returns null for a crop the model has never seen', () => {
    expect(readForCrop(scores, v1, 'jute')).toBeNull();
    expect(readForCrop(scores, v1, 'something else')).toBeNull();
  });
});

describe('parseLabelSet', () => {
  const good = {
    version: 'v2-2026.11',
    temperature: 1.4,
    size: 256,
    classes: [
      { key: 'rice_brown_spot', crop: 'Rice', condition: 'Brown Spot', healthy: false },
      { key: 'rice_healthy', crop: 'Rice', condition: 'Healthy', healthy: true },
    ],
  };

  it('reads the notebook output', () => {
    const set: LabelSet = parseLabelSet(good, 2);
    expect(set.version).toBe('v2-2026.11');
    expect(set.temperature).toBe(1.4);
    expect(set.size).toBe(256);
    expect(set.mean).toEqual([0.485, 0.456, 0.406]);
  });

  it('refuses a label file that does not match its weights', () => {
    expect(() => parseLabelSet(good, 3)).toThrow();
    expect(() => parseLabelSet({ classes: [] })).toThrow();
    expect(() => parseLabelSet({ classes: [{ key: 'x' }] })).toThrow();
  });

  it('ignores a nonsense temperature rather than divide by it', () => {
    expect(parseLabelSet({ ...good, temperature: 0 }).temperature).toBe(1);
  });
});

import { readableClass } from '../../src/modules/crops/diagnose.service';
import { toDiseaseRows } from '../../src/jobs/diseases.job';

describe('readableClass', () => {
  it('splits a crop from its condition', () => {
    expect(readableClass('tomato_late_blight')).toEqual({
      crop: 'Tomato', condition: 'Late Blight', healthy: false,
    });
  });

  it('reads a healthy class as the crop being well', () => {
    expect(readableClass('healthy_potato')).toEqual({
      crop: 'Potato', condition: 'Healthy', healthy: true,
    });
  });

  it('keeps the one two-word crop together', () => {
    expect(readableClass('bell_pepper_bacterial_spot')).toEqual({
      crop: 'Bell Pepper', condition: 'Bacterial Spot', healthy: false,
    });
  });

  it('says plainly when the model knows only that something is wrong', () => {
    const r = readableClass('diseased_rice');
    expect(r.crop).toBe('Rice');
    expect(r.condition).toBe('Disease present, not identified');
    expect(r.healthy).toBe(false);
  });
});

describe('toDiseaseRows', () => {
  it('keeps the class key, which is what a prediction resolves against', () => {
    const [r] = toDiseaseRows(['tomato_late_blight']);
    expect(r.class_key).toBe('tomato_late_blight');
    expect(r.name).toBe('Late Blight');
    expect(r.crop_type).toBe('Tomato');
  });

  it('leaves severity unset for a disease, since it depends on the outbreak', () => {
    expect(toDiseaseRows(['tomato_late_blight'])[0].severity).toBeNull();
    expect(toDiseaseRows(['healthy_tomato'])[0].severity).toBe('none');
  });

  it('writes a repeated class once', () => {
    expect(toDiseaseRows(['bean_rust', 'bean_rust'])).toHaveLength(1);
  });

  it('ignores an empty key rather than seeding a nameless row', () => {
    expect(toDiseaseRows(['', 'bean_rust'])).toHaveLength(1);
  });
});

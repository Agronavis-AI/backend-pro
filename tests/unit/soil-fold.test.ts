import { foldNutrientRows, titleCase } from '../../src/jobs/soil.job';

const scheme = (name: string, n: [number, number, number], zn: [number, number]) => ({
  cycle: '2024-25',
  district: { name },
  results: {
    n: { High: n[0], Medium: n[1], Low: n[2] },
    p: { High: 1, Medium: 2, Low: 3 },
    k: { High: 4, Medium: 5, Low: 6 },
    OC: { High: 7, Medium: 8, Low: 9 },
    pH: { Alkaline: 10, Acidic: 11, Neutral: 12 },
    EC: { Saline: 13, NonSaline: 14 },
    Zn: { Sufficient: zn[0], Deficient: zn[1] },
  },
});

describe('foldNutrientRows', () => {
  it('sums the sub-schemes that report the same district', () => {
    // Karnataka returns one row per scheme: 120 rows for 31 districts.
    const rows = foldNutrientRows('KARNATAKA', [
      scheme('BAGALKOTE', [58, 3327, 5415], [10, 20]),
      scheme('BAGALKOTE', [15, 537, 1248], [5, 6]),
      scheme('BELAGAVI', [1, 2, 3], [0, 1]),
    ]);

    expect(rows).toHaveLength(2);
    const bagalkote = rows.find((r) => r.District === 'Bagalkote')!;
    expect(bagalkote.n_high).toBe(73);
    expect(bagalkote.n_medium).toBe(3864);
    expect(bagalkote.n_low).toBe(6663);
    expect(bagalkote.Zn_Sufficient).toBe(15);
    expect(bagalkote.Zn_Deficient).toBe(26);
  });

  it('title-cases the shouting the portal returns', () => {
    const [row] = foldNutrientRows('ANDHRA PRADESH', [scheme('EAST GODAVARI', [1, 0, 0], [0, 0])]);
    expect(row.State).toBe('Andhra Pradesh');
    expect(row.District).toBe('East Godavari');
  });

  it('drops districts with no samples, which would make the estimate meaningless', () => {
    const rows = foldNutrientRows('GOA', [scheme('NORTH GOA', [0, 0, 0], [0, 0])]);
    expect(rows).toHaveLength(0);
  });

  it('survives rows with a missing district or absent nutrient bands', () => {
    const rows = foldNutrientRows('BIHAR', [
      { cycle: '2024-25', district: null, results: { n: { High: 5 } } },
      { cycle: '2024-25', district: { name: 'PATNA' }, results: { n: { High: 5 } } },
      { cycle: '2024-25', district: { name: 'GAYA' }, results: null },
    ]);
    expect(rows.map((r) => r.District)).toEqual(['Patna']);
    expect(rows[0].p_high).toBe(0);
    expect(rows[0].pH_Neutral).toBe(0);
  });

  it('normalises whitespace in names', () => {
    expect(titleCase('  WEST   BENGAL ')).toBe('West Bengal');
  });
});

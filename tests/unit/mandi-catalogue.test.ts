import { buildCatalogueRows, type CommodityRow, type FiltersResponse } from '../../src/jobs/catalogue.job';

/** Mirrors the real payload: an "All …" pseudo-row sits in every picklist. */
const filters: FiltersResponse = {
  data: {
    state_data: [
      { state_id: 100000, state_name: 'All States/UTs' },
      { state_id: 20, state_name: 'Maharashtra' },
      { state_id: 34, state_name: ' Uttar Pradesh ' },
    ],
    district_data: [
      { id: 100001, state_id: null, district_name: 'All Districts' },
      { id: 338, state_id: 20, district_name: 'Ahilyanagar' },
      { id: 900, state_id: 99, district_name: 'District of a state not listed' },
    ],
    market_data: [
      { id: 100002, state_id: null, district_id: null, mkt_name: 'All Markets' },
      { id: 501, state_id: 20, district_id: 338, mkt_name: 'APMC  Latur' },
      { id: 502, state_id: 20, district_id: 777, mkt_name: 'Mandi in an unlisted district' },
      { id: 503, state_id: 99, district_id: 338, mkt_name: 'Mandi in an unlisted state' },
    ],
  },
};

const commodity = (id: number, name: string): CommodityRow => ({
  id,
  cmdt_name: name,
  cmdt_group: 'Vegetables',
  cmdt_group_id: 6,
  arrival_unit_name: 'Tonnes',
  price_unit_name: 'Rs / Quintal',
});

describe('buildCatalogueRows', () => {
  const rows = buildCatalogueRows(filters, [commodity(23, 'Onion'), commodity(100007, 'All Varieties')]);

  it('drops the "All …" pseudo-rows', () => {
    expect(rows.states.map((s) => s.id)).toEqual([20, 34]);
    expect(rows.districts.map((d) => d.id)).not.toContain(100001);
    expect(rows.markets.map((m) => m.id)).not.toContain(100002);
    expect(rows.commodities.map((c) => c.id)).toEqual([23]);
  });

  it('trims names that arrive padded', () => {
    expect(rows.states.find((s) => s.id === 34)?.name).toBe('Uttar Pradesh');
  });

  it('drops districts and mandis whose state is not in the state list', () => {
    expect(rows.districts.map((d) => d.id)).toEqual([338]);
    expect(rows.markets.map((m) => m.id)).not.toContain(503);
  });

  it('keeps a mandi whose district is unlisted, with a null district', () => {
    const orphan = rows.markets.find((m) => m.id === 502);
    expect(orphan).toBeDefined();
    expect(orphan?.district_id).toBeNull();
    expect(rows.markets.find((m) => m.id === 501)?.district_id).toBe(338);
  });
});

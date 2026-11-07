import { poolByCommodity } from '../../src/modules/market/market.service';
import type { MandiPrice } from '@agronavis/shared-types';

const row = (over: Partial<MandiPrice> = {}): MandiPrice => ({
  commodity: 'Brinjal',
  variety: 'Common',
  state: 'West Bengal',
  district: 'Nadia',
  market: 'Kalyani',
  minPrice: 3000,
  maxPrice: 4000,
  modalPrice: 3500,
  unit: 'Quintal',
  marketsReporting: 1,
  markets: ['Kalyani'],
  arrivalDate: '2026-09-23',
  ...over,
});

describe('poolByCommodity', () => {
  it('returns one row per commodity, with no market or district named', () => {
    const [r] = poolByCommodity([
      row({ market: 'Kalyani' }),
      row({ market: 'Habra' }),
      row({ market: 'Durgapur' }),
    ]);
    expect(r.market).toBe('');
    expect(r.district).toBe('');
    expect(r.marketsReporting).toBe(3);
    expect(r.state).toBe('West Bengal');
  });

  it('spans the lowest and highest a mandi recorded', () => {
    const [r] = poolByCommodity([
      row({ market: 'A', minPrice: 2000, maxPrice: 2500 }),
      row({ market: 'B', minPrice: 3000, maxPrice: 6000 }),
    ]);
    expect(r.minPrice).toBe(2000);
    expect(r.maxPrice).toBe(6000);
  });

  it('takes the median, so one unusual mandi cannot drag it', () => {
    const [r] = poolByCommodity([
      row({ market: 'A', modalPrice: 3000 }),
      row({ market: 'B', modalPrice: 3200 }),
      row({ market: 'C', modalPrice: 40000 }),
    ]);
    expect(r.modalPrice).toBe(3200);
  });

  it('averages the middle pair when the count is even', () => {
    const [r] = poolByCommodity([
      row({ market: 'A', modalPrice: 3000 }),
      row({ market: 'B', modalPrice: 3100 }),
      row({ market: 'C', modalPrice: 3300 }),
      row({ market: 'D', modalPrice: 3500 }),
    ]);
    expect(r.modalPrice).toBe(3200);
  });

  it('counts a mandi once even when it reported on several days', () => {
    const [r] = poolByCommodity([
      row({ market: 'Kalyani', arrivalDate: '2026-09-22' }),
      row({ market: 'Kalyani', arrivalDate: '2026-09-23' }),
    ]);
    expect(r.marketsReporting).toBe(1);
    expect(r.arrivalDate).toBe('2026-09-23');
  });

  it('keeps varieties of one crop apart', () => {
    const rows = poolByCommodity([row({ variety: 'Common' }), row({ variety: 'Long' })]);
    expect(rows).toHaveLength(2);
  });

  it('puts the best-covered commodities first', () => {
    const rows = poolByCommodity([
      row({ commodity: 'Onion', market: 'A' }),
      row({ commodity: 'Potato', market: 'A' }),
      row({ commodity: 'Potato', market: 'B' }),
    ]);
    expect(rows.map((r) => r.commodity)).toEqual(['Potato', 'Onion']);
  });
});

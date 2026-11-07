import { isoDate, toPriceRows } from '../../src/jobs/mandi.job';

const row = (over: Record<string, unknown> = {}) => ({
  state: 'Punjab',
  district: 'Ludhiana',
  market: 'Doraha APMC',
  commodity: 'Wheat',
  variety: 'Other',
  arrival_date: '2026-09-24',
  min_price: 2400,
  max_price: 2700,
  modal_price: 2600,
  ...over,
});

describe('toPriceRows', () => {
  it('maps a mirror row onto the price shape', () => {
    const [r] = toPriceRows([row()]);
    expect(r).toMatchObject({
      commodity: 'Wheat',
      state: 'Punjab',
      district: 'Ludhiana',
      market: 'Doraha APMC',
      variety: 'Other',
      minPrice: 2400,
      maxPrice: 2700,
      modalPrice: 2600,
      unit: 'Quintal',
      arrivalDate: '2026-09-24',
    });
  });

  it('drops rows a farmer could not act on', () => {
    expect(toPriceRows([row({ market: '' })])).toHaveLength(0);
    expect(toPriceRows([row({ arrival_date: undefined })])).toHaveLength(0);
    expect(toPriceRows([row({ modal_price: 0 })])).toHaveLength(0);
    expect(toPriceRows([row({ commodity: '   ' })])).toHaveLength(0);
  });

  it('falls back to the modal price when a bound is missing', () => {
    const [r] = toPriceRows([row({ min_price: null, max_price: null })]);
    expect(r.minPrice).toBe(2600);
    expect(r.maxPrice).toBe(2600);
  });

  it('puts the bounds the right way round when the feed inverts them', () => {
    const [r] = toPriceRows([row({ min_price: 2900, max_price: 2100 })]);
    expect(r.minPrice).toBe(2100);
    expect(r.maxPrice).toBe(2900);
  });

  it('keeps one row per market, commodity and date', () => {
    expect(toPriceRows([row(), row()])).toHaveLength(1);
    expect(toPriceRows([row(), row({ arrival_date: '2026-09-23' })])).toHaveLength(2);
  });

  it('defaults a missing variety rather than storing it blank', () => {
    expect(toPriceRows([row({ variety: undefined })])[0].variety).toBe('Common');
  });
});

describe('isoDate', () => {
  it('passes an ISO date through', () => {
    expect(isoDate('2026-09-24')).toBe('2026-09-24');
  });

  it('turns the snapshot’s day-first date into ISO', () => {
    expect(isoDate('23-09-2026')).toBe('2026-09-23');
  });

  it('rejects anything it cannot read, rather than guessing', () => {
    expect(isoDate('24/09/2026')).toBeNull();
    expect(isoDate('Sept 23')).toBeNull();
    expect(isoDate('')).toBeNull();
  });
});

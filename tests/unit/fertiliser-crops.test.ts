import { toCropRows } from '../../src/jobs/fertiliser.job';

const STATE_ID = '63f9322a89d86ca9e2bca5df';

describe('toCropRows', () => {
  it('keeps the combined label, which names the season and irrigation', () => {
    const [row] = toCropRows(STATE_ID, 'WEST BENGAL', [
      { id: 'a1', name: 'Rice', variety: 'Medium Duration', combinedName: 'Rice (Medium Duration / Rainfed / Kharif)' },
    ]);
    expect(row.label).toBe('Rice (Medium Duration / Rainfed / Kharif)');
    expect(row.name).toBe('Rice');
    expect(row.variety).toBe('Medium Duration');
    expect(row.state).toBe('West Bengal');
    expect(row.shc_state_id).toBe(STATE_ID);
  });

  it('drops crops with no id, since the recommendation query needs one', () => {
    const rows = toCropRows(STATE_ID, 'BIHAR', [
      { id: '', name: 'Maize', combinedName: 'Maize (All / Kharif)' },
      { id: 'b2', name: 'Maize', combinedName: 'Maize (All / Kharif)' },
    ]);
    expect(rows.map((r) => r.shc_id)).toEqual(['b2']);
  });

  it('drops a crop with no readable name at all', () => {
    expect(toCropRows(STATE_ID, 'GOA', [{ id: 'c3', name: '  ', combinedName: '' }])).toHaveLength(0);
  });

  it('falls back to the plain name when no combined label is given', () => {
    const [row] = toCropRows(STATE_ID, 'UTTAR PRADESH', [{ id: 'd4', name: 'जौ', combinedName: null }]);
    expect(row.label).toBe('जौ');
    expect(row.name).toBe('जौ');
  });

  it('keeps names in the state language the scheme publishes', () => {
    const [row] = toCropRows(STATE_ID, 'MAHARASHTRA', [
      { id: 'e5', name: 'वांगे', variety: 'all variety', combinedName: 'वांगे (all variety / Irrigated / Kharif)' },
    ]);
    expect(row.name).toBe('वांगे');
  });

  it('ignores a repeated id rather than upserting it twice', () => {
    const rows = toCropRows(STATE_ID, 'KERALA', [
      { id: 'f6', name: 'Banana', combinedName: 'Banana (Rabi)' },
      { id: 'f6', name: 'Banana', combinedName: 'Banana (Rabi)' },
    ]);
    expect(rows).toHaveLength(1);
  });
});

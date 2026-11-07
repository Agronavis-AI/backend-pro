import {
  angleBetween,
  bearingDeg,
  boundingBox,
  clusterDetections,
  BURN_REGIONS,
  distanceKm,
  parseFirmsCsv,
  regionFor,
} from '../../src/modules/fires/fires.service';
import { buildSmokeAdvisory, type NearbyFire } from '../../src/modules/advisory/advisory.service';
import { acquiredAt } from '../../src/jobs/fires.job';

/**
 * Stubble burning is the one thing that happens to a Punjab farmer every
 * October that nobody tells them about in advance. Getting this wrong in
 * either direction is costly: a warning for smoke blowing the other way is
 * noise, and noise in the one season this matters is how the app gets muted.
 */
describe('geometry', () => {
  it('measures a known distance', () => {
    // Ludhiana to Chandigarh, about 100 km.
    expect(distanceKm(30.9, 75.85, 30.73, 76.78)).toBeGreaterThan(85);
    expect(distanceKm(30.9, 75.85, 30.73, 76.78)).toBeLessThan(105);
  });

  it('is zero at the same point', () => {
    expect(distanceKm(30.9, 75.85, 30.9, 75.85)).toBeCloseTo(0, 5);
  });

  it.each([
    ['north', 31.9, 75.85, 0],
    ['east', 30.9, 76.85, 90],
    ['south', 29.9, 75.85, 180],
    ['west', 30.9, 74.85, 270],
  ])('bears %s correctly', (_d, lat, lon, expected) => {
    expect(bearingDeg(30.9, 75.85, lat, lon)).toBeCloseTo(expected, 0);
  });

  it('takes the short way round the compass', () => {
    expect(angleBetween(10, 350)).toBe(20);
    expect(angleBetween(350, 10)).toBe(20);
    expect(angleBetween(0, 180)).toBe(180);
  });

  it('builds a box FIRMS can read, west south east north', () => {
    const [w, s, e, n] = boundingBox(30.9, 75.85, 60).split(',').map(Number);
    expect(w).toBeLessThan(e);
    expect(s).toBeLessThan(n);
    // Roughly 120 km tall.
    expect((n! - s!) * 110.574).toBeGreaterThan(110);
    expect((n! - s!) * 110.574).toBeLessThan(130);
  });
});

describe('parsing what FIRMS returns', () => {
  const csv = [
    'country_id,latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
    'IND,30.9123,75.8456,330.5,0.4,0.36,2026-10-15,0612,N,VIIRS,n,2.0NRT,290.1,4.2,D',
    'IND,30.9500,75.9000,345.0,0.4,0.36,2026-10-15,0612,N,VIIRS,h,2.0NRT,295.0,9.1,D',
  ].join('\n');

  it('reads rows by header name, not by position', () => {
    const fires = parseFirmsCsv(csv);
    expect(fires).toHaveLength(2);
    expect(fires[0]).toMatchObject({
      latitude: 30.9123,
      longitude: 75.8456,
      brightnessK: 330.5,
      confidence: 'n',
      acquiredDate: '2026-10-15',
    });
  });

  it('survives FIRMS adding a column', () => {
    const shifted = csv.replace('country_id,', 'country_id,new_column,').replace(/\nIND,/g, '\nIND,x,');
    expect(parseFirmsCsv(shifted)[0]?.latitude).toBe(30.9123);
  });

  it('returns nothing for a header it does not recognise', () => {
    expect(parseFirmsCsv('a,b,c\n1,2,3')).toEqual([]);
  });

  it('returns nothing for an empty response', () => {
    expect(parseFirmsCsv('')).toEqual([]);
    expect(parseFirmsCsv('header only')).toEqual([]);
  });

  it('skips a row whose coordinates are not numbers', () => {
    expect(parseFirmsCsv(csv + '\nIND,nope,nope,1,1,1,2026-10-15,0612,N,VIIRS,n,2,1,1,D')).toHaveLength(2);
  });

  it('turns a FIRMS date and HHMM into an instant', () => {
    expect(acquiredAt('2026-10-15', '0612')).toBe('2026-10-15T06:12:00.000Z');
    expect(acquiredAt('2026-10-15', '612')).toBe('2026-10-15T06:12:00.000Z');
    expect(acquiredAt('2026-10-15', '')).toBe('2026-10-15T00:00:00.000Z');
  });
});

describe('who gets warned about smoke', () => {
  const fires = (count: number, bearing: number, km = 30): NearbyFire[] =>
    Array.from({ length: count }, () => ({ distanceKm: km, bearingDeg: bearing }));

  it('warns when enough fires burn upwind', () => {
    // Wind from the north-west; fires to the north-west.
    const a = buildSmokeAdvisory(fires(9, 315), 315);
    expect(a?.title).toBe('Stubble smoke expected');
    expect(a?.body).toContain('9 field fires');
    expect(a?.metadata).toMatchObject({ nearestKm: 30 });
  });

  it('raises the severity when the whole district is alight', () => {
    expect(buildSmokeAdvisory(fires(25, 315), 315)?.severity).toBe('high');
    expect(buildSmokeAdvisory(fires(9, 315), 315)?.severity).toBe('medium');
  });

  it('stays silent when the smoke blows the other way', () => {
    // Fires to the north-west, wind coming from the south-east.
    expect(buildSmokeAdvisory(fires(30, 315), 135)).toBeNull();
  });

  it('stays silent for a bonfire', () => {
    expect(buildSmokeAdvisory(fires(3, 315), 315)).toBeNull();
  });

  it('stays silent for fires beyond the radius', () => {
    expect(buildSmokeAdvisory(fires(30, 315, 120), 315)).toBeNull();
  });

  it('falls back to proximity when the wind is unknown', () => {
    expect(buildSmokeAdvisory(fires(9, 315), null)?.title).toBe('Stubble smoke expected');
  });

  it('counts a fire just off the wind line as upwind', () => {
    // Wind from 315, fire at 345 — thirty degrees off, still coming this way.
    expect(buildSmokeAdvisory(fires(9, 345), 315)).not.toBeNull();
  });

  it('says nothing at all with no fires', () => {
    expect(buildSmokeAdvisory([], 315)).toBeNull();
  });
});

describe('naming where a fire is', () => {
  it.each([
    ['Punjab', 30.9, 75.85],
    ['Haryana', 29.4, 76.5],
    ['Bihar', 25.6, 85.1],
    ['Gujarat', 22.3, 70.8],
  ])('places a %s fire', (expected, lat, lon) => {
    expect(regionFor(lat, lon)).toBe(expected);
  });

  it('prefers the smaller region where two overlap', () => {
    // Delhi sits inside the Uttar Pradesh and Haryana rectangles.
    expect(regionFor(28.61, 77.21)).toBe('Delhi NCR');
  });

  it('is null well outside the farmed regions', () => {
    expect(regionFor(5.0, 60.0)).toBeNull();
  });

  it('covers the states that actually burn after the kharif harvest', () => {
    const names = BURN_REGIONS.map((r) => r.name);
    for (const must of ['Punjab', 'Haryana', 'Uttar Pradesh', 'Madhya Pradesh']) {
      expect(names).toContain(must);
    }
  });

  it('gives every region a box that is the right way round', () => {
    for (const r of BURN_REGIONS) {
      const [s, w, n, e] = r.box;
      expect(s).toBeLessThan(n);
      expect(w).toBeLessThan(e);
      // Small enough that FIRMS will answer for it in one request.
      expect((n - s) * (e - w)).toBeLessThan(80);
    }
  });
});


/**
 * VIIRS resolves 375 m, so a single burning field arrives as a handful of
 * adjacent pixels and FIRMS reports every one. Listed raw, the screen showed
 * the same fire four times over — identical distance, identical minute.
 */
describe('clustering adjacent pixels', () => {
  const pixel = (lat: number, lon: number, over: Partial<Record<string, unknown>> = {}) => ({
    latitude: lat,
    longitude: lon,
    brightnessK: 330,
    confidence: 'n',
    acquiredDate: '2026-10-12',
    acquiredTime: '0644',
    ...over,
  }) as never;

  it('merges pixels of one fire seen in one pass', () => {
    // Three pixels within a few hundred metres of each other.
    const out = clusterDetections([
      pixel(22.5, 88.3),
      pixel(22.503, 88.3),
      pixel(22.5, 88.303),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]!.pixels).toBe(3);
  });

  it('keeps fires far enough apart separate', () => {
    const out = clusterDetections([pixel(22.5, 88.3), pixel(22.6, 88.4)]);
    expect(out).toHaveLength(2);
  });

  it('does not merge across satellite passes', () => {
    // Same place, twelve hours apart: two events, not one.
    const out = clusterDetections([
      pixel(22.5, 88.3),
      pixel(22.5, 88.3, { acquiredTime: '1844' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('reports the cluster at its hottest pixel', () => {
    const out = clusterDetections([
      pixel(22.5, 88.3, { brightnessK: 320 }),
      pixel(22.502, 88.3, { brightnessK: 367 }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]!.brightnessK).toBe(367);
  });

  it('handles an empty list', () => {
    expect(clusterDetections([])).toEqual([]);
  });
});

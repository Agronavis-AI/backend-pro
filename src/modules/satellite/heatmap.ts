import { PNG } from 'pngjs';
import type { NdviGrid } from './ndvi.service';

/**
 * Draws an NDVI grid as a small PNG, to lay over the field on the map.
 *
 * Rendered here rather than stored as a file: the grid is four hundred
 * numbers, and turning them into a picture is a millisecond of arithmetic.
 * Writing it to a bucket would mean a bucket to create, files to expire, and
 * a URL the map could not fetch anyway — Mapbox's image loader sends none of
 * our auth headers, so a protected URL would simply fail. A data URI in the
 * response the app has already authenticated for sidesteps all of it.
 *
 * The image is one pixel per reading, scaled up by the map. That is honest
 * about the resolution: Sentinel-2 sees 10 m, so a one-acre field is about
 * six blocks across, and a smoothed picture would imply detail that is not
 * there.
 */

/**
 * Brown through yellow to green, the convention for vegetation indices.
 *
 * Anchored at the values that mean something agronomically rather than spread
 * evenly: bare ground sits near 0.15 and a closed canopy past 0.6, so most of
 * the colour range is spent between those.
 */
const STOPS: [number, [number, number, number]][] = [
  [0.0, [165, 113, 78]],   // bare soil
  [0.2, [214, 183, 118]],  // sparse
  [0.4, [224, 215, 108]],  // patchy
  [0.6, [122, 189, 90]],   // growing
  [0.8, [31, 120, 54]],    // dense canopy
];

export function ndviColour(v: number): [number, number, number] {
  if (!Number.isFinite(v)) return [0, 0, 0];
  const x = Math.min(0.8, Math.max(0, v));

  for (let i = 1; i < STOPS.length; i += 1) {
    const [hi, hiC] = STOPS[i]!;
    const [lo, loC] = STOPS[i - 1]!;
    if (x <= hi) {
      const t = hi === lo ? 0 : (x - lo) / (hi - lo);
      return [
        Math.round(loC[0] + (hiC[0] - loC[0]) * t),
        Math.round(loC[1] + (hiC[1] - loC[1]) * t),
        Math.round(loC[2] + (hiC[2] - loC[2]) * t),
      ];
    }
  }
  return STOPS[STOPS.length - 1]![1];
}

/** The grid as a PNG data URI, ready for an image overlay. */
export function heatmapDataUri(grid: NdviGrid): string | null {
  const side = Math.floor(grid.side);
  if (!side || side < 2 || grid.values.length < side * side) return null;

  const png = new PNG({ width: side, height: side });

  for (let i = 0; i < side * side; i += 1) {
    const v = grid.values[i];
    const o = i * 4;
    const [r, g, b] = ndviColour(typeof v === 'number' ? v : Number.NaN);

    png.data[o] = r;
    png.data[o + 1] = g;
    png.data[o + 2] = b;
    // Nodata is transparent, so the satellite image shows through rather
    // than a black square implying a dead patch.
    png.data[o + 3] = typeof v === 'number' && Number.isFinite(v) ? 200 : 0;
  }

  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}

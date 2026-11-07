import { vegetationShare } from '../../src/modules/crops/diagnose.service';

/**
 * The classifier is forced to answer with one of its 86 crop labels whatever it
 * is shown, so this gate is the only thing standing between a farmer and being
 * told their own face is healthy rice — which is exactly what happened before
 * the index was narrowed. These are the colours that matter: leaf tissue across
 * its range on one side, and on the other the surfaces a phone camera actually
 * sees when it is not pointed at a crop.
 */
const MIN_VEGETATION = 0.15;

/** A patch of one colour with the shading and sensor noise of a real frame. */
function patch(r: number, g: number, b: number): Buffer {
  const pixels = 64 * 64;
  const buf = Buffer.alloc(pixels * 3);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < pixels; i++) {
    const shade = 0.75 + 0.5 * rand();
    const jitter = (v: number) =>
      Math.max(0, Math.min(255, Math.round(v * shade + (rand() - 0.5) * 24)));
    buf[i * 3] = jitter(r);
    buf[i * 3 + 1] = jitter(g);
    buf[i * 3 + 2] = jitter(b);
  }
  return buf;
}

const isPlant = (r: number, g: number, b: number) =>
  vegetationShare(patch(r, g, b)) >= MIN_VEGETATION;

describe('vegetation gate', () => {
  it.each([
    ['healthy leaf', 60, 120, 50],
    ['rice leaf', 90, 130, 60],
    ['leaf in deep shade', 35, 75, 30],
    ['leaf in full sun', 130, 185, 95],
    ['chlorotic yellowing', 190, 180, 60],
    ['pale yellow leaf', 220, 210, 120],
    ['amber, early blight', 200, 160, 60],
  ])('accepts %s', (_label, r, g, b) => {
    expect(isPlant(r, g, b)).toBe(true);
  });

  it.each([
    ['skin, lit', 200, 150, 120],
    ['skin, mid tone', 165, 125, 98],
    ['skin, in shadow', 120, 90, 70],
    ['skin, pale', 235, 195, 175],
    ['skin, dark', 95, 70, 58],
    ['bare wood', 150, 100, 60],
    ['beige wall', 210, 200, 185],
    ['blue sky', 110, 160, 230],
    ['grey concrete', 140, 140, 142],
    ['white paper', 245, 245, 243],
    ['red shirt', 150, 45, 65],
    ['an unlit room', 22, 24, 28],
  ])('refuses %s', (_label, r, g, b) => {
    expect(isPlant(r, g, b)).toBe(false);
  });
});

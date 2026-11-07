import { refusedByGate } from '../../src/modules/crops/diagnose.service';
import type { PlantGate } from '../../src/modules/crops/plant-gate.service';

/**
 * The gate is allowed to refuse a photograph, which means a mistake here costs
 * a farmer the scan they came for. It may only do so on positive evidence: a
 * confident reading of something a crop photograph cannot contain. Failing to
 * recognise a leaf is not evidence of anything — ImageNet has no class for rice
 * at 20 cm — so these pin down that every one of the three conditions is
 * required, and that absence of evidence never refuses.
 */
const gate = (p: Partial<PlantGate>): PlantGate => ({
  available: true,
  topClass: 0,
  topScore: 0,
  topIsNotCrop: false,
  ...p,
});

describe('plant gate decision', () => {
  it('refuses a confident reading of something a crop cannot be', () => {
    expect(refusedByGate(gate({ topIsNotCrop: true, topScore: 0.61 }))).toBe(true);
  });

  it('allows the same reading when the model is unsure', () => {
    expect(refusedByGate(gate({ topIsNotCrop: true, topScore: 0.2 }))).toBe(false);
  });

  it('allows a confident reading of something a crop can be', () => {
    expect(refusedByGate(gate({ topIsNotCrop: false, topScore: 0.98 }))).toBe(false);
  });

  it('allows a frame it recognises as nothing at all', () => {
    expect(refusedByGate(gate({ topIsNotCrop: false, topScore: 0.03 }))).toBe(false);
  });

  it('never refuses when the model could not be asked', () => {
    expect(refusedByGate(gate({ available: false, topIsNotCrop: true, topScore: 0.99 }))).toBe(false);
  });

  it('holds the line exactly at the threshold', () => {
    expect(refusedByGate(gate({ topIsNotCrop: true, topScore: 0.35 }))).toBe(true);
    expect(refusedByGate(gate({ topIsNotCrop: true, topScore: 0.349 }))).toBe(false);
  });
});

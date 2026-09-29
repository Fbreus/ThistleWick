import { describe, expect, it } from 'vitest';
import { STAGE_SECONDS, MAX_STAGE, advanceCrops, cropStage, grow, harvestYield, isRipe, isSoil, nearWater } from '../src/systems/garden';
import { dawnLines, newTally } from '../src/systems/dawn';
import { WG } from '../src/world/worldgen';
import { ARCS } from '../src/systems/journal';
import { ITEMS, RECIPES, BDEF } from '../src/items';

const { B } = WG;

describe('garden growth', () => {
  it('moves through the four stages and stops at ripe', () => {
    expect(cropStage(0)).toBe(0);
    expect(cropStage(STAGE_SECONDS - 1)).toBe(0);
    expect(cropStage(STAGE_SECONDS)).toBe(1);
    expect(cropStage(STAGE_SECONDS * 2)).toBe(2);
    expect(cropStage(STAGE_SECONDS * 3)).toBe(MAX_STAGE);
    expect(cropStage(1e9)).toBe(MAX_STAGE);
    expect(isRipe(STAGE_SECONDS * 3)).toBe(true);
  });
  it('grows at full speed near water and half speed away from it', () => {
    expect(grow(0, 100, true)).toBe(100);
    expect(grow(0, 100, false)).toBe(50);
  });
  it('never overflows or shrinks', () => {
    expect(grow(STAGE_SECONDS * 3, 1e6, true)).toBe(STAGE_SECONDS * 3);
    expect(grow(10, -50, true)).toBe(10);
  });
  it('a watered crop planted in the morning is ripe after one day and a night', () => {
    const c = [{ growth: 0, wet: true }];
    advanceCrops(c, 300);
    expect(isRipe(c[0].growth)).toBe(true);
  });
  it('a dry crop needs about twice as long', () => {
    const c = [{ growth: 0, wet: false }];
    advanceCrops(c, 300);
    expect(isRipe(c[0].growth)).toBe(false);
    advanceCrops(c, 300);
    expect(isRipe(c[0].growth)).toBe(true);
  });
  it('reports how many crops grew and how many are ripe', () => {
    const c = [{ growth: 0, wet: true }, { growth: STAGE_SECONDS * 3, wet: true }, { growth: 0, wet: false }];
    expect(advanceCrops(c, 100)).toEqual({ grew: 1, ripe: 1 });
  });
});

describe('garden rules', () => {
  it('only soil takes seeds', () => {
    expect([B.GRASS, B.MEADOW, B.DIRT].every(isSoil)).toBe(true);
    expect([B.STONE, B.SAND, B.WATER, B.AIR, B.SNOW].some(isSoil)).toBe(false);
  });
  it('finds water within three blocks, one level down, but not further', () => {
    const at = (wi: number, wj: number, wk: number) => (i: number, j: number, k: number) => (i === wi && j === wj && k === wk ? B.WATER : B.AIR);
    expect(nearWater(at(3, 9, 0), 0, 10, 0)).toBe(true);
    expect(nearWater(at(4, 9, 0), 0, 10, 0)).toBe(false);
    expect(nearWater(at(0, 8, 0), 0, 10, 0)).toBe(false);
  });
  it('a harvest always includes roots and at least one seed', () => {
    for (const r of [0, 0.3, 0.7, 0.99]) {
      const y = harvestYield(() => r);
      expect(y.root).toBeGreaterThanOrEqual(2);
      expect(y.seed).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('garden content', () => {
  it('items, recipe, station and journal arc line up', () => {
    expect(ITEMS.seed.place).toBe('crop');
    expect(BDEF.crop.item).toBe('seed');
    expect(BDEF.crop.ns).toBeTruthy();
    expect(RECIPES.some(r => r.out === 'croot' && r.st === 'camp' && r.in.root === 1)).toBe(true);
    expect(ARCS.some(a => a.steps.some(s => s.key === 'place:crop'))).toBe(true);
  });
  it('the dawn card mentions the garden', () => {
    expect(dawnLines(newTally(), 2, null, { grew: 2, ripe: 0 })).toContain('Your garden: 2 crops grew');
    expect(dawnLines(newTally(), 2, null, { grew: 1, ripe: 1 })).toContain('Your garden: 1 crop grew, 1 is ready to harvest');
    expect(dawnLines(newTally(), 2, null, { grew: 0, ripe: 0 }).join('|')).not.toMatch(/garden/);
  });
});

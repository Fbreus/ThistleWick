/** Gardening rules: crop growth, soil and water checks and harvest yield. Pure, so it can be tested. */
import { WG } from '../world/worldgen';

const { B } = WG;

/** Effective growth seconds needed per stage: seed, sprout, leafy, ripe. */
export const STAGE_SECONDS = 90;
export const MAX_STAGE = 3;
/** Crops away from water still grow, just more slowly. */
export const DRY_RATE = 0.5;
export const WATER_RADIUS = 3;

export const STAGE_NAMES = ['Freshly planted', 'Sprout', 'Leafy', 'Ripe'] as const;

export const cropStage = (growth: number) => Math.min(MAX_STAGE, Math.max(0, Math.floor(growth / STAGE_SECONDS)));
export const isRipe = (growth: number) => cropStage(growth) >= MAX_STAGE;
export const growthRate = (wet: boolean) => (wet ? 1 : DRY_RATE);

/** Growth after `seconds` of game time. Capped at ripe so a long sleep cannot overflow the stages. */
export function grow(growth: number, seconds: number, wet: boolean): number {
  return Math.min(MAX_STAGE * STAGE_SECONDS, growth + Math.max(0, seconds) * growthRate(wet));
}

export const isSoil = (block: number) => block === B.GRASS || block === B.MEADOW || block === B.DIRT;

/** True when water lies within `r` blocks horizontally, at the crop's level or one below. */
export function nearWater(read: (i: number, j: number, k: number) => number, i: number, j: number, k: number, r = WATER_RADIUS): boolean {
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = -1; dy <= 0; dy++) if (read(i + dx, j + dy, k + dz) === B.WATER) return true;
  return false;
}

/** Roots and seeds from a ripe crop. Always returns a seed so a garden never dies out by accident. */
export function harvestYield(rand: () => number): { root: number; seed: number } {
  return { root: 2 + (rand() < 0.5 ? 1 : 0), seed: 1 + (rand() < 0.4 ? 1 : 0) };
}

export interface CropState { growth?: number; wet?: boolean }

/** Advances every crop by `seconds` and reports how many changed stage and how many are ripe. */
export function advanceCrops(crops: CropState[], seconds: number): { grew: number; ripe: number } {
  let grew = 0, ripe = 0;
  for (const c of crops) {
    const before = cropStage(c.growth ?? 0);
    c.growth = grow(c.growth ?? 0, seconds, !!c.wet);
    if (cropStage(c.growth) > before) grew++;
    if (isRipe(c.growth)) ripe++;
  }
  return { grew, ripe };
}

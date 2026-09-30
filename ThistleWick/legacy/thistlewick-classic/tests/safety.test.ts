import { describe, expect, it } from 'vitest';
import { beetlePursues, clearSight, inSpawnSanctuary } from '../src/systems/safety';

describe('a safe start and escapable beetles', () => {
  it('protects the clearing and excludes spawns near its edge', () => {
    expect(inSpawnSanctuary(0, 3)).toBe(true);
    expect(inSpawnSanctuary(24, 3)).toBe(true);
    expect(inSpawnSanctuary(25, 3)).toBe(false);
    expect(inSpawnSanctuary(27, 3, 4)).toBe(true);
  });
  it('only notices nearby players and loses them at the leash or behind cover', () => {
    expect(beetlePursues(9, false, false, true)).toBe(true);
    expect(beetlePursues(11, false, false, true)).toBe(false);
    expect(beetlePursues(11, true, false, true)).toBe(true);
    expect(beetlePursues(17, true, false, true)).toBe(false);
    expect(beetlePursues(2, true, true, true)).toBe(false);
    expect(beetlePursues(2, true, false, false)).toBe(false);
  });
  it('cannot see or bite through a wall, but can see through an open doorway', () => {
    const a = { x: 0.5, y: 0, z: 0.5 }, b = { x: 3.5, y: 0, z: 0.5 };
    expect(clearSight(a, b, x => x === 2)).toBe(false);
    expect(clearSight(a, b, () => false)).toBe(true);
  });
});

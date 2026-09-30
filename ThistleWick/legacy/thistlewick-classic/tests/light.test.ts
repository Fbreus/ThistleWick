import { describe, expect, it } from 'vitest';
import { beetleWardRadius } from '../src/systems/light';

describe('beetle light wards', () => {
  it('makes the Rootward Lantern stronger than ordinary fire and torches', () => {
    expect(beetleWardRadius('lantern')).toBe(14);
    expect(beetleWardRadius('camp')).toBe(9);
    expect(beetleWardRadius('torch')).toBeCloseTo(4.05);
    expect(beetleWardRadius('furnace')).toBe(0);
  });
});

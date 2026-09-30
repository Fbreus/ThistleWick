import { describe, expect, it } from 'vitest';
import { describePlace, findPlaces } from '../src/systems/places';
import type { WorldEvent } from '../src/systems/chronicle';

const ev = (day: number, cause: WorldEvent['cause'], i: number, j: number, k: number, id = 0): WorldEvent => ({ day, cause, i, j, k, id });
const dug = (day: number, n: number, x0 = 0, z0 = 0) => Array.from({ length: n }, (_, q) => ev(day, 'dug', x0 + (q % 4), 5 - Math.floor(q / 16), z0 + Math.floor(q / 4) % 4));

describe('places', () => {
  it('finds a quarry where enough ground was dug away', () => {
    const p = findPlaces(dug(2, 30, 100, 50));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ kind: 'quarry', cells: 30, firstDay: 2, lastDay: 2 });
    expect(Math.abs(p[0].x - 101)).toBeLessThanOrEqual(2);
  });
  it('ignores a few scratches', () => {
    expect(findPlaces(dug(1, 5))).toEqual([]);
  });
  it('tells a building site from a quarry and a pool', () => {
    const events = [
      ...dug(1, 20),
      ...Array.from({ length: 15 }, (_, q) => ev(3, 'placed', 60 + (q % 5), 5, 60 + Math.floor(q / 5), 15)),
      ...Array.from({ length: 14 }, (_, q) => ev(4, 'flooded', -60 - (q % 7), 2, 10 + Math.floor(q / 7), 12))
    ];
    expect(findPlaces(events).map(p => p.kind).sort()).toEqual(['pool', 'quarry', 'site']);
  });
  it('counts only what still stands: refilled holes are no quarry', () => {
    const holes = dug(1, 20);
    const refilled = holes.map(h => ev(2, 'placed', h.i, h.j, h.k, 3));
    const kinds = findPlaces([...holes, ...refilled]).map(p => p.kind);
    expect(kinds).toEqual(['site']);
  });
  it('lists the biggest place first and spans the days it grew over', () => {
    const small = dug(1, 14, 0, 0);
    const deeper = Array.from({ length: 20 }, (_, q) => ev(6, 'dug', 200 + (q % 4), 1, 200 + Math.floor(q / 4) % 4));
    const big = [...dug(2, 20, 200, 200), ...deeper];
    const p = findPlaces([...small, ...big]);
    expect(p[0].cells).toBeGreaterThan(p[1].cells);
    expect(p[0]).toMatchObject({ firstDay: 2, lastDay: 6 });
  });
  it('does not guess at legacy events, which carry no cause', () => {
    const legacy = Array.from({ length: 40 }, (_, q) => ev(0, 'legacy', q % 8, 5, Math.floor(q / 8), 0));
    expect(findPlaces(legacy)).toEqual([]);
  });
  it('describes a place in one line', () => {
    expect(describePlace({ kind: 'quarry', x: 40, z: -12, cells: 63, firstDay: 2, lastDay: 5 })).toBe('Quarry near (40, -12): 63 blocks, since day 2');
    expect(describePlace({ kind: 'site', x: 0, z: 0, cells: 20, firstDay: 0, lastDay: 0 })).toBe('Building site near (0, 0): 20 blocks');
  });
});

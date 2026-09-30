import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WG } from '../src/world/worldgen';
import { attemptSeed } from '../src/world/seed';
import { mulberry32 } from '../src/math';

// The original JS generator is the reference: the TS port must be bit-identical.
const legacy = new Function('module', readFileSync(new URL('../legacy/worldgen.js', import.meta.url), 'utf8') + '\nreturn WG;')({}) as typeof WG;

describe('worldgen', () => {
  it('terrain matches the JS original', () => {
    for (let i = -120; i <= 120; i += 17) for (let k = -120; k <= 120; k += 13) expect(WG.terr(i, k)).toEqual(legacy.terr(i, k));
  });
  it('chunks match the JS original', () => {
    for (const [cx, cz] of [[0, 0], [1, 0], [-2, 3], [4, -4]] as const) {
      const a = WG.genChunk(cx, cz), b = legacy.genChunk(cx, cz);
      expect(Buffer.compare(a.data, b.data)).toBe(0);
      expect(Buffer.compare(Buffer.from(a.hi.buffer), Buffer.from(b.hi.buffer))).toBe(0);
    }
  });
});

describe('world seed', () => {
  const terrainAt = () => [[300, 200], [-450, 120], [80, -600], [1200, 1200]].map(([i, k]) => WG.terr(i, k).h);
  afterEach(() => WG.setWorld(0, 1));

  it('seed 0 is still the original world after switching away and back', () => {
    WG.setWorld(987654, 2); WG.terr(300, 200);
    WG.setWorld(0, 1);
    for (let i = -120; i <= 120; i += 40) for (let k = -120; k <= 120; k += 40) expect(WG.terr(i, k)).toEqual(legacy.terr(i, k));
  });
  it('different seeds give different worlds, the same seed the same one', () => {
    WG.setWorld(1, 2); const a = terrainAt();
    WG.setWorld(2, 2); const b = terrainAt();
    WG.setWorld(1, 2); const c = terrainAt();
    expect(a).not.toEqual(b);
    expect(c).toEqual(a);
  });
  it('a chunk does not depend on which chunks were generated before it', () => {
    WG.setWorld(31337, 2);
    const first = WG.genChunk(3, -2).data;
    WG.setWorld(31337, 2);
    for (const [cx, cz] of [[0, 0], [5, 5], [-3, 1]] as const) WG.genChunk(cx, cz);
    expect(Buffer.compare(first, WG.genChunk(3, -2).data)).toBe(0);
  });
  it('keeps the spawn area the same in every world', () => {
    WG.setWorld(424242, 2);
    for (let i = -4; i <= 4; i++) for (let k = -4; k <= 4; k++) expect(WG.terr(i, k).h).toBeCloseTo(legacy.terr(i, k).h, 5);
  });
});

describe('spawn attempt streams', () => {
  afterEach(() => WG.setWorld(0, 1));
  const draw = (cx: number, cz: number, tag: string, a: number) => { const R = mulberry32(attemptSeed(cx, cz, tag, a)); return [R(), R(), R()]; };

  it('are stable and independent per chunk, kind and attempt', () => {
    expect(draw(1, 2, 'tree', 3)).toEqual(draw(1, 2, 'tree', 3));
    const others = [draw(2, 2, 'tree', 3), draw(1, 3, 'tree', 3), draw(1, 2, 'rock', 3), draw(1, 2, 'tree', 4)];
    for (const o of others) expect(o).not.toEqual(draw(1, 2, 'tree', 3));
  });
  it('change with the world seed', () => {
    WG.setWorld(11, 2); const a = draw(0, 0, 'tree', 0);
    WG.setWorld(12, 2); expect(draw(0, 0, 'tree', 0)).not.toEqual(a);
    WG.setWorld(11, 2); expect(draw(0, 0, 'tree', 0)).toEqual(a);
  });
});

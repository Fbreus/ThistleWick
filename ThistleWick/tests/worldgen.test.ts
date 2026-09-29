import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WG } from '../src/world/worldgen';

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

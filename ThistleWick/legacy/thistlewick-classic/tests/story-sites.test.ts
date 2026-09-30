import { describe, expect, it } from 'vitest';
import { navigationTo, nearStorySite, storySites } from '../src/world/story-sites';
import { WG } from '../src/world/worldgen';

describe('story sites', () => {
  it('are absent from old generator versions', () => {
    WG.setWorld(123, 2);
    expect(storySites(123, 2)).toEqual([]);
  });

  it('are deterministic, separated and placed in their requested biomes', () => {
    for (const seed of [1, 27, 12345]) {
      WG.setWorld(seed, 3);
      const a = storySites(seed, 3), b = storySites(seed, 3);
      expect(a).toEqual(b);
      expect(a).toHaveLength(2);
      expect(Math.hypot(a[0].x - a[1].x, a[0].z - a[1].z)).toBeGreaterThanOrEqual(50);
      expect(WG.terr(Math.floor(a[0].x), Math.floor(a[0].z)).biome).toBe(WG.BIOME.MEADOW);
      expect(WG.terr(Math.floor(a[1].x), Math.floor(a[1].z)).biome).toBe(WG.BIOME.FOREST);
      expect(WG.slope(Math.floor(a[0].x), Math.floor(a[0].z))).toBeLessThanOrEqual(1);
      expect(WG.slope(Math.floor(a[1].x), Math.floor(a[1].z))).toBeLessThanOrEqual(1);
    }
  });

  it('reports reserved space and useful navigation', () => {
    WG.setWorld(9, 3);
    const site = storySites(9, 3)[0];
    expect(nearStorySite([site], site.x + 2, site.z)).toBe(true);
    expect(navigationTo(site, site.x + 2, site.z)).toBe('very close');
    expect(navigationTo(site, site.x, site.z + 100)).toMatch(/^N - about 100 paces$/);
  });
});

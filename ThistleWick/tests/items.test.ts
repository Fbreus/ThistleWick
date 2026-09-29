import { describe, expect, it } from 'vitest';
import { ITEMS, RECIPES, BDEF, BLOCK } from '../src/items';

describe('items and recipes', () => {
  it('every recipe input and output is a defined item', () => {
    for (const r of RECIPES) {
      expect(ITEMS[r.out], `output ${r.out}`).toBeDefined();
      for (const id of Object.keys(r.in)) expect(ITEMS[id], `input ${id} of ${r.out}`).toBeDefined();
    }
  });

  it('every craftable item is reachable from raw resources', () => {
    const crafted = new Set(RECIPES.map(r => r.out));
    const have = new Set(Object.keys(ITEMS).filter(id => !crafted.has(id)));
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of RECIPES) if (!have.has(r.out) && Object.keys(r.in).every(id => have.has(id))) { have.add(r.out); grew = true; }
    }
    for (const id of crafted) expect(have.has(id), `${id} is not reachable`).toBe(true);
  });

  it('placeable stations have a definition that drops the same item back', () => {
    for (const d of Object.values(ITEMS)) if (d.k === 'station') expect(BDEF[d.place!]?.item, d.id).toBe(d.id);
  });

  it('placeable block items point at a block that exists', () => {
    for (const d of Object.values(ITEMS)) if (d.k === 'block') expect(BLOCK[d.bid!], d.id).toBeDefined();
  });
});

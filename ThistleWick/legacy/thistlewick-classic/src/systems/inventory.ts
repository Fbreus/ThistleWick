import { ITEMS, type Recipe } from '../items';
import type { Slot } from '../types';

export type Pack = (Slot | null)[];
export const copyPack = (pack: Pack): Pack => pack.map(s => s ? { ...s } : null);
/** Returns the unplaced quantity. Tool durability is preserved on transfers. */
export function insert(pack: Pack, item: Slot): number {
  const def = ITEMS[item.id]; let left = item.n;
  if (def.stack > 1) for (const s of pack) if (s?.id === item.id) {
    const n = Math.min(left, def.stack - s.n); s.n += n; left -= n;
  }
  for (let i = 0; i < pack.length && left > 0; i++) if (!pack[i]) {
    const n = Math.min(left, def.stack); pack[i] = { ...item, n }; left -= n;
  }
  return left;
}
/** Ingredients and output are committed together, including newly freed slots. */
export function craftedPack(pack: Pack, recipe: Recipe, batches = 1): Pack | null {
  if (!Number.isInteger(batches) || batches < 1 || batches > 99) return null;
  const next = copyPack(pack);
  for (const [id, qty] of Object.entries(recipe.in)) {
    let left = qty * batches;
    for (let i = next.length - 1; i >= 0 && left > 0; i--) {
      const s = next[i]; if (s?.id !== id) continue;
      const n = Math.min(s.n, left); left -= n; s.n -= n; if (!s.n) next[i] = null;
    }
    if (left) return null;
  }
  return insert(next, { id: recipe.out, n: recipe.n * batches, dur: ITEMS[recipe.out].dur }) ? null : next;
}
export function transfer(from: Pack, index: number, to: Pack, amount = Infinity): number {
  const s = from[index]; if (!s) return 0;
  const n = Math.min(s.n, amount), moved = n - insert(to, { ...s, n });
  s.n -= moved; if (!s.n) from[index] = null; return moved;
}
export function mergeOrSwap(pack: Pack, a: number, b: number) {
  if (a === b) return;
  const s = pack[a], t = pack[b];
  if (s && t?.id === s.id && ITEMS[s.id].stack > 1) {
    const n = Math.min(s.n, ITEMS[s.id].stack - t.n); s.n -= n; t.n += n; if (!s.n) pack[a] = null;
  } else [pack[a], pack[b]] = [pack[b], pack[a]];
}
export function splitStack(pack: Pack, index: number): boolean {
  const s = pack[index], empty = pack.indexOf(null); if (!s || s.n < 2 || empty < 0) return false;
  const n = Math.floor(s.n / 2); s.n -= n; pack[empty] = { ...s, n }; return true;
}
export function sortPack(pack: Pack) {
  const slots = pack.filter((s): s is Slot => !!s).sort((a, b) => a.id.localeCompare(b.id));
  pack.fill(null); for (const s of slots) insert(pack, s);
}

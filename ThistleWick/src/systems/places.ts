/** Places the player has shaped, read off the chronicle: a quarry is where the ground was dug away, a building site
    is where blocks went up, a pool is where water was let in. Pure, so the journal, the map and residents can all
    use the same reading of the world's history. */
import type { WorldEvent } from './chronicle';

export type PlaceKind = 'quarry' | 'site' | 'pool';
export interface Place {
  kind: PlaceKind;
  /** Centre of the area, in world cells. */
  x: number; z: number;
  /** Changed cells that survive in the world now. */
  cells: number;
  firstDay: number; lastDay: number;
}

const GRID = 12;          // cells per neighbourhood
const MIN_CELLS = 12;     // fewer changed cells than this is a scratch, not a place

const kindOf = (e: WorldEvent): PlaceKind | null => {
  if (e.cause === 'flooded') return 'pool';
  if (e.cause === 'dug') return 'quarry';
  if (e.cause === 'placed' || e.cause === 'built') return 'site';
  return null;   // legacy events carry no cause, so they cannot be told apart
};

/** Neighbourhoods with enough changes to matter, biggest first. Only the latest event on each cell counts, so filling a hole back in
    cancels the quarry and a placed block that was later mined away is no site. */
export function findPlaces(events: WorldEvent[]): Place[] {
  const latest = new Map<string, WorldEvent>();
  for (const e of events) latest.set(e.i + ',' + e.j + ',' + e.k, e);
  const groups = new Map<string, { kind: PlaceKind; sx: number; sz: number; n: number; first: number; last: number }>();
  for (const e of latest.values()) {
    const kind = kindOf(e); if (!kind) continue;
    const key = kind + ':' + Math.floor(e.i / GRID) + ',' + Math.floor(e.k / GRID);
    const g = groups.get(key) ?? { kind, sx: 0, sz: 0, n: 0, first: Infinity, last: -Infinity };
    g.sx += e.i; g.sz += e.k; g.n++; g.first = Math.min(g.first, e.day); g.last = Math.max(g.last, e.day);
    groups.set(key, g);
  }
  const out: Place[] = [];
  for (const g of groups.values()) if (g.n >= MIN_CELLS) out.push({ kind: g.kind, x: Math.round(g.sx / g.n), z: Math.round(g.sz / g.n), cells: g.n, firstDay: g.first, lastDay: g.last });
  return out.sort((a, b) => b.cells - a.cells || a.x - b.x || a.z - b.z);
}

const WORD: Record<PlaceKind, string> = { quarry: 'Quarry', site: 'Building site', pool: 'Pool' };

/** One line for the journal: "Quarry near (40, -12): 63 blocks, since day 2". */
export function describePlace(p: Place): string {
  const since = p.firstDay >= 1 ? ', since day ' + p.firstDay : '';
  return WORD[p.kind] + ' near (' + p.x + ', ' + p.z + '): ' + p.cells + ' blocks' + since;
}

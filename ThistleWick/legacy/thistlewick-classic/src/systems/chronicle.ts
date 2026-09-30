/** The chronicle: every change the player makes to the terrain, in order, with the day it happened.
    The current shape of the world is a replay of this log on top of the generated terrain, so history and state
    can never disagree. Pure, so it can be tested without the game. */

export const CAUSES = ['legacy', 'dug', 'placed', 'flooded', 'built'] as const;
export type Cause = typeof CAUSES[number];

export interface WorldEvent { day: number; cause: Cause; i: number; j: number; k: number; id: number }

const FIELDS = 6;
const cellKey = (i: number, j: number, k: number) => i + ',' + j + ',' + k;

/** Packed as [day, cause, i, j, k, id] per event: compact in JSON and cheap to append to. */
export function encode(events: WorldEvent[]): number[] {
  const out: number[] = [];
  for (const e of events) out.push(e.day, CAUSES.indexOf(e.cause), e.i, e.j, e.k, e.id);
  return out;
}

/** Tolerant of a truncated array or an unknown cause code: a bad tail must not lose the rest of the world. */
export function decode(flat: unknown): WorldEvent[] {
  if (!Array.isArray(flat)) return [];
  const out: WorldEvent[] = [];
  for (let q = 0; q + FIELDS <= flat.length; q += FIELDS) {
    const [day, c, i, j, k, id] = flat.slice(q, q + FIELDS) as number[];
    if (![day, c, i, j, k, id].every(Number.isFinite)) continue;
    out.push({ day, cause: CAUSES[c] ?? 'legacy', i, j, k, id });
  }
  return out;
}

/** Saves from before the chronicle only know the final state of each edited cell, not when it happened. */
export function fromEdits(edits: number[], day = 0): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let q = 0; q + 3 < edits.length; q += 4) out.push({ day, cause: 'legacy', i: edits[q], j: edits[q + 1], k: edits[q + 2], id: edits[q + 3] });
  return out;
}

/** The last event on each cell: what the world looks like now. */
export function replay(events: WorldEvent[]): Map<string, WorldEvent> {
  const m = new Map<string, WorldEvent>();
  for (const e of events) m.set(cellKey(e.i, e.j, e.k), e);
  return m;
}

/** Everything that ever happened to one cell, oldest first. */
export function cellHistory(events: WorldEvent[], i: number, j: number, k: number): WorldEvent[] {
  return events.filter(e => e.i === i && e.j === j && e.k === k);
}

/** Keeps the log from growing without bound. Only events a later event on the same cell has overwritten are dropped, oldest first,
    so the replayed world is exactly the same. The log may stay above `max` when every remaining event still defines a cell. */
export function compact(events: WorldEvent[], max: number): WorldEvent[] {
  if (events.length <= max) return events;
  const last = new Map<string, number>();
  events.forEach((e, n) => last.set(cellKey(e.i, e.j, e.k), n));
  let excess = events.length - max;
  const out: WorldEvent[] = [];
  events.forEach((e, n) => {
    if (excess > 0 && last.get(cellKey(e.i, e.j, e.k)) !== n) { excess--; return; }
    out.push(e);
  });
  return out;
}

export interface ChangeCounts { dug: number; placed: number; flooded: number; built: number }

/** How much the player reshaped the land since event index `from`. Legacy events carry no time and are not counted. */
export function summarize(events: WorldEvent[], from = 0): ChangeCounts {
  const c: ChangeCounts = { dug: 0, placed: 0, flooded: 0, built: 0 };
  for (let n = from; n < events.length; n++) { const k = events[n].cause; if (k !== 'legacy') c[k]++; }
  return c;
}

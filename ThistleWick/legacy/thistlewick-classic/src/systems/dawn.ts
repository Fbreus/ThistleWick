/** Dawn summary: what happened since the player last slept. Pure, so it can be tested. */
import { ITEMS } from '../items';
import type { ChangeCounts } from './chronicle';

export interface DayTally {
  gathered: Record<string, number>;
  crafted: Record<string, number>;
  discoveries: string[];
  kills: number;
}

export const newTally = (): DayTally => ({ gathered: {}, crafted: {}, discoveries: [], kills: 0 });

export function tallyAdd(t: DayTally, kind: 'gathered' | 'crafted', id: string, n: number) {
  t[kind][id] = (t[kind][id] || 0) + n;
}

const list = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, n]) => (n > 1 ? n + ' ' : '') + (ITEMS[id]?.n ?? id).toLowerCase()).join(', ');

/** Lines for the dawn card. Empty sections are left out; a quiet day still gets a line. */
/** "Dug 14 blocks, placed 6", or null when the land was left alone. Flooding is the water's doing, not the player's. */
export function landLine(c: ChangeCounts): string | null {
  const placed = c.placed + c.built, parts: string[] = [];
  if (c.dug) parts.push('dug ' + c.dug + (c.dug === 1 ? ' block' : ' blocks'));
  if (placed) parts.push('placed ' + placed);
  return parts.length ? parts.join(', ').replace(/^./, m => m.toUpperCase()) : null;
}

export function dawnLines(t: DayTally, day: number, next: string | null, garden?: { grew: number; ripe: number }, land?: ChangeCounts): string[] {
  const out: string[] = [];
  if (Object.keys(t.gathered).length) out.push('Gathered ' + list(t.gathered));
  if (Object.keys(t.crafted).length) out.push('Made ' + list(t.crafted));
  const shaped = land && landLine(land); if (shaped) out.push(shaped);
  if (t.kills) out.push(t.kills === 1 ? 'Sent one beetle back into the dark' : 'Sent ' + t.kills + ' beetles back into the dark');
  if (t.discoveries.length) out.push('New in your log: ' + t.discoveries.slice(0, 4).join(', '));
  if (garden && (garden.grew || garden.ripe)) {
    const grew = garden.grew ? garden.grew + (garden.grew === 1 ? ' crop grew' : ' crops grew') : '';
    const ripe = garden.ripe ? (garden.ripe === 1 ? '1 is ready to harvest' : garden.ripe + ' are ready to harvest') : '';
    out.push('Your garden: ' + [grew, ripe].filter(Boolean).join(', '));
  }
  if (!out.length) out.push('A quiet day. The forest kept its secrets.');
  out.push(next ? 'Today: ' + next : 'Every goal in the journal is done. The forest is yours.');
  return ['Day ' + day + ' begins', ...out];
}

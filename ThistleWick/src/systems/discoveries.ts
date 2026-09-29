/** Collection log: everything the player can discover, derived from the same progress keys as the journal. */
import { ITEMS } from '../items';
import { WG } from '../world/worldgen';
import type { Progress } from './journal';

export type LogSection = 'items' | 'places' | 'creatures';
export interface LogEntry { key: string; name: string; section: LogSection; icon?: string }

export const CREATURES: { id: string; name: string }[] = [{ id: 'beetle', name: 'Gloom beetle' }, { id: 'hare', name: 'Thistle hare' }];

export function logEntries(): LogEntry[] {
  const items: LogEntry[] = Object.values(ITEMS).map(d => ({ key: 'got:' + d.id, name: d.n, section: 'items', icon: d.id }));
  const places: LogEntry[] = WG.BIOME_NAME.map((n, i) => ({ key: 'biome:' + i, name: n, section: 'places' }));
  places.push({ key: 'cave', name: 'The caves', section: 'places' });
  const creatures: LogEntry[] = CREATURES.map(c => ({ key: 'kill:' + c.id, name: c.name, section: 'creatures' }));
  return [...items, ...places, ...creatures];
}

export function logCounts(p: Progress): { found: number; total: number } {
  const all = logEntries();
  return { found: all.filter(e => p.has(e.key)).length, total: all.length };
}

/** Human name for a discovery key, used for the "New in your log" toast. Null when the key is not a log entry. */
export function discoveryName(key: string): string | null {
  return logEntries().find(e => e.key === key)?.name ?? null;
}

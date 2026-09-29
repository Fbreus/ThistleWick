/** Save format and migration. The localStorage key stays the same; the payload carries a version. */

export interface SaveBase {
  P: { x: number; y: number; z: number; hp: number; hunger: number; stamina: number; heading: number; spawnX: number; spawnZ: number };
  todT: number; sel: number;
  inv: ([string, number, number | undefined] | null)[];
  tips: Record<string, number>;
  edits: number[];
  stations: [string, number, number, number][];
  collected: string[]; dead: string[];
}
export interface SaveV1 extends SaveBase { v: 1 }
/** v2 adds the journal and collection log as a list of progress keys. */
/** `crops` (optional, added after v2 shipped) holds planted crops as [i, j, k, growth]. */
export interface SaveV2 extends SaveBase { v: 2; journal: string[]; crops?: [number, number, number, number][] }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** Old saves have no journal, so infer what the player has evidently already done. */
export function inferProgress(s: SaveBase): string[] {
  const keys = new Set<string>();
  for (const slot of s.inv) if (slot) keys.add('got:' + slot[0]);
  for (const st of s.stations) keys.add('place:' + st[0]);
  if (s.stations.some(st => st[0] === 'bed')) keys.add('craft:bed');
  return [...keys];
}

/** Accepts any stored value and returns a v2 save, or null if it is not a usable save. */
export function migrateSave(raw: unknown): SaveV2 | null {
  if (!isObj(raw) || !isObj(raw.P) || !Array.isArray(raw.inv) || !Array.isArray(raw.edits)) return null;
  if (raw.v === 2) return Array.isArray(raw.journal) ? (raw as unknown as SaveV2) : null;
  if (raw.v === 1) {
    const v1 = raw as unknown as SaveV1;
    return { ...v1, v: 2, journal: inferProgress(v1) };
  }
  return null;
}

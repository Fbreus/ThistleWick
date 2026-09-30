import { GEN_VERSION } from './world/seed';
import { encode, fromEdits } from './systems/chronicle';
import { createQuestState, normalizeQuestState, type QuestState } from './systems/quests';

import type { Friend } from './systems/dialogue';
import type { StorySiteState } from './world/story-sites';

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
export interface SaveV2 extends SaveBase { v: 2; journal: string[]; crops?: [number, number, number, number][]; friends?: Record<string, Friend>; homes?: Record<string, [number, number, number]> }
/** v3 records which world this is: the seed and the generator version that built it. Saves from before v3 are the original world. */
export interface SaveV3 extends Omit<SaveV2, 'v'> { v: 3; worldSeed: number; genVersion: number }
/** v4 replaces the flat `edits` list with the chronicle: every terrain change in order, packed as [day, cause, i, j, k, id]. */
export interface SaveV4 extends Omit<SaveV3, 'v' | 'edits'> { v: 4; events: number[] }
export interface StorySave extends QuestState { sites: Record<string, StorySiteState> }
/** v5 adds story quests, unlocked lore and persistent landmark interactions. */
export interface SaveV5 extends Omit<SaveV4, 'v'> { v: 5; story: StorySave }

export const createStorySave = (enabled: boolean): StorySave => ({ ...createQuestState(enabled), sites: {} });

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** Old saves have no journal, so infer what the player has evidently already done. */
export function inferProgress(s: SaveBase): string[] {
  const keys = new Set<string>();
  for (const slot of s.inv) if (slot) keys.add('got:' + slot[0]);
  for (const st of s.stations) keys.add('place:' + st[0]);
  if (s.stations.some(st => st[0] === 'bed')) keys.add('craft:bed');
  return [...keys];
}

/* a world made by a newer generator cannot be rebuilt faithfully, so it is not loaded */
const worldOK = (raw: Record<string, unknown>) => {
  const g = raw.genVersion;
  return Array.isArray(raw.journal) && typeof raw.worldSeed === 'number' && Number.isInteger(g) && (g as number) >= 1 && (g as number) <= GEN_VERSION;
};

/** Accepts any stored value and returns a v5 save, or null if it is not usable. Older worlds keep story landmarks disabled. */
export function migrateSave(raw: unknown): SaveV5 | null {
  if (!isObj(raw) || !isObj(raw.P) || !Array.isArray(raw.inv)) return null;
  if (raw.v === 5) {
    if (!Array.isArray(raw.events) || !worldOK(raw)) return null;
    const save = raw as unknown as SaveV5, story = normalizeQuestState(save.story, false);
    return { ...save, story: { ...story, sites: isObj(save.story?.sites) ? save.story.sites : {} } };
  }
  if (raw.v === 4) {
    if (!Array.isArray(raw.events) || !worldOK(raw)) return null;
    return { ...(raw as unknown as SaveV4), v: 5, story: createStorySave(false) };
  }
  if (!Array.isArray(raw.edits)) return null;
  const v3 = migrateToV3(raw);
  if (!v3) return null;
  const { edits, ...rest } = v3;
  return { ...rest, v: 5, events: encode(fromEdits(edits)), story: createStorySave(false) };
}

function migrateToV3(raw: Record<string, unknown>): SaveV3 | null {
  if (raw.v === 3) return worldOK(raw) ? (raw as unknown as SaveV3) : null;
  if (raw.v === 2) return Array.isArray(raw.journal) ? { ...(raw as unknown as SaveV2), v: 3, worldSeed: 0, genVersion: 1 } : null;
  if (raw.v === 1) {
    const v1 = raw as unknown as SaveV1;
    return { ...v1, v: 3, journal: inferProgress(v1), worldSeed: 0, genVersion: 1 };
  }
  return null;
}

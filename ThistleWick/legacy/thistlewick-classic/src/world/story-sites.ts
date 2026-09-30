/** Deterministic story landmarks for generator v3 and later. */
import { mulberry32 } from '../math';
import { fnv1a } from './seed';
import { WG } from './worldgen';

export interface StorySiteDef { id: 'listening' | 'door'; name: string; biome: number; minRadius: number; maxRadius: number; clearance: number }
export interface StorySite { id: StorySiteDef['id']; name: string; x: number; y: number; z: number; clearance: number }
export interface StorySiteState { found?: boolean; repaired?: boolean; repairedDay?: number; parts?: string[]; knocked?: boolean }

export const STORY_SITE_DEFS: StorySiteDef[] = [
  { id: 'listening', name: 'The Listening Stones', biome: WG.BIOME.MEADOW, minRadius: 90, maxRadius: 220, clearance: 6 },
  { id: 'door', name: 'The Door Without a House', biome: WG.BIOME.FOREST, minRadius: 60, maxRadius: 160, clearance: 6 }
];

function candidate(seed: number, def: StorySiteDef, attempt: number, maxRadius: number) {
  const random = mulberry32(fnv1a(seed + '|' + def.id + '|' + attempt));
  const angle = random() * Math.PI * 2;
  const radius = def.minRadius + Math.sqrt(random()) * (maxRadius - def.minRadius);
  return { x: Math.round(Math.cos(angle) * radius), z: Math.round(Math.sin(angle) * radius) };
}

function choose(seed: number, def: StorySiteDef, placed: StorySite[]): StorySite {
  let fallback: { x: number; z: number; slope: number } | null = null;
  for (let attempt = 0; attempt < 4096; attempt++) {
    const wider = attempt >= 2048, p = candidate(seed, def, attempt, wider ? 320 : def.maxRadius), t = WG.terr(p.x, p.z), slope = WG.slope(p.x, p.z);
    if (t.biome !== def.biome || t.h <= WG.SEA + 1 || placed.some(site => Math.hypot(site.x - p.x, site.z - p.z) < 50)) continue;
    if (!fallback || slope < fallback.slope) fallback = { ...p, slope };
    if (slope <= 1) return { id: def.id, name: def.name, x: p.x + 0.5, y: t.h, z: p.z + 0.5, clearance: def.clearance };
  }
  if (!fallback) throw new Error('No valid story site for ' + def.id);
  const t = WG.terr(fallback.x, fallback.z);
  return { id: def.id, name: def.name, x: fallback.x + 0.5, y: t.h, z: fallback.z + 0.5, clearance: def.clearance };
}

export function storySites(seed: number, genVersion: number): StorySite[] {
  if (genVersion < 3) return [];
  const sites: StorySite[] = [];
  for (const def of STORY_SITE_DEFS) sites.push(choose(seed, def, sites));
  return sites;
}

export const nearStorySite = (sites: readonly StorySite[], x: number, z: number, extra = 0) => sites.some(site => Math.hypot(site.x - x, site.z - z) < site.clearance + extra);

export function navigationTo(site: StorySite, x: number, z: number): string {
  const dx = site.x - x, dz = site.z - z, distance = Math.hypot(dx, dz);
  if (distance < 20) return 'very close';
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = (Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) + 8) % 8;
  return directions[index] + ' - about ' + Math.max(10, Math.round(distance / 10) * 10) + ' paces';
}

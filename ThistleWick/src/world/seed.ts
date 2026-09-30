/* World identity: which seed and which generator version built the world the player is standing in.
   Seed 0 is the original world and must stay bit-identical. Terrain hashes mix `salt.mix` into their per-layer salt.

   Generator versions
   1  original: scenery draws from one shared per-chunk random stream, so any edit to the scenery code
      reshuffles everything after it. Kept exactly as it was for saves made before versioning.
   2  persisted scenery (trees, rocks, ore, bushes, pickups) draws each spawn attempt from its own stream, so its
      identity survives edits elsewhere in the generator.
   3  story landmarks reserve deterministic clearings in newly generated worlds.

   Changing generation output for existing worlds means bumping GEN_VERSION and gating the change on it. */
export const GEN_VERSION = 3;

export const salt = { mix: 0 };
export const world = { seed: 0, genVersion: 1 };

export function mixSeed(seed: number) {
  if (!seed) return 0;
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h | 0 || 1;
}

export function fnv1a(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** A random non-zero seed for a new world. */
export function randomSeed() { return (Math.floor(Math.random() * 0xfffffffe) + 1) | 0; }

export function setWorldParams(seed: number, genVersion: number) {
  world.seed = seed | 0; world.genVersion = genVersion; salt.mix = mixSeed(world.seed);
}

/** Random stream for one spawn attempt of one kind in one chunk. Independent of every other attempt. */
export function attemptSeed(cx: number, cz: number, tag: string, a: number) {
  return fnv1a(salt.mix + '|' + cx + ',' + cz + ',' + tag + ',' + a);
}

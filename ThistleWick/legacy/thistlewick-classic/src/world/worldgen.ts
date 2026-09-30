/* Thistlewick world generation. Pure TypeScript, no dependencies, works in the browser and in node.
   Terrain, biomes, mountains, lakes, caves, ores and lava. Chunks are S x S columns, HL cells tall. */
import { salt, setWorldParams } from './seed';
const S = 40, JMIN = -32, JMAX = 88, HL = JMAX - JMIN, SEA = -3, LAVA_Y = -25, SS = S * S;
const B = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, IRON: 4, COAL: 5, BEDROCK: 6, SAND: 7, SANDSTONE: 8, SNOW: 9, GRAVEL: 10, MEADOW: 11, WATER: 12, LAVA: 13, CRYSTAL: 14, PLANK: 15, BRICK: 16 };
const BIOME = { FOREST: 0, MEADOW: 1, HIGHLAND: 2, DUNES: 3, MARSH: 4, PEAKS: 5 };
const BIOME_NAME = ['Autumn forest', 'Meadow', 'Highlands', 'Dunes', 'Marsh', 'Snowy peaks'];

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hash2(x: number, y: number, s?: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(((s || 0) | 0) ^ salt.mix, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
}
function hash3(x: number, y: number, z: number, s?: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1911520717) ^ Math.imul(((s || 0) | 0) ^ salt.mix, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function vnoise3(x: number, y: number, z: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const a = hash3(xi, yi, zi, s), b = hash3(xi + 1, yi, zi, s), c = hash3(xi, yi + 1, zi, s), d = hash3(xi + 1, yi + 1, zi, s);
  const e = hash3(xi, yi, zi + 1, s), f = hash3(xi + 1, yi, zi + 1, s), g = hash3(xi, yi + 1, zi + 1, s), h = hash3(xi + 1, yi + 1, zi + 1, s);
  const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (h - g) * u;
  const y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
  return y1 + (y2 - y1) * w;
}
function fbm(x: number, y: number, o: number, s: number) { let a = 0.5, f = 1, sum = 0; for (let i = 0; i < o; i++) { sum += a * vnoise(x * f, y * f, s + i * 7); f *= 2; a *= 0.5; } return sum; }

/* ---- terrain height and biome for a column, cached ---- */
const tc = new Map<number, { h: number; biome: number; mm: number }>();
function terr(i: number, k: number) {
  const kk = (i + 100000) * 200003 + (k + 100000); let t = tc.get(kk); if (t) return t;
  const x = i + 0.5, z = k + 0.5, r = Math.hypot(x, z), far = smooth(28, 95, r), near = smooth(5, 22, r);
  const hills = ((fbm(x * 0.016, z * 0.016, 3, 11) - 0.45) * 10 + (fbm(x * 0.07, z * 0.07, 2, 23) - 0.4) * 1.8) * near;
  const cont = (fbm(x * 0.0032 + 11, z * 0.0032 - 7, 3, 1) - 0.5) * 9 * far;
  const mm = smooth(0.5, 0.62, fbm(x * 0.0042 + 200, z * 0.0042 + 90, 3, 5)) * far;
  const ridge = 1 - Math.abs(2 * fbm(x * 0.011 + 50, z * 0.011 - 30, 4, 9) - 1);
  const mount = mm * (5 + 54 * Math.pow(ridge, 1.35));
  const wet = smooth(0.55, 0.67, fbm(x * 0.008 + 400, z * 0.008 + 300, 3, 13)) * far;
  let h = Math.round(hills + cont + mount - wet * 10);
  h = Math.max(JMIN + 8, Math.min(JMAX - 6, h));
  const temp = fbm(x * 0.004 + 900, z * 0.004 + 500, 2, 17), moist = fbm(x * 0.005 + 1300, z * 0.005 - 800, 2, 19);
  const snowLine = 30 + vnoise(x * 0.05, z * 0.05, 3) * 7;
  let biome = BIOME.FOREST;
  if (r < 50) biome = BIOME.FOREST;
  else if (h >= snowLine) biome = BIOME.PEAKS;
  else if (mm > 0.35 || h > 15) biome = BIOME.HIGHLAND;
  else if (temp > 0.47 && moist < 0.34) biome = BIOME.DUNES;
  else if (moist > 0.5) biome = BIOME.MARSH;
  else if (moist < 0.3) biome = BIOME.MEADOW;
  t = { h, biome, mm }; tc.set(kk, t); return t;
}
/** Switches the generator to another world. Terrain is cached per column, so the cache goes with the seed. */
function setWorld(seed: number, genVersion: number) { setWorldParams(seed, genVersion); tc.clear(); }
function slope(i: number, k: number) { const h = terr(i, k).h; return Math.max(Math.abs(h - terr(i + 1, k).h), Math.abs(h - terr(i - 1, k).h), Math.abs(h - terr(i, k + 1).h), Math.abs(h - terr(i, k - 1).h)); }

/* ---- caves: winding tunnels (two noise bands crossing) plus big chambers ---- */
function carve(i: number, j: number, k: number, d: number, cmask: number, ent: boolean, cheeseOn: boolean) {
  if (j <= JMIN + 3 || cmask <= 0) return false;
  if (d >= (ent ? 0 : 1)) {
    const a = vnoise3(i * 0.05, j * 0.04 + 13.7, k * 0.05, 71), b = vnoise3(i * 0.05 + 91, j * 0.04, k * 0.05 - 40, 72), tw = 0.06 * (0.6 + 0.5 * cmask);
    if (Math.abs(a - 0.5) < tw && Math.abs(b - 0.5) < tw) return true;
  }
  if (d >= 7 && cheeseOn) {
    const c = vnoise3(i * 0.06, j * 0.1, k * 0.06, 73) * 0.65 + vnoise3(i * 0.14, j * 0.2, k * 0.14, 74) * 0.35;
    if (c > 0.72 + 0.04 * (1 - cmask)) return true;
  }
  return false;
}

/* ---- a full chunk of blocks: index = (j - JMIN) * SS + lk * S + li ---- */
function genChunk(cx: number, cz: number) {
  const cflag = new Uint8Array(SS), i0 = cx * S - S / 2, k0 = cz * S - S / 2, data = new Uint8Array(SS * HL), hi = new Int16Array(SS), bio = new Uint8Array(SS), tops = new Int16Array(SS);
  for (let lk = 0; lk < S; lk++) for (let li = 0; li < S; li++) {
    const i = i0 + li, k = k0 + lk, col = lk * S + li, t = terr(i, k), h = t.h, sl = slope(i, k), b = t.biome, under = h <= SEA + 1;
    bio[col] = b; tops[col] = h;
    const r = Math.hypot(i + 0.5, k + 0.5), cmask = smooth(26, 52, r), ent = vnoise(i * 0.025, k * 0.025, 75) > 0.72;
    const gravelPatch = vnoise(i * 0.09, k * 0.09, 60) > 0.72;
    const cr = vnoise(i * 0.03, k * 0.03, 76), caveOn = cmask > 0 && cr > 0.4, cheeseOn = cr > 0.48, oreOn = vnoise(i * 0.04, k * 0.04, 90) > 0.36, gravOn = vnoise(i * 0.05, k * 0.05, 91) > 0.6;
    let topId = B.GRASS, subId = B.DIRT, subD = 3, sub2 = B.STONE, sub2D = 0;
    if (under) { topId = hash2(i, k, 5) < 0.3 ? B.GRAVEL : B.SAND; subId = B.SAND; subD = 2; }
    else if (b === BIOME.PEAKS) { topId = sl >= 3 ? B.STONE : B.SNOW; subId = B.STONE; subD = 0; }
    else if (b === BIOME.HIGHLAND) { if (sl >= 3) { topId = B.STONE; subId = B.STONE; subD = 0; } else if (sl === 2) { topId = hash2(i, k, 6) < 0.5 ? B.STONE : B.GRASS; subD = 2; } else { topId = gravelPatch ? B.GRAVEL : B.GRASS; subD = 2; } }
    else if (b === BIOME.DUNES) { topId = B.SAND; subId = B.SAND; subD = 3; sub2 = B.SANDSTONE; sub2D = 3; if (sl >= 4) { topId = B.SANDSTONE; subId = B.SANDSTONE; subD = 0; sub2D = 0; } }
    else if (b === BIOME.MARSH || b === BIOME.MEADOW) { topId = B.MEADOW; if (sl >= 4) { topId = B.STONE; subId = B.STONE; subD = 0; } }
    else { topId = B.GRASS; if (sl >= 4) { topId = B.STONE; subId = B.STONE; subD = 0; } }
    for (let j = JMIN; j < h; j++) {
      const d = h - 1 - j; let id: number;
      if (j === JMIN) id = B.BEDROCK;
      else if (j === JMIN + 1) id = hash3(i, j, k, 7) < 0.5 ? B.BEDROCK : B.STONE;
      else if (d === 0) id = topId;
      else if (d <= subD) id = subId;
      else if (d <= subD + sub2D) id = sub2;
      else {
        id = B.STONE;
        if (oreOn && d >= 2) { const n = vnoise3(i * 0.27, j * 0.27, k * 0.27, 81); if (n > 0.915 && d >= 8) id = B.IRON; else if (n > 0.86) id = B.COAL; }
        if (id === B.STONE && gravOn && d >= 3 && vnoise3(i * 0.13, j * 0.13, k * 0.13, 80) > 0.88) id = B.GRAVEL;
      }
      if (id !== B.BEDROCK && caveOn && (!under || d >= 8) && carve(i, j, k, d, cmask, ent, cheeseOn)) { id = j <= LAVA_Y ? B.LAVA : B.AIR; cflag[col] = 1; }
      data[(j - JMIN) * SS + col] = id;
    }
    if (h <= SEA) for (let j = Math.max(h, JMIN); j <= SEA; j++) data[(j - JMIN) * SS + col] = B.WATER;
    hi[col] = h <= SEA ? SEA : h - 1;
  }
  /* glowing crystals studded into cave walls */
  const near = new Uint8Array(SS);
  for (let col = 0; col < SS; col++) if (cflag[col]) { const lk = (col / S) | 0, li = col - lk * S; near[col] = 1; if (li > 0) near[col - 1] = 1; if (li < S - 1) near[col + 1] = 1; if (lk > 0) near[col - S] = 1; if (lk < S - 1) near[col + S] = 1; }
  for (let col = 0; col < SS; col++) {
    if (!near[col]) continue; const lk = (col / S) | 0, li = col - lk * S;
    for (let j = JMIN + 4; j <= hi[col]; j++) {
      const idx = (j - JMIN) * SS + col; if (data[idx] !== B.STONE || hash3(i0 + li, j, k0 + lk, 33) > 0.012) continue;
      if ((j > JMIN && data[idx - SS] === 0) || data[idx + SS] === 0 || (li > 0 && data[idx - 1] === 0) || (li < S - 1 && data[idx + 1] === 0) || (lk > 0 && data[idx - S] === 0) || (lk < S - 1 && data[idx + S] === 0)) data[idx] = B.CRYSTAL;
    }
  }
  return { cx, cz, data, hi, bio, tops };
}
export const WG = { S, JMIN, JMAX, HL, SS, SEA, LAVA_Y, B, BIOME, BIOME_NAME, terr, slope, genChunk, setWorld, smooth, hash2, hash3, vnoise, vnoise3, fbm };
export type WorldGen = typeof WG;
export type ChunkData = ReturnType<typeof genChunk>;
export type Terrain = ReturnType<typeof terr>;

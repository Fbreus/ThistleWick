import * as THREE from 'three';
import { WG } from './world/worldgen';
import { S, SS, RAD, SKY_RADIUS, HORIZON_RAD, TAU, DAY_LEN, TILE, REACH, PHGT, PRAD } from './constants';
import { createHorizon } from './render/horizon';
import { inSpawnSanctuary, beetlePursues, clearSight } from './systems/safety';
import { clamp, lerp, smooth, angDiff, hash2, mulberry32, vnoise, fbm } from './math';
import { $, ctx2d } from './dom';
import { renderer, scene, camera, hemi, sun, lantern, fireLights, U, composer, bloom, grade, view, canvas, tex, MAT } from './render/gfx';
import { G, mergeGeos, mat4 } from './render/geometry';
import type { Recipe, StationKind } from './items';
import type { Slot, Station, Edit, Chunk, MeshBuf, Reader, Rgb, SceneNode, Collider, Pickup, Instance, Enemy, Critter, Aim, ToolStats, Particle, Resident, StorySitePart } from './types';
import { createStorySave, migrateSave, type SaveV5, type StorySave } from './save';
import { createStore, localBackend, idbBackend, type Backend } from './storage';
import { encode, decode, compact, summarize, type WorldEvent, type Cause } from './systems/chronicle';
import { world, salt, GEN_VERSION, randomSeed, attemptSeed } from './world/seed';
import { ARCS, createProgress, record, nextStep, completedBy, arcProgress, stepDone } from './systems/journal';
import { logEntries, logCounts, discoveryName } from './systems/discoveries';
import { newTally, tallyAdd, dawnLines } from './systems/dawn';
import { BOSS_DAMAGE, BOSS_HP, BOSS_NAME, BOSS_SCALE, CHARGE_SPEED, WINDUP, damageMult, newBoss, shouldSpawn, speedOf, stepBoss } from './systems/boss';
import { RESIDENTS, candidateLines, newFriend, pickLine, presentFor, talk as talkStep, giveGift, tierOf, TIER_NAMES, type Friend } from './systems/dialogue';
import { QUESTS, acceptQuest, availableQuests, currentObjectives, currentStage, questById, questStatus, recordQuestEvent, residentConversation, type ConversationCue, type ItemCost } from './systems/quests';
import { LORE, loreById } from './systems/lore';
import { beetleWardRadius } from './systems/light';
import { findRoom, checkCottage, floorCells, startsNear, type Cell, type RoomQuery } from './systems/homestead';
import { STAGE_NAMES, advanceCrops, cropStage, grow, harvestYield, isRipe, isSoil, nearWater } from './systems/garden';
import type { ChunkData } from './world/worldgen';
import { ITEMS, BDEF, BLOCK, TL, SOLIDB, OPQ, BCOL, RECIPES, STN, TIERN, DMG, CHOP, MINE, DIGP, BLOCKR } from './items';
import { icon } from './icons';
import { insert, craftedPack, transfer, mergeOrSwap, splitStack, sortPack } from './systems/inventory';
import { harvestRule, harvestPower, harvestableScenery, BERRY_REGROW_SECONDS } from './systems/harvesting';
import type { WorldDrop } from './types';
import { sfx, initAudio, setMuted, audioState, audioReady, resumeAudio } from './audio';
import { navigationTo, nearStorySite, storySites as makeStorySites, type StorySite } from './world/story-sites';
const { ground, atlasTex, waterTex, glowWarm, glowRed, moteTex, shaftTex } = tex;
const { JMIN, JMAX, SEA, LAVA_Y, B, BIOME } = WG;
const dummy = new THREE.Object3D(), tmpN = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), yawQ = new THREE.Quaternion(), tiltQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3(1, 0, 0), tmpC = new THREE.Color();
const H = (x: number, z: number) => WG.terr(Math.floor(x), Math.floor(z)).h;
/* World data lives in WG (worldgen.js): chunks of 1x1x1 blocks with biomes, mountains, lakes and caves. */
function baseH(x: number, z: number, r: number) { return Math.min(H(x - r, z - r), H(x + r, z - r), H(x - r, z + r), H(x + r, z + r)); }
function N(x: number, z: number, out: THREE.Vector3) { return out.set(0, 1, 0); }

let story: StorySave = createStorySave(false), loreSites: StorySite[] = [];

/* ================= inventory ================= */
const inv: (Slot | null)[] = new Array(24).fill(null);
let sel = -1, swapFrom: number | null = null, uiOpen = false, paused = false, storageOpen: Station | null = null;
const bushReady: Record<string, number> = {};
const worldDrops: WorldDrop[] = [];
function addItem(id: string, n: number) {
  if (sel >= 0 && !inv[sel]) sel = -1;
  const left = insert(inv, { id, n, dur: ITEMS[id].dur });
  renderHot(); if (uiOpen) renderInv(); return left;
}
function countItem(id: string) { return inv.reduce((n, s) => n + (s?.id === id ? s.n : 0), 0); }
function removeItems(id: string, n: number) { for (let i = 23; i >= 0 && n > 0; i--) { const s = inv[i]; if (s?.id === id) { const t = Math.min(n, s.n); s.n -= t; n -= t; if (!s.n) inv[i] = null; } } }
function canHold(id: string, n: number) { return inv.reduce((room, s) => room + (!s ? ITEMS[id].stack : s.id === id ? ITEMS[id].stack - s.n : 0), 0) >= n; }
function bestShield() { let b: Slot | null = null; for (const s of inv) if (s && ITEMS[s.id].k === 'shield' && (!b || ITEMS[s.id].reduce! > ITEMS[b.id].reduce!)) b = s; return b; }
function refreshPack() { renderHot(); renderInv(); updateHeld(); }
function quickTransfer(i: number) {
  if (storageOpen?.contents) transfer(inv, i, storageOpen.contents);
  else {
    const a = i < 8 ? 8 : 0, b = i < 8 ? 24 : 8, target = inv.slice(a, b);
    transfer(inv, i, target); inv.splice(a, b - a, ...target);
  }
  swapFrom = null; refreshPack();
}
function slotEl(s: Slot | null, i: number, hot: boolean) {
  const el = document.createElement('button'); el.type = 'button'; el.className = 'slot' + (hot && i === sel ? ' sel' : '') + (swapFrom === i ? ' pick' : '');
  el.setAttribute('aria-label', s ? ITEMS[s.id].n + ', ' + s.n : 'Empty slot ' + (i + 1));
  if (hot) { const k = document.createElement('div'); k.className = 'k'; k.textContent = String(i + 1); el.appendChild(k); }
  if (s) {
    const im = document.createElement('img'); im.src = icon(s.id); im.alt = ''; el.appendChild(im); el.title = ITEMS[s.id].n;
    if (s.n > 1) { const n = document.createElement('div'); n.className = 'n'; n.textContent = String(s.n); el.appendChild(n); }
    const d = ITEMS[s.id]; if (d.dur) { const b = document.createElement('div'); b.className = 'd'; b.innerHTML = '<i style="width:' + Math.round(s.dur! / d.dur * 100) + '%"></i>'; el.appendChild(b); }
  }
  el.addEventListener('click', e => {
    if (hot && !uiOpen) { sel = i; renderHot(); updateHeld(); return; }
    if (e.shiftKey) { quickTransfer(i); return; }
    if (e.ctrlKey || e.metaKey) { if (!splitStack(inv, i)) toast('Splitting needs a stack and an empty slot', true); refreshPack(); return; }
    if (swapFrom === null) { if (s) swapFrom = i; } else { mergeOrSwap(inv, swapFrom, i); swapFrom = null; }
    refreshPack();
  });
  return el;
}
function renderHot() {
  const hb = $('hotbar'); hb.innerHTML = '';
  for (let i = 0; i < 8; i++) hb.appendChild(slotEl(inv[i], i, true));
  const s = inv[sel], d = s ? ITEMS[s.id] : null;
  $('heldName').textContent = d ? d.n + (d.k === 'food' ? ' · click to eat/use' : d.k === 'block' || d.k === 'station' ? ' · click to place' : ' · click to strike') : 'Hands · click to strike';
  $('handsBtn').classList.toggle('active', sel === -1);
}
function stationNear(t: string) {
  return stations.some(b => b.t === t && Math.hypot(b.i + 0.5 - P.x, b.k + 0.5 - P.z) < 7 && Math.abs(b.j - P.y) < 4);
}
function renderInv() {
  if (!uiOpen || $('inv').classList.contains('hidden')) return;
  const grid = $('grid'); grid.innerHTML = ''; for (let i = 0; i < 24; i++) grid.appendChild(slotEl(inv[i], i, false));
  $('chestPanel').classList.toggle('hidden', !storageOpen);
  if (storageOpen?.contents) {
    const cg = $('chestGrid'); cg.innerHTML = '';
    storageOpen.contents.forEach((slot, i) => {
      const button = document.createElement('button'); button.className = 'slot'; button.type = 'button';
      button.title = slot ? 'Take ' + ITEMS[slot.id].n : 'Empty chest slot'; button.setAttribute('aria-label', button.title);
      if (slot) button.innerHTML = '<img alt="" src="' + icon(slot.id) + '"><span class="n">' + slot.n + '</span>';
      button.onclick = () => { if (storageOpen?.contents) { transfer(storageOpen.contents, i, inv); refreshPack(); } }; cg.appendChild(button);
    });
  }
  const pills = $('pills'); pills.innerHTML = '';
  for (const [t, n] of [['bench', 'Workbench'], ['furnace', 'Furnace'], ['camp', 'Campfire']]) {
    const p = document.createElement('span'), on = stationNear(t); p.className = 'pill' + (on ? ' on' : ''); p.textContent = n + (on ? ' nearby' : ' not near'); pills.appendChild(p);
  }
  const goal = nextStep(progress)?.step.key;
  $('craftHint').textContent = goal === 'craft:workbench' ? 'Workbench: 2 wood → 4 planks → 1 workbench. Select it, then click the ground to place.' : 'Cooking uses a stick as fuel. Grown roots make the most filling meals.';
  const list = $('recipes'), keep = list.scrollTop; list.innerHTML = ''; let cat = '';
  const filter = ($('recipeCategory') as HTMLSelectElement).value, only = ($('craftableOnly') as HTMLInputElement).checked;
  const batch = Number(($('craftBatch') as HTMLSelectElement).value) || 1;
  for (const r of RECIPES) {
    if ((r.unlock && !story.recipes.includes(r.unlock)) || (filter && r.cat !== filter)) continue;
    const stOK = !r.st || stationNear(r.st), ready = stOK && !!craftedPack(inv, r, batch); if (only && !ready) continue;
    if (r.cat !== cat) { cat = r.cat; const h = document.createElement('h3'); h.textContent = cat; list.appendChild(h); }
    let txt = ''; for (const k in r.in) { const have = countItem(k), need = r.in[k] * batch; txt += '<i class="' + (have >= need ? 'have' : 'lack') + '">' + ITEMS[k].n + ' ' + have + '/' + need + '</i>'; }
    if (r.st) txt += '<i class="' + (stOK ? 'have' : 'lack') + '">needs ' + STN[r.st] + '</i>';
    const row = document.createElement('div'); row.className = 'rec' + (ready ? ' ok' : '');
    row.innerHTML = '<img alt="" src="' + icon(r.out) + '"><div class="rt"><b>' + ITEMS[r.out].n + ' ×' + r.n * batch + '</b><span>' + txt + '</span></div>';
    const b = document.createElement('button'); b.textContent = 'Craft'; b.disabled = !ready; b.onclick = () => craft(r, batch); row.appendChild(b); list.appendChild(row);
  }
  if (!list.children.length) list.textContent = 'No recipes match. Try another category or turn off Craftable now.';
  list.scrollTop = keep;
}
function craft(r: Recipe, batches = 1) {
  if ((r.st && !stationNear(r.st)) || (r.unlock && !story.recipes.includes(r.unlock))) return;
  const next = craftedPack(inv, r, batches); if (!next) { toast('Not enough materials or pack space', true); return; }
  if (sel >= 0 && !inv[sel]) sel = -1;
  inv.splice(0, inv.length, ...next); tallyAdd(tally, 'crafted', r.out, r.n * batches); note('craft:' + r.out); note('got:' + r.out); sfx.craft(); toast('Crafted ' + ITEMS[r.out].n + ' ×' + r.n * batches, false, 1400); refreshPack();
  if (r.out.endsWith('shovel')) tip('shovel', 'A shovel digs soil and harvests rooted plants faster.');
  if (r.out === 'workbench') tip('bench', 'Select and place the workbench, then craft tools next to it.');
}
function clearInput() { for (const k in keys) keys[k] = false; mouseHeld = false; touchBlock = false; P.swing = 0; P.swingHit = true; }
function toggleInv(force?: boolean) {
  if (journalOpen) toggleJournal(false);
  uiOpen = force !== undefined ? force : !uiOpen;
  $('inv').classList.toggle('hidden', !uiOpen); swapFrom = null;
  if (!uiOpen) storageOpen = null;
  else { document.exitPointerLock?.(); clearInput(); }
  renderInv(); renderHot();
}
function setPaused(value: boolean) {
  paused = value; $('pause').classList.toggle('hidden', !paused); clearInput();
  if (paused) { document.exitPointerLock?.(); saveGame(); }
}
function dropSlot(slot: Slot, x = P.x, y = P.y, z = P.z) {
  const existing = worldDrops.find(d => d.slot.id === slot.id && d.slot.dur === slot.dur && Math.hypot(d.x - x, d.z - z) < 0.6 && Math.abs(d.y - y) < 1);
  if (existing && ITEMS[slot.id].stack > 1) { existing.slot.n += slot.n; return; }
  const mesh = new THREE.Mesh(dropGeometry, dropMaterial); mesh.position.set(x, y + 0.3, z); scene.add(mesh);
  worldDrops.push({ x, y, z, slot: { ...slot }, mesh });
}
const dropGeometry = new THREE.OctahedronGeometry(0.24), dropMaterial = new THREE.MeshStandardMaterial({ color: 0xf2b134, emissive: 0x604015, roughness: 0.8 });
function takeDrop(drop: WorldDrop) {
  if (!worldDrops.includes(drop)) return;
  const left = insert(inv, drop.slot), gained = drop.slot.n - left; drop.slot.n = left;
  if (gained) { note('got:' + drop.slot.id); sfx.pickup(); toast('Recovered ' + gained + ' ' + ITEMS[drop.slot.id].n); }
  if (!left) { scene.remove(drop.mesh); worldDrops.splice(worldDrops.indexOf(drop), 1); stopHarvest(); }
  else toast('Make room in your pack to recover the rest', true);
  refreshPack();
}
function dropSelected() {
  const i = swapFrom ?? sel, slot = inv[i]; if (!slot) return;
  dropSlot(slot); inv[i] = null; swapFrom = null; refreshPack(); toast('Left on the ground. Aim at the gold bundle and press E to recover.');
}

/* ================= blocks, stations and the voxel world ================= */
const blocks = new Map<string, Station>(), stations: Station[] = [];   // stations and torches only; terrain and placed cubes are voxels in the chunk data
const key = (i: number, j: number, k: number) => i + ',' + j + ',' + k;
const chunkData = new Map<string, ChunkData>(), edits = new Map<string, Edit>();
function cdata(cx: number, cz: number) { const k = cx + ',' + cz; let d = chunkData.get(k); if (!d) { d = WG.genChunk(cx, cz); chunkData.set(k, d); } return d; }
let gcx = 1e9, gcz = 1e9, gd: Uint8Array | null = null;
function getBlock(i: number, j: number, k: number) {
  if (j < JMIN) return B.BEDROCK; if (j >= JMAX) return 0;
  const cx = Math.floor((i + S / 2) / S), cz = Math.floor((k + S / 2) / S);
  if (cx !== gcx || cz !== gcz) { gd = cdata(cx, cz).data; gcx = cx; gcz = cz; }
  return gd![(j - JMIN) * SS + (k - (cz * S - S / 2)) * S + (i - (cx * S - S / 2))];
}
/** Every terrain change, oldest first. The edits map is the replayed current state; this is the history behind it. */
let chronicle: WorldEvent[] = [];
const sinceDawn: WorldEvent[] = [];   // what changed since the player last slept, for the dawn card
const MAX_EVENTS = 60000;
/** Changes a voxel without recording it: used when replaying a saved chronicle. */
function applyVox(i: number, j: number, k: number, id: number) {
  if (j < JMIN || j >= JMAX) return;
  const cx = Math.floor((i + S / 2) / S), cz = Math.floor((k + S / 2) / S), d = cdata(cx, cz), li = i - (cx * S - S / 2), lk = k - (cz * S - S / 2);
  d.data[(j - JMIN) * SS + lk * S + li] = id; if (id !== 0 && j > d.hi[lk * S + li]) d.hi[lk * S + li] = j; edits.set(key(i, j, k), { i, j, k, id });
  for (let di = (li === 0 ? -1 : 0); di <= (li === S - 1 ? 1 : 0); di++) for (let dk = (lk === 0 ? -1 : 0); dk <= (lk === S - 1 ? 1 : 0); dk++) { const ch = chunks.get((cx + di) + ',' + (cz + dk)); if (ch) ch.dirty = true; }
}
function setVox(i: number, j: number, k: number, id: number, cause?: Cause) {
  if (j < JMIN || j >= JMAX) return;
  applyVox(i, j, k, id);
  const e: WorldEvent = { day: Math.floor(todT / DAY_LEN) + 1, cause: cause ?? (id === 0 ? 'dug' : 'placed'), i, j, k, id };
  chronicle.push(e); sinceDawn.push(e);
}
function solid(i: number, j: number, k: number) { if (SOLIDB[getBlock(i, j, k)]) return true; if (blocks.size) { const b = blocks.get(key(i, j, k)); return !!b && !b.ns; } return false; }
/* standing height of a column: first free cell above solid ground, honouring dug holes and built blocks */
function surf(x: number, z: number) { const i = Math.floor(x), k = Math.floor(z); let j = WG.terr(i, k).h; if (solid(i, j, k)) { while (solid(i, j, k) && j < JMAX - 1) j++; return j; } while (j > JMIN && !solid(i, j - 1, k)) j--; return j; }
function floorY(x: number, z: number, y: number) { const i = Math.floor(x), k = Math.floor(z); let j = Math.floor(y + 1.2); while (j > JMIN && !solid(i, j - 1, k)) j--; return j; }

function buildStation(t: string) {
  const g = new THREE.Group(), std = (c: number, r?: number, m?: number) => new THREE.MeshStandardMaterial({ color: c, roughness: r === undefined ? 0.85 : r, metalness: m || 0 });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; g.add(b); return b; };
  if (t === 'bench') {
    const wood = std(0xb98450), dark = std(0x6b4526);
    box(0.96, 0.14, 0.96, wood, 0, 0.85, 0); for (const [x, z] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) box(0.12, 0.82, 0.12, dark, x, 0.41, z);
    box(0.8, 0.06, 0.06, dark, 0, 0.3, 0.38); box(0.8, 0.06, 0.06, dark, 0, 0.3, -0.38);
    box(0.36, 0.05, 0.12, std(0x9aa0a8, 0.4, 0.7), -0.2, 0.945, 0.15); box(0.06, 0.16, 0.06, dark, 0.22, 0.99, -0.2).rotation.z = 0.2;
    box(0.22, 0.14, 0.22, std(0x8d5a2a), 0.25, 0.99, 0.25);
  } else if (t === 'chest') {
    const wood = std(0x956037), iron = std(0x443c32, 0.6, 0.3);
    box(0.9, 0.58, 0.75, wood, 0, 0.29, 0); box(0.94, 0.12, 0.79, wood, 0, 0.64, 0);
    for (const x of [-0.3, 0.3]) box(0.07, 0.7, 0.8, iron, x, 0.35, 0);
    box(0.13, 0.16, 0.05, std(0xe0b550), 0, 0.5, 0.41);
  } else if (t === 'furnace') {
    const st = std(0x86888d, 0.95); box(0.98, 0.98, 0.98, st, 0, 0.49, 0); box(0.4, 0.4, 0.4, std(0x76787d), 0.25, 1.18, -0.2);
    box(0.5, 0.42, 0.06, std(0x14100e), 0, 0.42, 0.48); const glow = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.26, 0.04), new THREE.MeshBasicMaterial({ color: 0xff8a2a })); glow.position.set(0, 0.36, 0.5); g.add(glow); g.userData.glow = glow;
  } else if (t === 'camp') {
    const log = std(0x5a3a1e), stone = std(0x7d7f83, 0.95);
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), stone); m.position.set(Math.cos(a) * 0.42, 0.1, Math.sin(a) * 0.42); m.scale.y = 0.7; m.castShadow = true; g.add(m); }
    for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.75, 6), log); l.position.y = 0.15; l.rotation.set(Math.PI / 2 - 0.25, i * 2.1, 0); l.castShadow = true; g.add(l); }
    const fm = new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const f1 = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.62, 7), fm), f2 = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    f1.position.y = 0.42; f2.position.y = 0.36; g.add(f1); g.add(f2); g.userData.flames = [f1, f2];
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowWarm, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 })); sp.scale.setScalar(2.4); sp.position.y = 0.5; g.add(sp); g.userData.glowSp = sp;
  } else if (t === 'ladder') {
    const wd = std(0x9a6a3a); for (const sx of [-0.3, 0.3]) box(0.07, 1.0, 0.07, wd, sx, 0.5, -0.44); for (let q = 0; q < 4; q++) box(0.6, 0.06, 0.06, wd, 0, 0.15 + q * 0.24, -0.44);
  } else if (t === 'torch') {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.7, 6), std(0x6b4526)); stick.position.y = 0.35; stick.castShadow = true; g.add(stick);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 6), new THREE.MeshBasicMaterial({ color: 0xffc060, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })); fl.position.y = 0.86; g.add(fl); g.userData.flames = [fl, fl];
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowWarm, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9 })); sp.scale.setScalar(1.2); sp.position.y = 0.88; g.add(sp); g.userData.glowSp = sp;
  } else if (t === 'lantern') {
    const iron = std(0x555b60, 0.35, 0.8), warm = std(0x8a5a2a, 0.7), crystal = new THREE.MeshStandardMaterial({ color: 0x9defff, emissive: 0x36b8d8, emissiveIntensity: 1.5, roughness: 0.25 });
    box(0.5, 0.08, 0.5, iron, 0, 0.08, 0); box(0.42, 0.08, 0.42, warm, 0, 0.72, 0);
    for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) box(0.045, 0.62, 0.045, iron, x, 0.4, z);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), crystal); core.position.y = 0.4; g.add(core); g.userData.core = core;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 16), iron); ring.position.y = 0.86; ring.rotation.x = Math.PI / 2; g.add(ring);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowWarm, color: 0x70e8ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 })); sp.scale.setScalar(2.2); sp.position.y = 0.42; g.add(sp); g.userData.glowSp = sp;
  } else if (t === 'door') {
    const pivot = new THREE.Group(); pivot.position.set(-0.5, 0, 0); g.add(pivot);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.1), std(0x9a6a3a)); panel.position.set(0.5, 0.95, 0); panel.castShadow = true; panel.receiveShadow = true; pivot.add(panel);
    for (const y of [0.35, 1.55]) { const band = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.12), std(0x6b4526)); band.position.set(0.5, y, 0); pivot.add(band); }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), std(0xd9b04a, 0.3, 0.7)); knob.position.set(0.85, 0.95, 0.09); pivot.add(knob);
    g.userData.pivot = pivot;
  } else if (t === 'bed') {
    box(0.98, 0.3, 0.98, std(0x8a5a2a), 0, 0.15, 0); box(0.92, 0.18, 0.92, std(0xd9d2c0), 0, 0.39, 0); box(0.92, 0.1, 0.6, std(0xb7362d), 0, 0.5, -0.16); box(0.7, 0.14, 0.26, std(0xf4efe4), 0, 0.53, 0.34);
  }
  return g;
}
/** Rebuilds a crop's little model when its growth stage changes. */
const cropMat = { mound: new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 1 }), leaf: new THREE.MeshStandardMaterial({ color: 0x4f8f2c, roughness: 0.9 }), leaf2: new THREE.MeshStandardMaterial({ color: 0x6fb03a, roughness: 0.9 }), root: new THREE.MeshStandardMaterial({ color: 0x8a4f9e, roughness: 0.6, emissive: 0x2a1030 }) };
function setCropVisual(b: Station) {
  const o = b.obj; if (!o) return;
  const stage = cropStage(b.growth ?? 0); if (o.userData.stage === stage) return; o.userData.stage = stage;
  for (const c of o.children.slice()) { o.remove(c); (c as THREE.Mesh).geometry.dispose(); }
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) => { const q = new THREE.Mesh(geo, m); q.position.set(x, y, z); q.rotation.set(rx, 0, rz); q.castShadow = true; o.add(q); };
  add(new THREE.CylinderGeometry(0.3, 0.38, 0.1, 8), cropMat.mound, 0, 0.05, 0);
  if (stage === 0) { add(new THREE.SphereGeometry(0.06, 6, 5), cropMat.leaf2, 0, 0.12, 0); return; }
  const n = stage === 1 ? 2 : stage === 2 ? 4 : 5, h = stage === 1 ? 0.28 : stage === 2 ? 0.5 : 0.62;
  for (let q = 0; q < n; q++) { const a = q / n * TAU + 0.4; add(new THREE.ConeGeometry(0.07, h, 5), q % 2 ? cropMat.leaf : cropMat.leaf2, Math.cos(a) * 0.1, 0.1 + h / 2, Math.sin(a) * 0.1, Math.sin(a) * 0.3, -Math.cos(a) * 0.3); }
  if (stage === 3) add(new THREE.SphereGeometry(0.15, 8, 6), cropMat.root, 0, 0.16, 0);
}
/** Doors are two blocks tall: the bottom station owns the model, the top is a linked marker so both cells block movement. */
function toggleDoor(b: Station) {
  b.open = !b.open; b.ns = b.open; if (b.top) b.top.ns = b.open;
  if (b.obj) (b.obj.userData.pivot as THREE.Group).rotation.y = b.open ? -Math.PI / 2 : 0;
  sfx.place();
}
/** Crops are stations that cannot be walked into, so they reuse placement, aiming and breaking. */
function cropStations() { return stations.filter(b => b.t === 'crop'); }
function harvestCrop(b: Station) {
  stopHarvest(); const ripe = isRipe(b.growth ?? 0); removeStation(b); sfx.pickup(); burst(b.i + 0.5, b.j + 0.4, b.k + 0.5, ripe ? 0x8a4f9e : 0x6fb03a, 6);
  if (ripe) { const y = harvestYield(Math.random); giveItem('root', y.root); giveItem('seed', y.seed); } else giveItem('seed', 1);
}
function placeStation(i: number, j: number, k: number, t: StationKind, growth = 0) {
  const b: Station = { t, i, j, k, hp: BDEF[t].hp, obj: null, ns: !!BDEF[t].ns }; blocks.set(key(i, j, k), b);
  const o = buildStation(t); o.position.set(i + 0.5, j, k + 0.5); o.rotation.y = Math.round(Math.atan2(P.x - (i + 0.5), P.z - (k + 0.5)) / (Math.PI / 2)) * Math.PI / 2; scene.add(o); b.obj = o; stations.push(b);
  if (t === 'chest') b.contents = new Array(24).fill(null);
  if (t === 'crop') { b.growth = growth; b.wet = nearWater(getBlock, i, j, k); setCropVisual(b); }
  if (t === 'door') { const top: Station = { t: 'door', i, j: j + 1, k, hp: b.hp, obj: null, ns: false, link: b }; b.top = top; b.open = false; blocks.set(key(i, j + 1, k), top); }
  return b;
}
function removeStation(b0: Station) { const b = b0.link ?? b0; blocks.delete(key(b.i, b.j, b.k)); if (b.top) blocks.delete(key(b.top.i, b.top.j, b.top.k)); if (b.obj) scene.remove(b.obj); const ix = stations.indexOf(b); if (ix >= 0) stations.splice(ix, 1); }
function pushFromBlocks(o: { x: number; z: number }, r: number, yb: number, yt: number) {
  const i0 = Math.floor(o.x - r), i1 = Math.floor(o.x + r), k0 = Math.floor(o.z - r), k1 = Math.floor(o.z + r), j0 = Math.floor(yb), j1 = Math.floor(yt - 0.001);
  for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) {
    if (!solid(i, j, k)) continue;
    const cx = clamp(o.x, i, i + 1), cz = clamp(o.z, k, k + 1), dx = o.x - cx, dz = o.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) { const d = Math.sqrt(d2); o.x = cx + dx / d * r; o.z = cz + dz / d * r; }
      else { const lx = o.x - i, rx = i + 1 - o.x, lz = o.z - k, rz = k + 1 - o.z, m = Math.min(lx, rx, lz, rz); if (m === lx) o.x = i - r; else if (m === rx) o.x = i + 1 + r; else if (m === lz) o.z = k - r; else o.z = k + 1 + r; }
    }
  }
}
function surfaceY(x: number, z: number, yRef: number) {
  let s = JMIN; const r = 0.38, jmax = Math.floor(yRef - 0.4 + 1e-4);
  for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++) for (let k = Math.floor(z - r); k <= Math.floor(z + r); k++) {
    const cx = clamp(x, i, i + 1), cz = clamp(z, k, k + 1); if ((x - cx) * (x - cx) + (z - cz) * (z - cz) > r * r) continue;
    for (let j = jmax; j >= JMIN - 1; j--) if (solid(i, j, k)) { s = Math.max(s, j + 1); break; }
  }
  return s;
}
function ceilingAt(x: number, z: number, y0: number, y1: number) {
  const r = 0.36;
  for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++) for (let k = Math.floor(z - r); k <= Math.floor(z + r); k++)
    for (let j = Math.floor(y0); j <= Math.floor(y1); j++) if (j >= y0 - 1e-3 && solid(i, j, k)) return j;
  return null;
}

/* ================= voxel meshing: hidden faces removed, ambient occlusion per vertex ================= */
const FD = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] }, { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] }, { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] }, { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }
];
const UNIT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], AXES = [0, 0, 1, 1, 2, 2], AO_LV = [0.5, 0.68, 0.84, 1];
const BTINT = [[1, 1, 1], [0.86, 1.1, 0.62], [0.82, 0.98, 0.78], [1, 1, 1], [0.58, 0.8, 0.58], [1, 1, 1]];
const TRECT: number[][] = []; for (let t = 0; t < 24; t++) { const col = t % 8, row = (t / 8) | 0; TRECT.push([col / 8 + 0.004, (col + 1) / 8 - 0.004, 1 - (row + 1) / 3 + 0.004, 1 - row / 3 - 0.004]); }
function makeReader(cx: number, cz: number): Reader {
  const arr: Uint8Array[] = []; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) arr.push(cdata(cx + dx, cz + dz).data);
  const i0 = cx * S - S / 2, k0 = cz * S - S / 2;
  return (i: number, j: number, k: number) => {
    if (j < JMIN) return B.BEDROCK; if (j >= JMAX) return 0;
    const a = i - i0, c = k - k0, ax = a < 0 ? 0 : a >= S ? 2 : 1, ac = c < 0 ? 0 : c >= S ? 2 : 1;
    return arr[ax * 3 + ac][(j - JMIN) * SS + (c - (ac - 1) * S) * S + (a - (ax - 1) * S)];
  };
}
const newBk = (): MeshBuf => ({ p: [], n: [], u: [], c: [], i: [] });
function aoOf(rd: Reader, i: number, j: number, k: number, dir: number) {
  const f = FD[dir], ax = AXES[dir], ta = (ax + 1) % 3, tb = (ax + 2) % 3, fx = i + f.n[0], fy = j + f.n[1], fz = k + f.n[2], ea = UNIT[ta], eb = UNIT[tb], out = [0, 0, 0, 0];
  for (let q = 0; q < 4; q++) {
    const c = f.c[q], sa = c[ta] * 2 - 1, sb = c[tb] * 2 - 1;
    const s1 = OPQ[rd(fx + ea[0] * sa, fy + ea[1] * sa, fz + ea[2] * sa)] ? 1 : 0, s2 = OPQ[rd(fx + eb[0] * sb, fy + eb[1] * sb, fz + eb[2] * sb)] ? 1 : 0;
    const s3 = OPQ[rd(fx + ea[0] * sa + eb[0] * sb, fy + ea[1] * sa + eb[1] * sb, fz + ea[2] * sa + eb[2] * sb)] ? 1 : 0;
    out[q] = s1 && s2 ? 0 : 3 - (s1 + s2 + s3);
  }
  return out;
}
function pushQuad(Bk: MeshBuf, i: number, j: number, k: number, dir: number, uv: number[][], r: number, g: number, b: number, ao: number[] | null, ys: number) {
  const f = FD[dir], base = Bk.p.length / 3;
  for (let q = 0; q < 4; q++) {
    const c = f.c[q], sh = ao ? AO_LV[ao[q]] : 1;
    Bk.p.push(i + c[0], j + c[1] * ys, k + c[2]); Bk.n.push(f.n[0], f.n[1], f.n[2]); Bk.c.push(r * sh, g * sh, b * sh); Bk.u.push(uv[q][0], uv[q][1]);
  }
  if (ao && ao[1] + ao[3] > ao[0] + ao[2]) Bk.i.push(base + 1, base + 2, base + 3, base + 1, base + 3, base); else Bk.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function buildGround(ch: Chunk) {
  const cx = ch.cx, cz = ch.cz, i0 = cx * S - S / 2, k0 = cz * S - S / 2, rd = makeReader(cx, cz), cd = cdata(cx, cz), data = cd.data;
  const bk = { top: newBk(), atlas: newBk(), glow: newBk(), water: newBk() };
  for (let lk = 0; lk < S; lk++) for (let li = 0; li < S; li++) {
    const col = lk * S + li, i = i0 + li, k = k0 + lk, bt = BTINT[cd.bio[col]], hiJ = cd.hi[col], cvar = 0.94 + hash2(i, k, 9) * 0.12;
    let mossC: Rgb | null = null;
    for (let j = JMIN; j <= hiJ; j++) {
      const id = data[(j - JMIN) * SS + col]; if (id === 0) continue;
      const bd = BLOCK[id];
      if (bd.mesh === 'water') {
        for (let dir = 0; dir < 6; dir++) {
          if (dir === 3) continue; const f = FD[dir]; if (rd(i + f.n[0], j + f.n[1], k + f.n[2]) !== 0) continue;
          const uv: number[][] = []; for (let q = 0; q < 4; q++) { const c = f.c[q]; uv.push([(i + c[0]) / 5, (k + c[2]) / 5]); }
          pushQuad(bk.water, i, j, k, dir, uv, 1, 1, 1, null, 0.9);
        }
        continue;
      }
      for (let dir = 0; dir < 6; dir++) {
        const f = FD[dir], nb = rd(i + f.n[0], j + f.n[1], k + f.n[2]);
        if (id === B.LAVA ? !(nb === 0 || nb === B.WATER) : OPQ[nb]) continue;
        const green = id === B.GRASS || id === B.MEADOW, r = green ? bt[0] * cvar : 1, g = green ? bt[1] * cvar : 1, b = green ? bt[2] * cvar : 1;
        const ao = bd.mesh === 'atlas' ? aoOf(rd, i, j, k, dir) : null;
        if (id === B.GRASS && dir === 2) {
          if (!mossC) { const x = i + 0.5, z = k + 0.5, moss = smooth(0.48, 0.68, fbm(x * 0.045, z * 0.045, 3, 31)), dm = (0.85 + fbm(x * 0.12, z * 0.12, 2, 41) * 0.35) * cvar; mossC = [lerp(1, 0.62, moss) * dm * bt[0], lerp(0.93, 1, moss) * dm * bt[1], lerp(0.82, 0.58, moss) * dm * bt[2]]; }
          pushQuad(bk.top, i, j, k, dir, [[i / TILE, (k + 1) / TILE], [(i + 1) / TILE, (k + 1) / TILE], [(i + 1) / TILE, k / TILE], [i / TILE, k / TILE]], mossC[0], mossC[1], mossC[2], ao, 1);
        } else {
          const u = TRECT[dir === 2 ? bd.top : dir === 3 ? bd.bot : bd.side];
          pushQuad(bd.mesh === 'glow' ? bk.glow : bk.atlas, i, j, k, dir, [[u[0], u[2]], [u[1], u[2]], [u[1], u[3]], [u[0], u[3]]], r, g, b, ao, 1);
        }
      }
    }
  }
  const mk = (Bk: MeshBuf, mat: THREE.Material, old: THREE.Mesh | null, cast: boolean, order?: number): THREE.Mesh | null => {
    if (!Bk.p.length) { if (old) { old.geometry.dispose(); ch.grp.remove(old); } return null; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(Bk.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Bk.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(Bk.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(Bk.c, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(Bk.i), 1));
    if (old) { old.geometry.dispose(); old.geometry = g; return old; }
    const m = new THREE.Mesh(g, mat); m.castShadow = cast; m.receiveShadow = cast; if (order) m.renderOrder = order; ch.grp.add(m); return m;
  };
  ch.gm.top = mk(bk.top, MAT.ground, ch.gm.top, true); ch.gm.atlas = mk(bk.atlas, MAT.voxel, ch.gm.atlas, true);
  ch.gm.glow = mk(bk.glow, MAT.glow, ch.gm.glow, false); ch.gm.water = mk(bk.water, MAT.water, ch.gm.water, false, 2);
}

/* ================= chunks: scenery, nodes and pickups on top of the voxel meshes ================= */
const deadNodes = new Set<string>(), nk = (n: SceneNode) => n.key ?? n.x.toFixed(1) + ',' + n.z.toFixed(1);
const chunks = new Map<string, Chunk>(), collected = new Set<string>(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const horizon = createHorizon(scene);
const GT = [[1, 1, 1], [0.9, 1.25, 0.72], [0.85, 1.0, 0.85], [1.3, 1.1, 0.6], [0.65, 0.92, 0.6], [1, 1, 1]];
/* weight per biome: forest, meadow, highland, dunes, marsh, peaks */
const W = {
  giant: [0.6, 0.1, 0.2, 0, 0.25, 0], log: [0.5, 0.15, 0.2, 0, 0.3, 0], tree: [1, 0.22, 0.8, 0, 0.32, 0], cactus: [0, 0, 0, 0.75, 0, 0], rock: [1, 0.6, 1.6, 1.2, 0.5, 1.5], ore: [0.4, 0.3, 0.6, 0.3, 0.15, 0.7], bush: [1, 1.6, 0.4, 0, 1.2, 0],
  decoRock: [1, 0.7, 1.8, 1.3, 0.5, 1.6], mush: [1, 0.2, 0.2, 0, 1.8, 0], fern: [1, 0.35, 0.5, 0, 1.2, 0], leaf: [1, 0.08, 0.05, 0, 0.4, 0], twig: [1, 0.3, 0.6, 0.2, 0.4, 0], flower: [0.6, 1.7, 0.1, 0, 0.5, 0], grass: [1, 1.4, 0.6, 0.15, 1.1, 0],
  pebble: [1, 1, 2, 1, 0.6, 2], stick: [1, 0.4, 0.7, 0.3, 0.6, 0.1], fiber: [1, 1.6, 0.5, 0.3, 1.4, 0], mushPick: [1, 0.2, 0.2, 0, 1.6, 0]
};
function changedTop(i: number, k: number, h: number) { return !SOLIDB[getBlock(i, h - 1, k)] || getBlock(i, h, k) !== 0; }
function genChunk(cx: number, cz: number) {
  const chunkR = mulberry32(Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ 0x9e3779b9 ^ salt.mix);
  /* generator v2: each spawn attempt of a persisted kind draws from its own stream, so ids survive edits elsewhere in this function */
  let R = chunkR; const v2 = world.genVersion >= 2;
  const attempt = (tag: string, a: number) => { if (v2) R = mulberry32(attemptSeed(cx, cz, tag, a)); };
  const spawnKey = (tag: string, a: number) => v2 ? cx + ',' + cz + ',' + tag + a : undefined;
  const x0 = cx * S - S / 2, z0 = cz * S - S / 2, grp = new THREE.Group();
  const ch: Chunk = { cx, cz, grp, col: [], nodes: [], picks: [], disp: [], scen: [], dirty: false, gm: { top: null, atlas: null, glow: null, water: null } };
  const rx = () => x0 + R() * S, rz = () => z0 + R() * S, home = (x: number, z: number, r: number) => Math.hypot(x, z) < r;
  const bioAt = (x: number, z: number) => WG.terr(Math.floor(x), Math.floor(z)).biome;
  const wOK = (w: number[], x: number, z: number) => R() < w[bioAt(x, z)];
  const walk = (x: number, z: number) => { const i = Math.floor(x), k = Math.floor(z), t = WG.terr(i, k); return t.h > SEA + 1 && WG.slope(i, k) < 3; };
  const blocked = (x: number, z: number, pad: number) => { if (!walk(x, z) || (world.genVersion >= 3 && nearStorySite(loreSites, x, z, pad))) return true; for (const c of ch.col) if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true; return false; };
  const align = (x: number, z: number, yaw: number, off: number, sx: number, sy: number, sz: number) => { dummy.quaternion.setFromAxisAngle(UP, yaw); dummy.position.set(x, H(x, z) + off, z); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); return dummy.matrix.clone(); };
  const flush = (list: Instance[], geo: THREE.BufferGeometry, mat: THREE.Material, cast: boolean, resource?: { tag: string; item: string; label: string; seed?: boolean }) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length); m.frustumCulled = false; m.castShadow = !!cast; m.receiveShadow = true;
    for (let i = 0; i < list.length; i++) { m.setMatrixAt(i, list[i].m); tmpC.setRGB(list[i].r, list[i].g, list[i].b); m.setColorAt(i, tmpC); }
    if (resource) {
      geo.computeBoundingBox();
      for (let idx = 0; idx < list.length; idx++) {
        const matrix = list[idx].m, bounds = geo.boundingBox!.clone().applyMatrix4(matrix);
        const id = `${cx},${cz},scenery:${resource.tag}:${idx}`, dead = collected.has(id);
        if (!harvestableScenery(resource.tag, hash2(matrix.elements[12], matrix.elements[14], 921), world.genVersion)) continue;
        if (world.genVersion >= 4 && (resource.tag === 'grass' || resource.tag === 'leaf')) m.setColorAt(idx, new THREE.Color(1.7, 1.4, 0.65));
        ch.picks.push({ x: matrix.elements[12], z: matrix.elements[14], y: bounds.min.y, h: Math.max(0.25, bounds.max.y - bounds.min.y), r: Math.max(0.18, Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) / 2), item: resource.item, label: resource.label, seed: resource.seed, id, dead, manual: true, mesh: m, idx });
        if (dead) m.setMatrixAt(idx, ZERO);
      }
    }
    m.instanceMatrix.needsUpdate = true; m.instanceColor!.needsUpdate = true; grp.add(m); ch.disp.push(m);
    const xz = new Float32Array(list.length * 2); for (let q = 0; q < list.length; q++) { xz[q * 2] = list[q].m.elements[12]; xz[q * 2 + 1] = list[q].m.elements[14]; } m.userData.xz = xz; ch.scen.push(m); return m;
  };
  const tint = (a: number, b: number): Rgb => { const v = a + R() * (b - a); return [v * (0.95 + R() * 0.1), v, v * (0.95 + R() * 0.1)]; };
  buildGround(ch);

  /* giant ancient trunks and fallen logs */
  if (R() < 0.7) {
    const tx = x0 + 9 + R() * (S - 18), tz = z0 + 9 + R() * (S - 18), r = 4.5 + R() * 4;
    if (Math.hypot(tx, tz) > 18 && wOK(W.giant, tx, tz) && walk(tx, tz) && !nearStorySite(loreSites, tx, tz, r)) {
      let y0 = 1e9; for (let k = 0; k < 8; k++) y0 = Math.min(y0, H(tx + Math.cos(k * 0.785) * r, tz + Math.sin(k * 0.785) * r));
      const m = new THREE.Mesh(G.giant[(R() * 3) | 0], MAT.vc); m.position.set(tx, y0 - 0.3, tz); m.scale.set(r, 1, r); m.rotation.y = R() * TAU; m.castShadow = true; m.receiveShadow = true; grp.add(m);
      const node: SceneNode = { kind: 'tree', label: 'Ancient trunk', x: tx, z: tz, y0, r: r * 1.12, h: 160, hp: 55, max: 55, yield: 24, mesh: m, dead: false, shake: 0, ry: m.rotation.y, key: `${cx},${cz},ancient` };
      ch.nodes.push(node); ch.col.push({ x: tx, z: tz, r: r * 1.12, node });
    }
  }
  if (R() < 0.6) {
    const r = 1.2 + R() * 1.1, len = 8 + R() * 8, yaw = R() * TAU, lx = x0 + 10 + R() * (S - 20), lz = z0 + 10 + R() * (S - 20);
    if (!home(lx, lz, len) && wOK(W.log, lx, lz) && !blocked(lx, lz, len * 0.5)) {
      const fx = Math.sin(yaw), fz = Math.cos(yaw), h1 = baseH(lx - fx * len / 2, lz - fz * len / 2, 1), h2 = baseH(lx + fx * len / 2, lz + fz * len / 2, 1);
      const m = new THREE.Mesh(G.log, MAT.vc); m.rotation.order = 'YXZ'; m.rotation.y = yaw; m.rotation.x = -Math.atan2(h2 - h1, len);
      m.position.set(lx, (h1 + h2) / 2 + r * 0.55, lz); m.scale.set(r, r, len); m.castShadow = true; m.receiveShadow = true; grp.add(m);
      const node: SceneNode = { kind: 'tree', label: 'Fallen log', x: lx, z: lz, y0: Math.min(h1, h2), r: len / 2, h: r * 2.2 + Math.abs(h2 - h1), hp: 24, max: 24, yield: 8, mesh: m, dead: false, shake: 0, ry: yaw, rx: m.rotation.x, key: `${cx},${cz},log` };
      ch.nodes.push(node);
      const n = Math.ceil(len / (r * 1.4)); for (let k = 0; k < n; k++) { const t = (k / (n - 1) - 0.5) * len * 0.94; ch.col.push({ x: lx + fx * t, z: lz + fz * t, r: r * 0.9, node }); }
    }
  }

  /* choppable trees, by biome */
  const forest = (x: number, z: number) => 0.3 + 0.7 * smooth(0.3, 0.6, fbm(x * 0.02, z * 0.02, 2, 71));
  for (let a = 0; a < 18; a++) {
    attempt('tree', a);
    const x = rx(), z = rz(); if (!wOK(W.tree, x, z) || R() > forest(x, z) * 0.85) continue;
    const r = 0.42 + R() * 0.45; if (home(x, z, 7) || blocked(x, z, r + 1.5)) continue;
    const b = bioAt(x, z), v = b === BIOME.HIGHLAND ? (R() < 0.5 ? 0 : 1) : b === BIOME.MEADOW ? 4 : b === BIOME.MARSH ? (R() < 0.5 ? 2 : 4) : (R() * G.trees.length) | 0;
    const m = new THREE.Mesh(G.trees[v], MAT.vc), by = baseH(x, z, r);
    m.position.set(x, by - 0.25, z); m.scale.setScalar(r); m.rotation.y = R() * TAU; m.castShadow = true; m.receiveShadow = true; grp.add(m);
    const node: SceneNode = { kind: 'tree', x, z, y0: by, r, h: (v < 2 ? 22 : 16) * r, hp: 9 + r * 8, max: 9 + r * 8, yield: Math.round(2 + r * 5), mesh: m, dead: false, shake: 0, ry: m.rotation.y, key: spawnKey('tree', a) };
    ch.nodes.push(node); ch.col.push({ x, z, r: r * 1.05, node });
  }
  R = chunkR;
  for (let a = 0; a < 8; a++) {
    attempt('cactus', a);
    const x = rx(), z = rz(); if (!wOK(W.cactus, x, z)) continue; const r = 0.38 + R() * 0.22; if (blocked(x, z, r + 2)) continue;
    const m = new THREE.Mesh(G.cactus, MAT.vc), by = baseH(x, z, r); m.position.set(x, by - 0.1, z); m.scale.setScalar(r); m.rotation.y = R() * TAU; m.castShadow = true; m.receiveShadow = true; grp.add(m);
    const node: SceneNode = { kind: 'tree', cactus: true, item: 'fiber', x, z, y0: by, r: r * 1.1, h: 5 * r, hp: 5 + r * 5, max: 5 + r * 5, yield: 2 + ((R() * 3) | 0), mesh: m, dead: false, shake: 0, ry: m.rotation.y, key: spawnKey('cactus', a) };
    ch.nodes.push(node); ch.col.push({ x, z, r: r * 1.15, node });
  }
  R = chunkR;
  /* stone and iron outcrops */
  for (let a = 0; a < 3; a++) {
    attempt('rock', a);
    const x = rx(), z = rz(), s = 0.9 + R() * 0.7; if (!wOK(W.rock, x, z) || home(x, z, 8) || blocked(x, z, s + 1.2)) continue;
    const by = baseH(x, z, s * 0.9), m = new THREE.Mesh(G.rockNode[(R() * 2) | 0], bioAt(x, z) === BIOME.DUNES ? MAT.vcTan : MAT.vc); m.position.set(x, by + s * 0.1, z); m.scale.set(s, s * 0.85, s); m.rotation.y = R() * TAU; m.castShadow = true; m.receiveShadow = true; grp.add(m);
    const node: SceneNode = { kind: 'rock', x, z, y0: by, r: s * 0.95, h: s * 1.4, hp: 13, max: 13, yield: 3 + ((R() * 3) | 0), mesh: m, dead: false, shake: 0, ry: m.rotation.y, sc: s, key: spawnKey('rock', a) };
    ch.nodes.push(node); ch.col.push({ x, z, r: s * 0.9, node });
  }
  R = chunkR;
  { attempt('ore', 0); const x = rx(), z = rz(), s = 0.9 + R() * 0.4;
    if (R() < W.ore[bioAt(x, z)] && !home(x, z, 10) && !blocked(x, z, s + 1.2)) {
      const by = baseH(x, z, s * 0.9), m = new THREE.Mesh(G.oreNode, MAT.ore); m.position.set(x, by + s * 0.1, z); m.scale.set(s, s * 0.9, s); m.rotation.y = R() * TAU; m.castShadow = true; m.receiveShadow = true; grp.add(m);
      const node: SceneNode = { kind: 'ore', x, z, y0: by, r: s * 0.95, h: s * 1.4, hp: 18, max: 18, yield: 1 + ((R() * 3) | 0), mesh: m, dead: false, shake: 0, ry: m.rotation.y, sc: s, key: spawnKey('ore', 0) };
      ch.nodes.push(node); ch.col.push({ x, z, r: s * 0.9, node });
    }
    R = chunkR;
  }
  for (let a = 0; a < 3; a++) {
    attempt('bush', a);
    const x = rx(), z = rz(), s = 0.9 + R() * 0.5; if (!wOK(W.bush, x, z) || home(x, z, 5) || blocked(x, z, s + 0.6)) continue;
    const m = new THREE.Mesh(G.bushBerry, MAT.vc); m.position.set(x, baseH(x, z, s * 0.9) - 0.05, z); m.scale.setScalar(s); m.rotation.y = R() * TAU; m.castShadow = true; m.receiveShadow = true; grp.add(m);
    ch.nodes.push({ kind: 'bush', x, z, y0: baseH(x, z, s * 0.9), r: s * 1.0, h: s * 1.3, hp: 4, max: 4, mesh: m, dead: false, shake: 0, ready: true, regrow: 0, sc: s, id: cx + ',' + cz + ',bush' + a, key: spawnKey('bush', a) });
  }
  R = chunkR;

  /* scenery */
  { const lists: Instance[][] = [[], []];
    for (let i = 0; i < 16; i++) {
      const x = rx(), z = rz(); if (!wOK(W.decoRock, x, z) || home(x, z, 5) || blocked(x, z, 1.2)) continue;
      const s = 0.25 + Math.pow(R(), 2.4) * 1.3, w = tint(0.85, 1.1), dn = bioAt(x, z) === BIOME.DUNES;
      lists[R() < 0.5 ? 0 : 1].push({ m: align(x, z, R() * TAU, -0.15 * s, s * (0.9 + R() * 0.5), s * (0.55 + R() * 0.4), s * (0.9 + R() * 0.5)), r: w[0] * (dn ? 1.3 : 1), g: w[1] * (dn ? 1.15 : 1), b: w[2] * (dn ? 0.85 : 1) });
    }
    flush(lists[0], G.rocks[0], MAT.vc, true, { tag: 'rock0', item: 'stone', label: 'Loose stone' }); flush(lists[1], G.rocks[1], MAT.vc, true, { tag: 'rock1', item: 'stone', label: 'Loose stone' }); }
  { const red: Instance[] = [], brown: Instance[] = [];
    for (let c = 0; c < 4; c++) {
      const mx = rx(), mz = rz(); if (!wOK(W.mush, mx, mz) || home(mx, mz, 7) || blocked(mx, mz, 2)) continue;
      const type = R() < 0.5 ? 'red' : 'brown';
      for (let k = 0, nk = 1 + ((R() * 5) | 0); k < nk; k++) {
        const a = R() * TAU, d = k === 0 ? 0 : 1 + R() * 2.5, x = mx + Math.cos(a) * d, z = mz + Math.sin(a) * d; if (blocked(x, z, 0.5)) continue;
        const s = 0.35 + Math.pow(R(), 1.6) * 1.4, w = tint(0.88, 1.08);
        (type === 'red' ? red : brown).push({ m: align(x, z, R() * TAU, -0.05 * s, s, s * (0.9 + R() * 0.3), s), r: w[0], g: w[1], b: w[2] });
      }
    }
    flush(red, G.mushRed, MAT.vc, true, { tag: 'red-mushroom', item: 'mushroom', label: 'Red mushroom' }); flush(brown, G.mushBrown, MAT.vc, true, { tag: 'brown-mushroom', item: 'mushroom', label: 'Brown mushroom' }); }
  { const list: Instance[] = [];
    for (let i = 0; i < 11; i++) { const x = rx(), z = rz(); if (!wOK(W.fern, x, z) || home(x, z, 5) || blocked(x, z, 1)) continue; const s = 1.5 + R() * 1.7, w = tint(0.75, 1.05); list.push({ m: align(x, z, R() * TAU, 0, s, s, s), r: w[0], g: w[1], b: w[2] }); }
    flush(list, G.fern, MAT.fern, false, { tag: 'fern', item: 'fiber', label: 'Fern' }); }
  { const list: Instance[] = [], pal = [[0.9, 0.55, 0.2], [0.8, 0.35, 0.12], [0.75, 0.6, 0.2], [0.55, 0.32, 0.15], [0.5, 0.55, 0.2], [0.85, 0.7, 0.3]];
    for (let i = 0; i < 42; i++) { const x = rx(), z = rz(); if (!wOK(W.leaf, x, z) || blocked(x, z, 0.4)) continue; const s = 0.8 + R() * 1.6, p = pal[(R() * pal.length) | 0], j = 0.85 + R() * 0.3; list.push({ m: align(x, z, R() * TAU, 0.05, s, s, s), r: p[0] * j, g: p[1] * j, b: p[2] * j }); }
    flush(list, G.leaf, MAT.vc2, false, { tag: 'leaf', item: 'fiber', label: 'Leaf litter' }); }
  { const list: Instance[] = [];
    for (let i = 0; i < 12; i++) { const x = rx(), z = rz(); if (!wOK(W.twig, x, z) || blocked(x, z, 0.4)) continue; const r = 0.08 + R() * 0.08, len = 2 + R() * 4, w = tint(0.8, 1.1); list.push({ m: align(x, z, R() * TAU, r * 0.35, r, r, len), r: w[0], g: w[1], b: w[2] }); }
    flush(list, G.twig, MAT.vc, false, { tag: 'twig', item: 'stick', label: 'Twig' }); }
  for (const [geo, seed] of [[G.flowerBell, 0], [G.flowerStar, 1]] as [THREE.BufferGeometry, number][]) {
    const list: Instance[] = [];
    for (let i = 0; i < 24; i++) {
      const x = rx(), z = rz(); if (!wOK(W.flower, x, z) || blocked(x, z, 0.5)) continue; if (bioAt(x, z) !== BIOME.MEADOW && fbm(x * 0.05, z * 0.05, 2, 60 + seed) < 0.5) continue;
      const s = 0.9 + R() * 1.2, w = tint(0.92, 1.05); list.push({ m: mat4(x, H(x, z) - 0.05, z, (R() - 0.5) * 0.3, R() * TAU, (R() - 0.5) * 0.3, s * 0.8, s, s * 0.8), r: w[0], g: w[1], b: w[2] });
    }
    flush(list, geo, MAT.vc2, false, { tag: 'flower' + seed, item: 'fiber', label: 'Wildflower', seed: true });
  }
  { const list: Instance[] = [];
    for (let i = 0; i < 2600; i++) {
      const x = rx(), z = rz(), b = bioAt(x, z), dens = smooth(0.3, 0.62, fbm(x * 0.035, z * 0.035, 2, 51)), pr = (b === BIOME.MEADOW ? 0.6 + dens * 0.4 : dens * 0.9 + 0.1) * W.grass[b];
      if (R() > pr || home(x, z, 2.5) || blocked(x, z, 0.2)) continue;
      const h = 0.6 + Math.pow(R(), 1.6) * 1.7, w = 0.8 + R() * 0.7, dry = R() < 0.2, v = 0.85 + R() * 0.3, gt = GT[b];
      list.push({ m: mat4(x, H(x, z) - 0.05, z, (R() - 0.5) * 0.3, R() * TAU, (R() - 0.5) * 0.3, w, h, w), r: (dry ? 1.25 : 1) * v * gt[0], g: (dry ? 1.02 : 1) * v * gt[1], b: (dry ? 0.5 : 1) * v * gt[2] });
    }
    flush(list, G.grass, MAT.grass, false, { tag: 'grass', item: 'fiber', label: 'Grass', seed: true }); }

  /* things to pick up by walking over them */
  const kinds = [
    { t: 'pebble', geo: G.pebble, item: 'stone', cnt: 8, mat: MAT.vc, w: W.pebble },
    { t: 'stick', geo: G.stick, item: 'stick', cnt: 7, mat: MAT.vc, w: W.stick },
    { t: 'fiber', geo: G.fiber, item: 'fiber', cnt: 10, mat: MAT.grass, scl: 0.8, w: W.fiber },
    { t: 'mush', geo: G.mushTan, item: 'mushroom', cnt: 4, mat: MAT.vc, scl: 0.32, w: W.mushPick }
  ];
  for (const kd of kinds) {
    const list: Instance[] = [], meta: Pickup[] = [];
    for (let i = 0; i < kd.cnt; i++) {
      attempt(kd.t, i);
      const x = rx(), z = rz(), id = cx + ',' + cz + ',' + kd.t + i; if (!wOK(kd.w, x, z) || home(x, z, 2) || blocked(x, z, 0.5)) continue;
      const s = kd.scl ? kd.scl * (0.8 + R() * 0.5) : 1, rot = R() * TAU; if (collected.has(id)) continue;
      list.push({ m: mat4(x, H(x, z), z, 0, rot, 0, s, kd.t === 'fiber' ? s * 1.1 : s, s), r: 1, g: 1, b: 1 }); meta.push({ x, z, item: kd.item, id, dead: false, manual: true, label: ({ pebble: 'Pebble', stick: 'Loose stick', fiber: 'Loose fibre', mush: 'Mushroom' } as Record<string, string>)[kd.t] } as Pickup);
    }
    R = chunkR;
    const m = flush(list, kd.geo, kd.mat, false);
    if (m) meta.forEach((mt, i) => { mt.mesh = m; mt.idx = i; ch.picks.push(mt); });
  }
  for (const n of ch.nodes) if (n.kind === 'bush') {
    n.regrow = Math.max(0, (bushReady[nk(n)] ?? 0) - todT); n.ready = n.regrow === 0;
    n.mesh.geometry = n.ready ? G.bushBerry : G.bush;
  }
  /* re-apply what the player changed: felled trees and broken rocks, dug or built columns */
  if (deadNodes.size) for (const n of ch.nodes) if (deadNodes.has(nk(n))) {
    n.dead = true; n.mesh.visible = false; ch.col = ch.col.filter(c => c.node !== n);
  }
  for (const e of edits.values()) if (e.i >= x0 && e.i < x0 + S && e.k >= z0 && e.k < z0 + S && e.j >= WG.terr(e.i, e.k).h - 1) removeSceneryIn(ch, e.i, e.k);
  scene.add(grp); return ch;
}
/** Points the game at another world. Everything derived from the old one goes: cached chunks, meshes and the player changes stored against it. */
function applyWorld(seed: number, genVersion: number) {
  horizon.clear();
  for (const d of worldDrops) scene.remove(d.mesh); worldDrops.length = 0;
  for (const k of Object.keys(bushReady)) delete bushReady[k];
  WG.setWorld(seed, genVersion);
  chunkData.clear(); gcx = gcz = 1e9; gd = null;
  for (const ch of chunks.values()) disposeChunk(ch); chunks.clear();
  edits.clear(); collected.clear(); deadNodes.clear(); chronicle = []; sinceDawn.length = 0;
}
function disposeChunk(ch: Chunk) { scene.remove(ch.grp); for (const d of ch.disp) d.dispose(); for (const m of Object.values(ch.gm)) if (m) m.geometry.dispose(); }
function ensureChunks(force: boolean) {
  const pcx = Math.round(P.x / S), pcz = Math.round(P.z / S), need: { k: string; cx: number; cz: number; d: number }[] = [];
  for (let dx = -RAD; dx <= RAD; dx++) for (let dz = -RAD; dz <= RAD; dz++) { const k = (pcx + dx) + ',' + (pcz + dz); if (!chunks.has(k)) need.push({ k, cx: pcx + dx, cz: pcz + dz, d: dx * dx + dz * dz }); }
  need.sort((a, b) => a.d - b.d);
  if (force) { for (let i = 0; i < need.length; i++) chunks.set(need[i].k, genChunk(need[i].cx, need[i].cz)); }
  else if (need.length) {
    const c = need[0]; let miss: number[] | null = null;
    for (let dx = -1; dx <= 1 && !miss; dx++) for (let dz = -1; dz <= 1 && !miss; dz++) if (!chunkData.has((c.cx + dx) + ',' + (c.cz + dz))) miss = [c.cx + dx, c.cz + dz];
    if (miss) cdata(miss[0], miss[1]); else chunks.set(c.k, genChunk(c.cx, c.cz));
  } else {
    for (let r = 0; r <= RAD + 1; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r && !chunkData.has((pcx + dx) + ',' + (pcz + dz))) { cdata(pcx + dx, pcz + dz); r = 99; dx = 99; break; }
  }
  for (const [k, ch] of chunks) if (Math.abs(ch.cx - pcx) > RAD + 1 || Math.abs(ch.cz - pcz) > RAD + 1) { disposeChunk(ch); chunks.delete(k); }
  horizon.update(P.x, P.z, chunks, force);
}
function nearChunks(fn: (ch: Chunk) => void) { const pcx = Math.round(P.x / S), pcz = Math.round(P.z / S); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const ch = chunks.get((pcx + dx) + ',' + (pcz + dz)); if (ch) fn(ch); } }

/* ================= sky, sunbeams, motes, fireflies ================= */
const skyMat = new THREE.ShaderMaterial({
  uniforms: { cHor: { value: new THREE.Color() }, cTop: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() } },
  side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 cHor, cTop, sunCol, sunDir; varying vec3 vD; void main(){ float h = clamp(vD.y, 0.0, 1.0); vec3 c = mix(cHor, cTop, pow(h, 0.55)); float s = max(dot(normalize(vD), sunDir), 0.0); c += sunCol * (pow(s, 48.0) * 0.8 + pow(s, 6.0) * 0.22); gl_FragColor = vec4(c, 1.0); }'
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 24, 12), skyMat); sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

const SH_C = 26;
const shaftGeo = (() => {
  const a = new THREE.PlaneGeometry(5, 70), b = new THREE.PlaneGeometry(5, 70); b.rotateY(Math.PI / 2);
  const pos: number[] = [], uv: number[] = [], idx: number[] = []; let base = 0;
  for (const g of [a, b]) { for (let i = 0; i < g.attributes.position.count; i++) { pos.push(g.attributes.position.getX(i), g.attributes.position.getY(i), g.attributes.position.getZ(i)); uv.push(g.attributes.uv.getX(i), g.attributes.uv.getY(i)); } for (let i = 0; i < g.index!.count; i++) idx.push(g.index!.getX(i) + base); base += g.attributes.position.count; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); return g;
})();
const shafts: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
for (let i = 0; i < 25; i++) { const m = new THREE.Mesh(shaftGeo, new THREE.MeshBasicMaterial({ map: shaftTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, opacity: 0 })); m.frustumCulled = false; m.visible = false; scene.add(m); shafts.push(m); }
const shaftQ = new THREE.Quaternion();
function updateShafts(t: number) {
  shaftQ.setFromUnitVectors(UP, TOD.dir);
  const pi = Math.floor(P.x / SH_C), pj = Math.floor(P.z / SH_C);
  for (let i = pi - 2; i <= pi + 2; i++) for (let j = pj - 2; j <= pj + 2; j++) {
    const m = shafts[(((i % 5) + 5) % 5) * 5 + (((j % 5) + 5) % 5)], h = hash2(i, j, 300);
    if (h < 0.5) { m.visible = false; continue; }
    const x = (i + hash2(i, j, 301)) * SH_C, z = (j + hash2(i, j, 302)) * SH_C, y = H(x, z);
    m.visible = true; m.quaternion.copy(shaftQ); m.position.set(x + TOD.dir.x * 33, y + TOD.dir.y * 33, z + TOD.dir.z * 33); m.scale.set(0.6 + hash2(i, j, 303) * 1.2, 1, 1);
    const d = Math.hypot(x - P.x, z - P.z), fade = 1 - smooth(22, 56, d);
    m.material.opacity = 0.32 * TOD.shaft * fade * (0.7 + 0.3 * Math.sin(t * 0.6 + h * 40)); m.material.color.copy(TOD.sun);
  }
}
const MN = 300, moteGeo = new THREE.BufferGeometry(), moteP = new Float32Array(MN * 3), moteR = new Float32Array(MN), moteV = new Float32Array(MN * 3);
for (let i = 0; i < MN; i++) { moteP[i * 3] = (Math.random() - 0.5) * 60; moteP[i * 3 + 2] = (Math.random() - 0.5) * 60; moteR[i] = 0.3 + Math.random() * 13; moteV[i * 3] = (Math.random() - 0.5) * 0.4; moteV[i * 3 + 1] = (Math.random() - 0.5) * 0.15; moteV[i * 3 + 2] = (Math.random() - 0.5) * 0.4; }
moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MN * 3), 3));
const moteMat = new THREE.PointsMaterial({ size: 0.26, map: moteTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6, color: 0xfff0c0, fog: false });
const motes = new THREE.Points(moteGeo, moteMat); motes.frustumCulled = false; scene.add(motes);
function updateMotes(dt: number, t: number) {
  const pa = moteGeo.attributes.position.array as Float32Array;
  for (let i = 0; i < MN; i++) {
    moteP[i * 3] += (moteV[i * 3] + Math.sin(t * 0.5 + i) * 0.15) * dt; moteP[i * 3 + 2] += (moteV[i * 3 + 2] + Math.cos(t * 0.4 + i * 1.3) * 0.15) * dt;
    moteR[i] += (moteV[i * 3 + 1] - 2.4 * snowU) * dt; if (moteR[i] < 0.3) moteR[i] = 13; if (moteR[i] > 13.5) moteR[i] = 0.4;
    const dx = moteP[i * 3] - P.x; if (dx > 30) moteP[i * 3] -= 60; else if (dx < -30) moteP[i * 3] += 60;
    const dz = moteP[i * 3 + 2] - P.z; if (dz > 30) moteP[i * 3 + 2] -= 60; else if (dz < -30) moteP[i * 3 + 2] += 60;
    pa[i * 3] = moteP[i * 3]; pa[i * 3 + 1] = P.y + moteR[i]; pa[i * 3 + 2] = moteP[i * 3 + 2];
  }
  moteGeo.attributes.position.needsUpdate = true; moteMat.opacity = (0.6 * (1 - TOD.night * 0.85 * (1 - snowU)) + 0.2 * snowU) * (1 - ugU); moteMat.color.copy(TOD.sun).lerp(WHITE, snowU); moteMat.size = 0.26 + 0.24 * snowU;
}
const FN = 46, ffGeo = new THREE.BufferGeometry(), ffP = new Float32Array(FN * 3), ffC = new Float32Array(FN * 3), ffB: { x: number; z: number; y: number; s: number }[] = [];
for (let i = 0; i < FN; i++) ffB.push({ x: (Math.random() - 0.5) * 70, z: (Math.random() - 0.5) * 70, y: 0.6 + Math.random() * 4, s: Math.random() * 6 });
ffGeo.setAttribute('position', new THREE.BufferAttribute(ffP, 3)); ffGeo.setAttribute('color', new THREE.BufferAttribute(ffC, 3));
const flies = new THREE.Points(ffGeo, new THREE.PointsMaterial({ size: 0.8, map: moteTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); flies.frustumCulled = false; scene.add(flies);
function updateFlies(dt: number, t: number) {
  for (let i = 0; i < FN; i++) {
    const f = ffB[i]; f.x += Math.sin(t * 0.3 + f.s) * 0.9 * dt; f.z += Math.cos(t * 0.27 + f.s * 2) * 0.9 * dt;
    const dx = f.x - P.x; if (dx > 35) f.x -= 70; else if (dx < -35) f.x += 70; const dz = f.z - P.z; if (dz > 35) f.z -= 70; else if (dz < -35) f.z += 70;
    ffP[i * 3] = f.x; ffP[i * 3 + 1] = H(f.x, f.z) + f.y + Math.sin(t * 0.8 + f.s) * 0.6; ffP[i * 3 + 2] = f.z;
    const b = Math.pow(Math.max(0, Math.sin(t * 1.7 + f.s * 3.1)), 3) * TOD.ff * (1 - ugU); ffC[i * 3] = 0.85 * b; ffC[i * 3 + 1] = b; ffC[i * 3 + 2] = 0.3 * b;
  }
  ffGeo.attributes.position.needsUpdate = true; ffGeo.attributes.color.needsUpdate = true;
}

/* chips and sparks */
const PN = 90, partMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial(), PN), parts: Particle[] = [];
partMesh.frustumCulled = false; scene.add(partMesh);
for (let i = 0; i < PN; i++) { parts.push({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1 }); partMesh.setMatrixAt(i, ZERO); tmpC.setRGB(1, 1, 1); partMesh.setColorAt(i, tmpC); }
let partNext = 0;
function burst(x: number, y: number, z: number, col: number, n: number) {
  tmpC.set(col);
  for (let k = 0; k < n; k++) {
    const i = partNext++ % PN, p = parts[i]; p.life = 0.5 + Math.random() * 0.4; p.x = x; p.y = y; p.z = z; p.vx = (Math.random() - 0.5) * 5; p.vy = 2 + Math.random() * 4; p.vz = (Math.random() - 0.5) * 5; p.s = 0.6 + Math.random() * 0.9;
    const v = 0.8 + Math.random() * 0.3; partMesh.setColorAt(i, tmpC.clone().multiplyScalar(v));
  }
  partMesh.instanceColor!.needsUpdate = true;
}
function updateParts(dt: number) {
  for (let i = 0; i < PN; i++) {
    const p = parts[i]; if (p.life <= 0) continue; p.life -= dt; p.vy -= 14 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    const g = surf(p.x, p.z); if (p.y < g) { p.y = g; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
    if (p.life <= 0) partMesh.setMatrixAt(i, ZERO); else { dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(p.life * 8, p.life * 5, 0); dummy.scale.setScalar(p.s * Math.min(1, p.life * 3)); dummy.updateMatrix(); partMesh.setMatrixAt(i, dummy.matrix); }
  }
  partMesh.instanceMatrix.needsUpdate = true;
}

/* ================= time of day ================= */
const C = (s: string) => new THREE.Color(s);
const TK = [
  { p: 0.00, fog: C('#c9a98b'), sky: C('#ffd9b8'), gnd: C('#4a3a2a'), sun: C('#ffb98a'), sunI: 0.9, hemiI: 0.6, shaft: 0.55, ff: 0.25, el: 0.42, tint: [1.06, 0.98, 0.94] },
  { p: 0.25, fog: C('#b3c78c'), sky: C('#dff0b4'), gnd: C('#403a22'), sun: C('#fff0c0'), sunI: 1.2, hemiI: 0.8, shaft: 1.0, ff: 0.0, el: 0.95, tint: [1.02, 1.0, 0.96] },
  { p: 0.50, fog: C('#cf8d5c'), sky: C('#ffb684'), gnd: C('#3a2a26'), sun: C('#ff8c4c'), sunI: 0.95, hemiI: 0.6, shaft: 0.65, ff: 0.85, el: 0.4, tint: [1.1, 0.96, 0.9] },
  { p: 0.75, fog: C('#1a2d40'), sky: C('#4a6e9c'), gnd: C('#10171f'), sun: C('#8fb0e6'), sunI: 0.6, hemiI: 0.62, shaft: 0.2, ff: 1.0, el: 0.75, tint: [0.92, 1.0, 1.1] },
  { p: 1.00, fog: C('#c9a98b'), sky: C('#ffd9b8'), gnd: C('#4a3a2a'), sun: C('#ffb98a'), sunI: 0.9, hemiI: 0.6, shaft: 0.55, ff: 0.25, el: 0.42, tint: [1.06, 0.98, 0.94] }
];
const TOD = { fog: new THREE.Color(), sky: new THREE.Color(), gnd: new THREE.Color(), sun: new THREE.Color(), sunI: 1, hemiI: 1, shaft: 1, ff: 0, el: 0.9, night: 0, p: 0, dir: new THREE.Vector3() };
let todT = 0.12 * DAY_LEN;
const UWC = new THREE.Color('#1f6a86'), WHITE = new THREE.Color(1, 1, 1), FOGT = [0.0045, 0.004, 0.0038, 0.005, 0.006, 0.0035];
function updateTOD() {
  const p = ((todT / DAY_LEN) % 1 + 1) % 1; TOD.p = p;
  let i = 0; while (i < TK.length - 2 && p >= TK[i + 1].p) i++;
  const a = TK[i], b = TK[i + 1], t = smooth(0, 1, (p - a.p) / (b.p - a.p));
  TOD.fog.copy(a.fog).lerp(b.fog, t); TOD.sky.copy(a.sky).lerp(b.sky, t); TOD.gnd.copy(a.gnd).lerp(b.gnd, t); TOD.sun.copy(a.sun).lerp(b.sun, t);
  TOD.sunI = lerp(a.sunI, b.sunI, t); TOD.hemiI = lerp(a.hemiI, b.hemiI, t); TOD.shaft = lerp(a.shaft, b.shaft, t); TOD.ff = lerp(a.ff, b.ff, t); TOD.el = lerp(a.el, b.el, t);
  TOD.night = smooth(0.55, 0.7, p) * (1 - smooth(0.88, 0.98, p));
  const az = p * TAU * 0.8 + 0.6; TOD.dir.set(Math.cos(TOD.el) * Math.cos(az), Math.sin(TOD.el), Math.cos(TOD.el) * Math.sin(az)).normalize();
  (scene.background as THREE.Color).copy(TOD.fog).multiplyScalar(1 - 0.92 * ugU); (scene.fog as THREE.FogExp2).color.copy(scene.background as THREE.Color);
  if (uwU > 0.01) { (scene.background as THREE.Color).lerp(tmpC.copy(UWC).multiplyScalar(0.4 + 0.6 * (1 - TOD.night)), uwU); (scene.fog as THREE.FogExp2).color.copy(scene.background as THREE.Color); }
  (scene.fog as THREE.FogExp2).density = fogD + 0.06 * uwU;
  hemi.color.copy(TOD.sky); hemi.groundColor.copy(TOD.gnd); hemi.intensity = TOD.hemiI * (1 - 0.8 * ugU); sun.color.copy(TOD.sun); sun.intensity = TOD.sunI;
  skyMat.uniforms.cHor.value.copy(TOD.fog); skyMat.uniforms.cTop.value.copy(TOD.sky).multiplyScalar(0.7).lerp(TOD.fog, 0.35);
  skyMat.uniforms.sunDir.value.copy(TOD.dir); skyMat.uniforms.sunCol.value.copy(TOD.sun).multiplyScalar(0.7 - TOD.night * 0.3);
  if (grade) grade.uniforms.uTint.value.set(lerp(a.tint[0], b.tint[0], t), lerp(a.tint[1], b.tint[1], t), lerp(a.tint[2], b.tint[2], t));
  lantern.intensity = 0.35 + TOD.night * 1.5 + 1.2 * ugU; lantern.distance = 16 + 8 * ugU;
}

/* ================= player, gnome, held models ================= */
const P = { x: 0, z: 3, y: 0, vx: 0, vz: 0, vy: 0, heading: Math.PI, grounded: true, stamina: 100, exhausted: false, hp: 100, hunger: 80, speed: 0,
  cool: 0, swing: 0, swingHit: true, blocking: false, phase: 0, stepD: 0, invuln: 0, kx: 0, kz: 0, spawnX: 0, spawnZ: 3, regenT: 0 };
let state: 'menu' | 'play' | 'sleep' | 'dead' | 'dialogue' = 'menu', ready = false, camYaw = 0, camPitch = 0.28, camDist = 6.2, camDistNow = 6.2, ugU = 0, uwU = 0, snowU = 0, fogD = 0.0045, mining: { key: string; hp: number; max: number } | null = null, shake = 0, dmgFlash = 0, locked = false, mouseHeld = false, mouseX = innerWidth / 2, mouseY = innerHeight / 2;
const camTarget = new THREE.Vector3(0, 1.3, 3), keys: Record<string, boolean> = {};

const gnome = (function () {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const std = (c: number, r?: number, m?: number) => new THREE.MeshStandardMaterial({ color: c, roughness: r === undefined ? 0.85 : r, metalness: m || 0 });
  const M = { skin: std(0xefc49b, 0.7), nose: std(0xe59a8a, 0.6), beard: std(0xf3f1ea, 0.95), hat: std(0xc8322e, 0.8), tunic: std(0x2f6b3a, 0.9), pants: std(0x4a5468, 0.9), boot: std(0x4a2f1a, 0.8), belt: std(0x5a3a1c, 0.7), pack: std(0x8a5a2f, 0.9), gold: std(0xd9b04a, 0.3, 0.7), dark: std(0x101010, 0.3) };
  const S1 = new THREE.SphereGeometry(1, 18, 14);
  const ball = (m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, p?: THREE.Object3D) => { const o = new THREE.Mesh(S1, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); (p || g).add(o); return o; };
  const cyl = (m: THREE.Material, rt: number, rb: number, h: number, x: number, y: number, z: number, p?: THREE.Object3D, seg?: number) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), m); o.position.set(x, y, z); (p || g).add(o); return o; };
  const body = new THREE.Group(); g.add(body);
  /* legs */
  const legs: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.13, 0.55, 0); g.add(hip);
    cyl(M.pants, 0.09, 0.08, 0.36, 0, -0.18, 0, hip); ball(M.boot, 0.12, 0.09, 0.19, 0, -0.42, 0.05, hip); legs.push(hip);
  }
  /* torso, belt, buckle */
  cyl(M.tunic, 0.24, 0.29, 0.5, 0, 0.78, 0, body); cyl(M.belt, 0.295, 0.295, 0.07, 0, 0.62, 0, body, 16); const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.03), M.gold); buckle.position.set(0, 0.62, 0.29); body.add(buckle);
  /* head, nose, eyes */
  ball(M.skin, 0.23, 0.22, 0.22, 0, 1.13, 0.02, body); ball(M.nose, 0.085, 0.085, 0.09, 0, 1.1, 0.25, body);
  for (const s of [-1, 1]) { ball(M.dark, 0.028, 0.034, 0.02, s * 0.085, 1.18, 0.2, body); const br = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.03), M.beard); br.position.set(s * 0.085, 1.235, 0.2); br.rotation.z = s * -0.25; body.add(br); }
  /* beard and moustache */
  const beard = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.62, 14), M.beard); beard.rotation.x = Math.PI; beard.position.set(0, 0.84, 0.13); beard.scale.z = 0.7; body.add(beard);
  ball(M.beard, 0.15, 0.05, 0.07, 0, 1.03, 0.22, body);
  /* hat: two bent cones */
  const hat1 = new THREE.Mesh(new THREE.ConeGeometry(0.29, 0.5, 14), M.hat); hat1.position.set(0, 1.5, -0.02); body.add(hat1);
  const hat2 = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.55, 12), M.hat); hat2.position.set(0, 1.86, -0.12); hat2.rotation.x = -0.35; body.add(hat2);
  const brim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 8, 20), M.hat); brim.rotation.x = Math.PI / 2; brim.position.set(0, 1.27, 0); body.add(brim);
  /* backpack with bedroll */
  const pk = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.2), M.pack); pk.position.set(0, 0.8, -0.3); body.add(pk); cyl(M.hat, 0.09, 0.09, 0.44, 0, 1.06, -0.3, body).rotation.z = Math.PI / 2;
  /* lantern on belt */
  const lanternG = new THREE.Group(); lanternG.position.set(0.3, 0.56, 0.06); body.add(lanternG);
  cyl(M.gold, 0.06, 0.06, 0.16, 0, 0, 0, lanternG, 8); const core = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc36a })); lanternG.add(core);
  const lsp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowWarm, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.7 })); lsp.scale.setScalar(0.7); lanternG.add(lsp);
  /* arms: right holds tools, left holds the shield */
  const arms: { sh: THREE.Group; hand: THREE.Group }[] = [];
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(s * 0.32, 0.98, 0); body.add(shoulder);
    cyl(M.tunic, 0.075, 0.065, 0.42, 0, -0.21, 0, shoulder); const hand = new THREE.Group(); hand.position.set(0, -0.46, 0); shoulder.add(hand); ball(M.skin, 0.07, 0.07, 0.07, 0, 0, 0, hand); arms.push({ sh: shoulder, hand });
  }
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g);
  return { g, body, legs, armR: arms[0], armL: arms[1], lanternCore: core, lsp };
})();
/* right arm is at -X because the gnome faces +Z */
const held = new THREE.Group(); gnome.armR.hand.add(held);
const shieldHold = new THREE.Group(); gnome.armL.hand.add(shieldHold);

function makeHeld(id: string) {
  const g = new THREE.Group(), d = ITEMS[id]; if (!d) return g;
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9 });
  const tier = d.tier || 1, tc = ({ 1: 0xb58a55, 2: 0x8e9094, 3: 0xcfd6de, 4: 0x33254d } as Record<number, number>)[tier];
  const headM = new THREE.MeshStandardMaterial({ color: tc, roughness: tier === 3 ? 0.25 : 0.7, metalness: tier === 3 ? 0.85 : 0.1 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx?: number, ry?: number, rz?: number) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx || 0, ry || 0, rz || 0); o.castShadow = true; g.add(o); return o; };
  if (d.tool === 'axe') { add(new THREE.CylinderGeometry(0.035, 0.04, 0.85, 8), wood, 0, 0.32, 0); add(new THREE.BoxGeometry(0.3, 0.24, 0.05), headM, 0.14, 0.7, 0); add(new THREE.BoxGeometry(0.06, 0.34, 0.06), headM, 0.3, 0.7, 0); }
  else if (d.tool === 'pick') { add(new THREE.CylinderGeometry(0.035, 0.04, 0.85, 8), wood, 0, 0.32, 0); add(new THREE.BoxGeometry(0.72, 0.07, 0.07), headM, 0, 0.75, 0); add(new THREE.ConeGeometry(0.05, 0.16, 6), headM, 0.42, 0.75, 0, 0, 0, -Math.PI / 2); add(new THREE.ConeGeometry(0.05, 0.16, 6), headM, -0.42, 0.75, 0, 0, 0, Math.PI / 2); }
  else if (d.tool === 'shovel') { add(new THREE.CylinderGeometry(0.035, 0.04, 0.85, 8), wood, 0, 0.32, 0); add(new THREE.BoxGeometry(0.06, 0.06, 0.2), wood, 0, 0.78, 0); add(new THREE.BoxGeometry(0.24, 0.36, 0.035), headM, 0, 0.0 - 0.02, 0.0).position.set(0, 0.86 - 0.02, 0); }
  else if (d.tool === 'sword') { add(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), wood, 0, 0.1, 0); add(new THREE.BoxGeometry(0.3, 0.05, 0.06), new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.6, roughness: 0.4 }), 0, 0.22, 0); add(new THREE.BoxGeometry(0.09, 0.78, 0.02), headM, 0, 0.64, 0); add(new THREE.ConeGeometry(0.045, 0.14, 4), headM, 0, 1.08, 0); }
  else if (d.k === 'shield') {
    const face = id === 'cshield' ? 0x33254d : id === 'eshield' ? 0x1d5a6a : id === 'wshield' ? 0xb98450 : tc, m = new THREE.MeshStandardMaterial({ color: face, roughness: tier === 3 ? 0.3 : 0.7, metalness: tier === 3 ? 0.8 : 0.1 });
    add(new THREE.CylinderGeometry(0.4, 0.4, 0.07, 20), m, 0, 0, 0, Math.PI / 2, 0, 0); add(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshStandardMaterial({ color: id === 'cshield' ? 0x8f6bd6 : id === 'eshield' ? 0x7ff0ff : 0xd8b04a, metalness: 0.7, roughness: 0.3 }), 0, 0, 0.05);
    add(new THREE.TorusGeometry(0.4, 0.03, 6, 20), new THREE.MeshStandardMaterial({ color: 0x3a3a3e, metalness: 0.7, roughness: 0.4 }), 0, 0, 0);
  } else if (d.k === 'block') { add(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: BCOL[d.bid!] || 0xaaaaaa, roughness: 0.9, emissive: d.bid === B.CRYSTAL ? 0x2288aa : 0x000000 }), 0, 0.16, 0.05); }
  else if (d.k === 'station') { const c = ({ bench: 0xb98450, furnace: 0x86888d, camp: 0xd9812a, bed: 0xb7362d, torch: 0xffb030, lantern: 0x5fe0ff, ladder: 0x9a6a3a, crop: 0x6b8f3a, door: 0x9a6a3a } as Record<string, number>)[d.place!] || 0xaaaaaa; add(new THREE.BoxGeometry(0.32, 0.32, 0.32), new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, emissive: d.place === 'lantern' ? 0x176070 : 0x000000 }), 0, 0.18, 0.05); }
  else if (d.k === 'food') { const c = ({ berries: 0xc0223a, mushroom: 0xc9a066, cmush: 0x8a4a1e, bandage: 0xf1ece0, meat: 0xd9707a, cmeat: 0x8a4a2a } as Record<string, number>)[id]; add(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }), 0, 0.12, 0.04); }
  else { const c = ({ wood: 0x7b5330, stick: 0x7a5230, stone: 0x8d8f93, fiber: 0xb7c66a, ore: 0x6f6a66, ingot: 0xd5dbe2, shell: 0x33254d, coal: 0x2a2a2e } as Record<string, number>)[id] || 0xaaaaaa; add(new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: id === 'ingot' ? 0.8 : 0 }), 0, 0.12, 0.04); }
  return g;
}
let heldKey = '', shieldKey = '';
function updateHeld() {
  const s = inv[sel], id = s ? s.id : '', sh = bestShield(), sid = sh ? sh.id : '';
  if (id !== heldKey) {
    heldKey = id; while (held.children.length) held.remove(held.children[0]);
    if (id) { const m = makeHeld(id); m.rotation.x = 1.15; held.add(m); }
  }
  if (sid !== shieldKey) {
    shieldKey = sid; while (shieldHold.children.length) shieldHold.remove(shieldHold.children[0]);
    if (sid) { const m = makeHeld(sid); m.scale.setScalar(0.9); shieldHold.add(m); }
  }
}

/* ================= aiming ================= */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(0, 0), aim: Aim = { type: null, cell: null, ok: false, place: null, placeOK: false, pt: new THREE.Vector3(), node: null, block: null, enemy: null, resident: null, site: null };
function rayCyl(o: THREE.Vector3, d: THREE.Vector3, cx: number, cz: number, r: number, y0: number, y1: number) {
  const ox = o.x - cx, oz = o.z - cz, a = d.x * d.x + d.z * d.z, c = ox * ox + oz * oz - r * r;
  let enter = 0, leave = Infinity;
  if (a < 1e-8) { if (c > 0) return null; }
  else {
    const b = 2 * (ox * d.x + oz * d.z), disc = b * b - 4 * a * c; if (disc < 0) return null;
    const sq = Math.sqrt(disc); enter = Math.max(enter, (-b - sq) / (2 * a)); leave = (-b + sq) / (2 * a);
  }
  if (Math.abs(d.y) < 1e-8) { if (o.y < y0 - 0.1 || o.y > y1) return null; }
  else { const a = (y0 - 0.1 - o.y) / d.y, b = (y1 - o.y) / d.y; enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b)); }
  return enter <= leave ? enter : null;
}
function computeAim() {
  if (locked || isTouch) ndc.set(0, 0); else ndc.set(mouseX / innerWidth * 2 - 1, -(mouseY / innerHeight * 2 - 1));
  camera.updateMatrixWorld(); ray.setFromCamera(ndc, camera); const o = ray.ray.origin, d = ray.ray.direction;
  aim.type = null; aim.drop = null; aim.pickup = null; aim.node = null; aim.block = null; aim.enemy = null; aim.resident = null; aim.site = null; aim.place = null; aim.cell = null; aim.ok = false; aim.placeOK = false;
  let bestT = 1e9;
  nearChunks(ch => { for (const n of ch.nodes) {
    if (n.dead) continue;
    let t = rayCyl(o, d, n.x, n.z, n.r + 0.15, n.y0, n.y0 + n.h);
    if (n.label && t !== null) { n.mesh.updateWorldMatrix(true, false); t = ray.intersectObject(n.mesh)[0]?.distance ?? null; }
    if (t !== null && t < bestT) { bestT = t; aim.type = 'node'; aim.node = n; }
  } });
  const held = inv[sel], placing = held && ['block', 'station'].includes(ITEMS[held.id].k);
  if (!placing) nearChunks(ch => { for (const p of ch.picks) {
    if (p.dead || Math.hypot(p.x - P.x, p.z - P.z) > REACH + 2) continue;
    const y = p.y ?? H(p.x, p.z), t = rayCyl(o, d, p.x, p.z, p.r ?? 0.35, y, y + (p.h ?? 0.6));
    if (t !== null && t < bestT) { bestT = t; aim.type = 'pickup'; aim.pickup = p; aim.node = null; }
  } });
  if (!placing) for (const drop of worldDrops) {
    const t = rayCyl(o, d, drop.x, drop.z, 0.4, drop.y, drop.y + 0.7);
    if (t !== null && t < bestT) { bestT = t; aim.type = 'drop'; aim.drop = drop; }
  }
  for (const e of enemies) { if (e.dying) continue; const t = rayCyl(o, d, e.x, e.z, e.rad ?? 0.85, e.y, e.y + (e.boss ? 3 : 1.0)); if (t !== null && t < bestT) { bestT = t; aim.type = 'enemy'; aim.enemy = e; aim.node = null; } }
  for (const r of residents) { const t = rayCyl(o, d, r.x, r.z, 0.5, r.y, r.y + 0.9); if (t !== null && t < bestT) { bestT = t; aim.type = 'resident'; aim.resident = r; aim.node = null; aim.enemy = null; } }
  for (const part of siteParts) { const t = rayCyl(o, d, part.x, part.z, part.siteId === 'door' ? 1.1 : 0.65, part.y, part.y + (part.siteId === 'door' ? 2.8 : 2.3)); if (t !== null && t < bestT) { bestT = t; aim.type = 'site'; aim.site = part; aim.node = null; aim.enemy = null; aim.resident = null; } }
  let prev: number[] | null = null, li = 1e9, lj = 0, lk = 0; const tmax = Math.min(bestT, 20);
  for (let t = 0.4; t < tmax; t += 0.07) {
    const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t, i = Math.floor(px), j = Math.floor(py), k = Math.floor(pz);
    if (i === li && j === lj && k === lk) continue; li = i; lj = j; lk = k;
    if (blocks.size) { const b = blocks.get(key(i, j, k)); if (b) { bestT = t; aim.type = 'block'; aim.block = b; aim.node = null; aim.enemy = null; aim.place = prev; break; } }
    if (SOLIDB[getBlock(i, j, k)]) { bestT = t; aim.type = 'ground'; aim.cell = [i, j, k]; aim.node = null; aim.enemy = null; aim.place = prev; break; }
    prev = [i, j, k];
  }
  if (aim.type) {
    aim.pt.set(o.x + d.x * bestT, o.y + d.y * bestT, o.z + d.z * bestT);
    aim.ok = Math.hypot(aim.pt.x - P.x, aim.pt.y - (P.y + 0.9), aim.pt.z - P.z) < REACH;
    { const an = aim.node as SceneNode | null; if ((aim.type as Aim['type']) === 'node' && an) aim.ok = Math.hypot(an.x - P.x, an.z - P.z) < REACH + an.r; }
    if ((aim.type as Aim['type']) === 'resident' && aim.resident) aim.ok = Math.hypot(aim.resident.x - P.x, aim.resident.z - P.z) < REACH + 0.5;
    if ((aim.type as Aim['type']) === 'site' && aim.site) aim.ok = Math.hypot(aim.site.x - P.x, aim.site.z - P.z) < REACH + 1;
    if (aim.type === 'enemy') aim.ok = Math.hypot(aim.enemy!.x - P.x, aim.enemy!.z - P.z) < REACH + ((aim.enemy!.rad ?? 0.85) - 0.85);
    if (aim.place) {
      const [i, j, k] = aim.place;
      let ok = !solid(i, j, k) && !blocks.has(key(i, j, k)) && Math.hypot(i + 0.5 - P.x, k + 0.5 - P.z) < REACH + 1.2;
      const hs = inv[sel], hd = hs ? ITEMS[hs.id] : null, nsItem = !!hd && hd.k === 'station' && !!BDEF[hd.place!] && !!BDEF[hd.place!].ns;
      if (!nsItem && Math.abs(i + 0.5 - P.x) < PRAD + 0.5 && Math.abs(k + 0.5 - P.z) < PRAD + 0.5 && j < P.y + PHGT && j + 1 > P.y + 0.05) ok = false;
      if (!nsItem) for (const e of enemies) if (Math.abs(i + 0.5 - e.x) < 1.0 && Math.abs(k + 0.5 - e.z) < 1.0) ok = false;
      aim.placeOK = ok;
    }
  }
}
const ghost = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.35, depthWrite: false }));
ghost.visible = false; ghost.renderOrder = 5; scene.add(ghost);
const selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, 1.01, 1.01)), new THREE.LineBasicMaterial({ color: 0xffffff })); selBox.visible = false; scene.add(selBox);

/* ================= enemies: gloom beetles ================= */
const enemies: Enemy[] = [];
function makeBeetle() {
  const g = new THREE.Group(), shell = new THREE.MeshStandardMaterial({ color: 0x2a1f3d, roughness: 0.3, metalness: 0.55 }), dk = new THREE.MeshStandardMaterial({ color: 0x140d1e, roughness: 0.5 });
  const S1 = new THREE.SphereGeometry(1, 16, 12);
  const body = new THREE.Mesh(S1, shell); body.scale.set(0.55, 0.4, 0.82); body.position.y = 0.45; g.add(body);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 1.3), new THREE.MeshStandardMaterial({ color: 0x6b4ba8, roughness: 0.3, metalness: 0.6 })); ridge.position.set(0, 0.84, -0.05); g.add(ridge);
  const head = new THREE.Mesh(S1, dk); head.scale.set(0.3, 0.24, 0.3); head.position.set(0, 0.42, 0.8); g.add(head);
  const eyeM = new THREE.MeshBasicMaterial({ color: 0xff4030 });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), eyeM); e.position.set(s * 0.13, 0.5, 1.03); g.add(e); const m = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.28, 6), dk); m.position.set(s * 0.14, 0.34, 1.05); m.rotation.set(Math.PI / 2, 0, s * 0.5); g.add(m); }
  const legs: { p: THREE.Group; ph: number }[] = [];
  for (const s of [-1, 1]) for (const z of [0.4, 0, -0.4]) { const p = new THREE.Group(); p.position.set(s * 0.42, 0.42, z); const l = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.62, 5), dk); l.position.set(s * 0.3, -0.12, 0); l.rotation.z = -s * 1.1; p.add(l); g.add(p); legs.push({ p, ph: (z > 0 ? 0 : Math.PI) + (s > 0 ? 0 : Math.PI / 2) }); }
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8; const tex = new THREE.CanvasTexture(cv);
  const bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })); bar.scale.set(1.3, 0.16, 1); bar.position.y = 1.5; g.add(bar);
  return { g, legs, bar, cv, tex };
}
function drawBar(e: Enemy) {
  const c = ctx2d(e.cv); c.clearRect(0, 0, 64, 8); c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, 0, 64, 8); c.fillStyle = '#d9483b'; c.fillRect(1, 1, 62 * clamp(e.hp / e.max, 0, 1), 6); e.tex.needsUpdate = true;
}
let spawnT = 6, caveT = 12, lastBossDay = 0;
function spawnBeetle() {
  if (inSpawnSanctuary(P.x, P.z)) return;
  let x = 0, z = 0, y = 0, cave = false;
  if (ugU > 0.5) {
    let ok = false;
    for (let t = 0; t < 24 && !ok; t++) {
      const a = Math.random() * TAU, d = 7 + Math.random() * 12; x = P.x + Math.cos(a) * d; z = P.z + Math.sin(a) * d; const i = Math.floor(x), k = Math.floor(z);
      for (let j = Math.floor(P.y) + 5; j > Math.floor(P.y) - 6; j--) if (!solid(i, j, k) && !solid(i, j + 1, k) && solid(i, j - 1, k) && getBlock(i, j, k) !== B.LAVA && getBlock(i, j, k) !== B.WATER) { y = j; ok = true; cave = true; break; }
    }
    if (!ok) return;
  } else {
    const a = Math.random() * TAU, d = 26 + Math.random() * 10; x = P.x + Math.cos(a) * d; z = P.z + Math.sin(a) * d;
    if (WG.terr(Math.floor(x), Math.floor(z)).h <= SEA + 1) return; y = surf(x, z);
  }
  if (inSpawnSanctuary(x, z, 4) || fireNear(x, z, 9)) return;
  const m = makeBeetle();
  const e: Enemy = { x, z, y, cave, vx: 0, vz: 0, hp: 30, max: 30, cd: 1, heading: 0, phase: Math.random() * 6, dying: 0, burn: 0, kx: 0, kz: 0, ...m };
  e.g.position.set(x, e.y, z); e.g.scale.setScalar(1.15); scene.add(e.g); drawBar(e); enemies.push(e);
}
/** The Elder Beetle: a much larger beetle with its own attack pattern (see systems/boss.ts). */
function spawnBoss(day: number) {
  if (inSpawnSanctuary(P.x, P.z)) return;
  const a = Math.random() * TAU, d = 32 + Math.random() * 6, x = P.x + Math.cos(a) * d, z = P.z + Math.sin(a) * d;
  if (WG.terr(Math.floor(x), Math.floor(z)).h <= SEA + 1 || inSpawnSanctuary(x, z, 6) || fireNear(x, z, 9)) return;
  const m = makeBeetle();
  m.g.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh && mesh.material instanceof THREE.MeshStandardMaterial) { const mat = mesh.material.clone(); mat.emissive.set(0x3a1466); mesh.material = mat; } });
  m.bar.visible = false;
  const e: Enemy = { x, z, y: surf(x, z), cave: false, vx: 0, vz: 0, hp: BOSS_HP, max: BOSS_HP, cd: 1, heading: 0, phase: 0, dying: 0, burn: 0, kx: 0, kz: 0, boss: newBoss(), base: BOSS_SCALE, rad: BOSS_SCALE * 0.9, ...m };
  e.g.position.set(x, e.y, z); e.g.scale.setScalar(BOSS_SCALE); scene.add(e.g); enemies.push(e); lastBossDay = day;
  toast('The ground trembles. Something ancient has woken.', true, 4200); sfx.growl();
}
function updateBoss(e: Enemy, dt: number) {
  const b = e.boss!, dx = P.x - e.x, dz = P.z - e.z, d = Math.hypot(dx, dz) || 1, tx = dx / d, tz = dz / d, prev = b.phase;
  const r = stepBoss(b, dt, state === 'play' ? d : 99, e.hp / e.max);
  if (prev === 'windup' && b.phase === 'charge') { e.vx = tx * CHARGE_SPEED; e.vz = tz * CHARGE_SPEED; }
  else if (b.phase === 'stalk') { const sp = state === 'play' ? speedOf(b) : 0; e.vx += (tx * sp - e.vx) * Math.min(1, dt * 4); e.vz += (tz * sp - e.vz) * Math.min(1, dt * 4); }
  else if (b.phase !== 'charge') { e.vx *= 0.8; e.vz *= 0.8; }
  e.x += e.vx * dt; e.z += e.vz * dt;
  const o = { x: e.x, z: e.z }; pushFromBlocks(o, 1.2, e.y + 1.02, e.y + 1.9); e.x = o.x; e.z = o.z;
  nearChunksAt(e.x, e.z, ch => { for (const c of ch.col) { const ax = e.x - c.x, az = e.z - c.z, dd = Math.hypot(ax, az), md = c.r + 1.4; if (dd < md && dd > 1e-4) { e.x = c.x + ax / dd * md; e.z = c.z + az / dd * md; } } });
  e.y += (floorY(e.x, e.z, e.y) - e.y) * Math.min(1, dt * 12);
  if (b.phase !== 'charge') e.heading += angDiff(Math.atan2(tx, tz), e.heading) * Math.min(1, dt * 5);
  if (r.hit && state === 'play' && clearSight(e, P, solid)) {
    damagePlayer(BOSS_DAMAGE, e); shake = Math.max(shake, 0.6);
    if (b.phase === 'recover' && prev === 'slam') burst(e.x + tx * 2.4, e.y + 0.2, e.z + tz * 2.4, 0x8a7a5a, 14);
  }
  if (prev === 'slam') { sfx.brk(); shake = Math.max(shake, d < 22 ? 0.5 : 0); burst(e.x + tx * 2.4, e.y + 0.2, e.z + tz * 2.4, 0x8a7a5a, 14); }
  e.phase += Math.hypot(e.vx, e.vz) * dt * 1.6;
  const rear = b.phase === 'windup' ? Math.min(1, b.t / WINDUP) : b.phase === 'recover' ? -0.25 : 0;
  e.g.position.set(e.x, e.y + Math.abs(Math.sin(e.phase)) * 0.06, e.z); e.g.rotation.set(-rear * 0.5, e.heading, 0);
  e.g.scale.setScalar(BOSS_SCALE * (b.phase === 'windup' ? 1 + 0.07 * Math.sin(b.t * 30) : 1));
  for (const l of e.legs) l.p.rotation.x = Math.sin(e.phase + l.ph) * 0.5;
}
function updateBossBar() {
  const b = enemies.find(q => q.boss && !q.dying), el = $('boss');
  if (!b) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden'); $('bossF').style.width = clamp(b.hp / b.max * 100, 0, 100) + '%'; $('bossName').textContent = BOSS_NAME + (b.boss!.enraged ? ' (enraged)' : '');
}
function removeEnemy(e: Enemy) { scene.remove(e.g); e.tex.dispose(); const i = enemies.indexOf(e); if (i >= 0) enemies.splice(i, 1); }
function fireNear(x: number, z: number, r: number) { for (const b of stations) if (Math.hypot(b.i + 0.5 - x, b.k + 0.5 - z) < beetleWardRadius(b.t, r)) return b; return null; }
function updateEnemies(dt: number, t: number) {
  const day = Math.floor(todT / DAY_LEN);
  spawnT -= dt; caveT -= dt;
  if (state === 'play' && ugU > 0.6 && caveT <= 0 && enemies.filter(q => q.cave).length < 2) { spawnBeetle(); caveT = 18 + Math.random() * 10; }
  if (state === 'play' && ugU <= 0.6 && TOD.night > 0.35 && enemies.length < Math.min(6, 2 + day) && spawnT <= 0) { spawnBeetle(); spawnT = 12 + Math.random() * 6; }
  if (state === 'play' && shouldSpawn({ day: day + 1, night: TOD.night, underground: ugU > 0.4, bossOut: enemies.some(q => !!q.boss), lastBossDay, defeated: progress.has('kill:elder') })) spawnBoss(day + 1);
  for (const e of enemies.slice()) {
    // A returning player can always take refuge here, even during a boss charge.
    if (inSpawnSanctuary(P.x, P.z) || inSpawnSanctuary(e.x, e.z, 2)) { removeEnemy(e); continue; }
    if (e.dying) { e.dying += dt; e.g.scale.setScalar(Math.max(0.01, (e.base ?? 1.15) * (1 - e.dying * 1.6))); if (e.dying > 0.65) removeEnemy(e); continue; }
    if ((!e.cave && TOD.night < 0.12) || Math.hypot(e.x - P.x, e.z - P.z) > 70) { e.burn += dt; e.g.scale.setScalar(Math.max(0.01, (e.base ?? 1.15) * (1 - e.burn * 0.5))); if (e.burn > 1.9) { removeEnemy(e); continue; } }
    if (e.boss) { updateBoss(e, dt); continue; }
    const dx = P.x - e.x, dz = P.z - e.z, d = Math.hypot(dx, dz) || 1; let tx = 0, tz = 0, sp = 0;
    e.chasing = state === 'play' && beetlePursues(d, !!e.chasing, !!fireNear(P.x, P.z, 9), d < 16 && clearSight(e, P, solid));
    if (e.chasing) { tx = dx / d; tz = dz / d; sp = 2.6; }
    const f = fireNear(e.x, e.z, 9); if (f) { const fx = e.x - (f.i + 0.5), fz = e.z - (f.k + 0.5), fl = Math.hypot(fx, fz) || 1; tx = fx / fl; tz = fz / fl; sp = 4; }
    e.vx += (tx * sp - e.vx) * Math.min(1, dt * 6); e.vz += (tz * sp - e.vz) * Math.min(1, dt * 6);
    e.x += (e.vx + e.kx) * dt; e.z += (e.vz + e.kz) * dt; e.kx *= 0.88; e.kz *= 0.88;
    const o = { x: e.x, z: e.z }; pushFromBlocks(o, 0.55, e.y + 1.02, e.y + 1.9); e.x = o.x; e.z = o.z;
    nearChunksAt(e.x, e.z, ch => { for (const c of ch.col) { const ax = e.x - c.x, az = e.z - c.z, dd = Math.hypot(ax, az), md = c.r + 0.55; if (dd < md && dd > 1e-4) { e.x = c.x + ax / dd * md; e.z = c.z + az / dd * md; } } });
    e.y += (floorY(e.x, e.z, e.y) - e.y) * Math.min(1, dt * 12);
    if (sp > 0.1 && !f) e.heading += angDiff(Math.atan2(tx, tz), e.heading) * Math.min(1, dt * 8);
    e.phase += Math.hypot(e.vx, e.vz) * dt * 3; e.cd -= dt;
    if (state === 'play' && e.chasing && !f && d < 1.6 && e.cd <= 0 && Math.abs(P.y - e.y) < 1.4) { e.cd = 1.8; damagePlayer(7 + Math.min(day, 5), e); }
    e.g.position.set(e.x, e.y + Math.abs(Math.sin(e.phase)) * 0.03, e.z); e.g.rotation.y = e.heading;
    for (const l of e.legs) l.p.rotation.x = Math.sin(e.phase + l.ph) * 0.6;
  }
}
/* ================= wildlife: thistle hares ================= */
const critters: Critter[] = []; let spawnH = 3;
function makeHare() {
  const g = new THREE.Group(), fur = new THREE.MeshStandardMaterial({ color: 0x9b8468, roughness: 0.95 }), lt = new THREE.MeshStandardMaterial({ color: 0xe9e2d3, roughness: 0.95 }), dk = new THREE.MeshStandardMaterial({ color: 0x1e1712, roughness: 0.4 });
  const S1 = new THREE.SphereGeometry(1, 12, 10), ball = (m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => { const o = new THREE.Mesh(S1, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  const body = ball(fur, 0.3, 0.26, 0.46, 0, 0.34, 0); ball(fur, 0.27, 0.25, 0.3, 0, 0.3, -0.24); ball(fur, 0.2, 0.19, 0.24, 0, 0.5, 0.42); ball(lt, 0.09, 0.09, 0.09, 0, 0.36, -0.52);
  for (const sg of [-1, 1]) { const ear = ball(fur, 0.05, 0.25, 0.06, sg * 0.08, 0.78, 0.38); ear.rotation.z = -sg * 0.15; ball(dk, 0.03, 0.035, 0.03, sg * 0.1, 0.54, 0.58); ball(lt, 0.07, 0.07, 0.12, sg * 0.1, 0.16, 0.3); }
  return { g, body };
}
function spawnHare() {
  const a = Math.random() * TAU, d = 22 + Math.random() * 28, x = P.x + Math.cos(a) * d, z = P.z + Math.sin(a) * d, t = WG.terr(Math.floor(x), Math.floor(z));
  if (t.h <= SEA + 2 || t.biome === BIOME.PEAKS || t.biome === BIOME.DUNES || WG.slope(Math.floor(x), Math.floor(z)) >= 2) return;
  const m = makeHare(), c: Critter = { x, z, y: surf(x, z), vx: 0, vz: 0, hp: 12, kx: 0, kz: 0, heading: Math.random() * TAU, timer: 0, wa: 0, wander: false, hop: Math.random() * 6, dying: 0, ...m };
  c.g.position.set(x, c.y, z); scene.add(c.g); critters.push(c);
}
function removeCritter(c: Critter) { scene.remove(c.g); const i = critters.indexOf(c); if (i >= 0) critters.splice(i, 1); }
function hitCritter(c: Critter, ts: ToolStats) {
  c.hp -= ts.dmg; c.kx = (c.x - P.x) * 3; c.kz = (c.z - P.z) * 3; burst(c.x, c.y + 0.4, c.z, 0xb7a080, 6); sfx.squish(); wear(ts);
  if (c.hp <= 0) { c.dying = 0.001; note('kill:hare'); giveItem('meat', 1 + (Math.random() < 0.45 ? 1 : 0)); }
}
function updateCritters(dt: number) {
  spawnH -= dt;
  if (state === 'play' && TOD.night < 0.25 && ugU < 0.3 && critters.length < 6 && spawnH <= 0) { spawnHare(); spawnH = 4 + Math.random() * 4; }
  for (const c of critters.slice()) {
    if (c.dying) { c.dying += dt; c.g.scale.setScalar(Math.max(0.01, 1 - c.dying * 2)); if (c.dying > 0.5) removeCritter(c); continue; }
    const dx = c.x - P.x, dz = c.z - P.z, d = Math.hypot(dx, dz) || 1;
    if (d > 95 || (TOD.night > 0.5 && d > 22)) { removeCritter(c); continue; }
    let tx = 0, tz = 0, sp = 0; c.timer -= dt;
    if (d < 9 && state === 'play') { tx = dx / d; tz = dz / d; sp = 6.5; }
    else { if (c.timer <= 0) { c.timer = 1.5 + Math.random() * 3; c.wa = Math.random() * TAU; c.wander = Math.random() < 0.6; } if (c.wander) { tx = Math.cos(c.wa); tz = Math.sin(c.wa); sp = 1.5; } }
    c.vx += (tx * sp - c.vx) * Math.min(1, dt * 7); c.vz += (tz * sp - c.vz) * Math.min(1, dt * 7);
    const ox = c.x, oz = c.z; c.x += (c.vx + c.kx) * dt; c.z += (c.vz + c.kz) * dt; c.kx *= 0.86; c.kz *= 0.86;
    const o = { x: c.x, z: c.z }; pushFromBlocks(o, 0.35, c.y + 1.02, c.y + 1.6); c.x = o.x; c.z = o.z;
    nearChunksAt(c.x, c.z, ch => { for (const q of ch.col) { const ax = c.x - q.x, az = c.z - q.z, dd = Math.hypot(ax, az), md = q.r + 0.35; if (dd < md && dd > 1e-4) { c.x = q.x + ax / dd * md; c.z = q.z + az / dd * md; } } });
    if (getBlock(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z)) === B.WATER || WG.terr(Math.floor(c.x), Math.floor(c.z)).h <= SEA + 1) { c.x = ox; c.z = oz; c.wa += Math.PI; }
    c.y += (floorY(c.x, c.z, c.y) - c.y) * Math.min(1, dt * 12);
    if (sp > 0.1) c.heading += angDiff(Math.atan2(tx, tz), c.heading) * Math.min(1, dt * 9);
    c.hop += Math.hypot(c.vx, c.vz) * dt * (sp > 3 ? 2.2 : 3.5);
    const h = Math.abs(Math.sin(c.hop)) * (sp > 3 ? 0.42 : 0.16); c.g.position.set(c.x, c.y + h, c.z); c.g.rotation.set(0, c.heading, 0); c.body.rotation.x = Math.cos(c.hop) * 0.15 * (sp > 0.1 ? 1 : 0);
  }
}
function nearChunksAt(x: number, z: number, fn: (ch: Chunk) => void) { const pcx = Math.round(x / S), pcz = Math.round(z / S); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const ch = chunks.get((pcx + dx) + ',' + (pcz + dz)); if (ch) fn(ch); } }

/* ================= combat and survival ================= */
function damagePlayer(amt: number, src?: { x: number; z: number; kx?: number; kz?: number } | null) {
  if (src && inSpawnSanctuary(P.x, P.z)) return;
  if (P.invuln > 0 || state !== 'play') return;
  const sh = bestShield();
  if (P.blocking && sh && src) {
    const ax = src.x - P.x, az = src.z - P.z, l = Math.hypot(ax, az) || 1, facing = (Math.sin(P.heading) * ax + Math.cos(P.heading) * az) / l;
    if (facing > 0.0) {
      amt *= 1 - ITEMS[sh.id].reduce!; sh.dur! -= 1; P.stamina = Math.max(0, P.stamina - 10); sfx.clang(); burst(P.x + Math.sin(P.heading) * 0.6, P.y + 1, P.z + Math.cos(P.heading) * 0.6, 0xffe9a0, 6);
      if (sh.dur! <= 0) { const i = inv.indexOf(sh); inv[i] = null; toast('Your shield broke', true); updateHeld(); renderHot(); }
      else renderHot();
      if (src.kx !== undefined) { src.kx = ax * -0.5 / l * 10; src.kz = az * -0.5 / l * 10; }
    }
  } else { sfx.bite(); dmgFlash = 1; shake = 0.5; }
  P.hp -= amt; P.invuln = 0.45; if (amt > 3) { sfx.hurt(); dmgFlash = Math.max(dmgFlash, 0.8); }
  if (src) { const ax = P.x - src.x, az = P.z - src.z, l = Math.hypot(ax, az) || 1; P.kx = ax / l * 4; P.kz = az / l * 4; }
  if (P.hp <= 0) die();
}
function toolStats(): ToolStats {
  const s = inv[sel], d = s ? ITEMS[s.id] : null;
  if (!d || d.k !== 'tool') return { d: null, chop: CHOP[0], mine: 0, dmg: 2, range: 1.9, blockPow: 0.7 };
  return { d, s, chop: d.tool === 'axe' ? CHOP[d.tier!] : CHOP[0], mine: d.tool === 'pick' ? MINE[d.tier!] : 0, dmg: DMG[d.tool!][d.tier!], range: d.tool === 'sword' ? 2.7 : 2.2, blockPow: d.tool === 'axe' ? CHOP[d.tier!] : d.tool === 'pick' ? MINE[d.tier!] : d.tool === 'shovel' ? DIGP[d.tier!] : 1 };
}
function wear(ts: ToolStats) { if (!ts.s) return; ts.s.dur! -= 1; if (ts.s.dur! <= 0) { const i = inv.indexOf(ts.s); if (i >= 0) inv[i] = null; toast('Your ' + ts.d!.n.toLowerCase() + ' broke', true); sfx.brk(); updateHeld(); } renderHot(); }
function startSwing() { P.swing = 0.34; P.swingHit = false; P.cool = 0.42; const cf = Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw)); P.heading = cf; sfx.swing(); }
function useItem() {
  if (P.cool > 0 || state !== 'play' || uiOpen || paused) return;
  const s = inv[sel], d = s ? ITEMS[s.id] : null, kind = d ? d.k : 'hand';
  if (kind === 'food') {
    if (d!.food! > 0 && P.hunger >= 99 && d!.heal === 0) { toast('You are not hungry'); return; }
    if (d!.heal! > 0 && P.hp >= 99 && d!.food === 0) { toast('You are healthy'); return; }
    P.hunger = Math.min(100, P.hunger + d!.food!); P.hp = Math.min(100, P.hp + d!.heal!); note('eat:' + s!.id); s!.n--; if (s!.n <= 0) inv[sel] = null; P.cool = 0.5; sfx.eat(); stopHarvest(); renderHot(); updateHeld(); return;
  }
  if (kind === 'block' || kind === 'station') { tryPlace(); return; }
  startSwing();
}
function tryPlace() {
  if (!aim.place || !aim.placeOK) { toast('You cannot place that there', true, 1200); P.cool = 0.25; return; }
  const [i, j, k] = aim.place, s = inv[sel]!, d = ITEMS[s.id]; if (d.k === 'station') {
    if (d.place === 'door') {
      const near = Math.abs(i + 0.5 - P.x) < PRAD + 0.5 && Math.abs(k + 0.5 - P.z) < PRAD + 0.5 && j + 1 < P.y + PHGT && j + 2 > P.y + 0.05;
      if (solid(i, j + 1, k) || blocks.has(key(i, j + 1, k)) || near) { toast('A door needs two free blocks of height', true, 1500); P.cool = 0.25; return; }
    }
    if (d.place === 'crop' && !isSoil(getBlock(i, j - 1, k))) { toast('Seeds need soil: grass or dirt', true, 1500); P.cool = 0.25; return; }
    const pb = placeStation(i, j, k, d.place!); note('place:' + d.place);
    if (pb.t === 'crop') toast(pb.wet ? 'Planted. Water is close, so it will grow well' : 'Planted. No water nearby, so it will grow slowly', false, 2600);
  } else setVox(i, j, k, d.bid!); s.n--; if (s.n <= 0) inv[sel] = null;
  P.cool = 0.22; sfx.place(); renderHot(); updateHeld(); if (d.place === 'camp') tip('camp', 'Beetles avoid the fire. Stay close to it at night.');
}
function resolveSwing() {
  const ts = toolStats(), fx = Math.sin(P.heading), fz = Math.cos(P.heading);
  let best: Enemy | null = null, bd = 1e9;
  for (const e of enemies) { if (e.dying) continue; const dx = e.x - P.x, dz = e.z - P.z, d = Math.hypot(dx, dz); if (d < ts.range + 0.6 + ((e.rad ?? 0.85) - 0.85) && (dx * fx + dz * fz) / (d || 1) > 0.25 && d < bd) { bd = d; best = e; } }
  if (best) { hitEnemy(best, ts); return; }
  let hb: Critter | null = null, hd = 1e9;
  for (const c of critters) { if (c.dying) continue; const dx = c.x - P.x, dz = c.z - P.z, d = Math.hypot(dx, dz); if (d < ts.range + 0.7 && (dx * fx + dz * fz) / (d || 1) > 0.2 && d < hd) { hd = d; hb = c; } }
  if (hb) { hitCritter(hb, ts); return; }
  if (aim.ok && aim.type === 'pickup' && aim.pickup) { harvestPickup(aim.pickup, true); return; }
  if (aim.ok && aim.type === 'node' && aim.node) { hitNode(aim.node, ts); return; }
  if (aim.ok && aim.type === 'block' && aim.block) { hitBlock(aim.block, ts); return; }
  if (aim.ok && aim.type === 'ground' && aim.cell) { hitGround(aim.cell, ts); return; }
}
function hitEnemy(e: Enemy, ts: ToolStats) {
  e.hp -= ts.dmg * (e.boss ? damageMult(e.boss) : 1); if (!e.boss) { e.kx = (e.x - P.x) * 3; e.kz = (e.z - P.z) * 3; } sfx.squish(); burst(e.x, e.y + 0.6, e.z, 0x8f6bd6, 8); drawBar(e); wear(ts);
  if (e.hp <= 0 && e.boss) { e.dying = 0.001; tally.kills++; note('kill:elder'); giveItem('eshell', 3); giveItem('shell', 3); toast('The Elder Beetle falls. Its carapace is yours.', false, 4200); }
  else if (e.hp <= 0) { e.dying = 0.001; tally.kills++; note('kill:beetle'); if (Math.random() < 0.7) giveItem('shell', 1 + (Math.random() < 0.35 ? 1 : 0)); }
}
function giveItem(id: string, n: number) {
  const left = addItem(id, n);
  if (left < n) { toast('+' + (n - left) + ' ' + ITEMS[id].n, false, 1300); tallyAdd(tally, 'gathered', id, n - left); note('got:' + id); }
  if (left > 0) { dropSlot({ id, n: left, dur: ITEMS[id].dur }); toast('Pack full: ' + left + ' ' + ITEMS[id].n + ' left in a gold bundle at your feet', true, 2600); }
  if (id === 'wood') tip('wood', 'Open your pack with Tab. Turn wood into planks and sticks, then build a workbench.');
  if (id === 'stone') tip('stone', 'Stone plus wood makes a campfire. Rocks need a pickaxe.');
  if (id === 'dirt') tip('dirt', 'Place dirt to build up land or plug a hole. A shovel digs it fastest.');
  if (id === 'coal') tip('coal', 'Coal plus a stick makes torches. Torches light caves and keep beetles away.');
  if (id === 'crystal') tip('crystal', 'Glow crystals shine on their own. Place them anywhere for light.');
  if (id === 'meat') tip('meat', 'Roast raw meat over a campfire for a big meal.');
  if (id === 'ore') tip('ore', 'Smelt iron ore in a furnace next to a workbench.');
  if (id === 'seed') tip('seed', 'Plant a wild seed in grass or dirt, close to water. Crops keep growing while you sleep.');
}
function hitNode(n: SceneNode, ts: ToolStats) {
  n.shake = 0.25;
  if (n.kind === 'tree') {
    if (n.label === 'Ancient trunk' && ts.d?.tool !== 'axe') { toast('Ancient trunks need an axe', true); sfx.clang(); return; }
    n.hp -= ts.chop; sfx.chop(); burst(n.x, n.y0 + 1.1, n.z, n.cactus ? 0x3f9a4a : 0xb98450, 5); if (ts.d && ts.d.tool === 'axe') wear(ts);
    if (n.hp <= 0) fellTree(n);
  } else if (n.kind === 'rock' || n.kind === 'ore') {
    const need = n.kind === 'ore' ? 2 : 1, tier = ts.d && ts.d.tool === 'pick' ? ts.d.tier! : 0;
    if (tier < need) { sfx.clang(); toast(need === 2 ? 'Iron ore needs a stone pickaxe or better' : 'You need a pickaxe to break stone', true, 1500); burst(n.x, n.y0 + 0.8, n.z, 0xcccccc, 3); return; }
    n.hp -= ts.mine; sfx.mine(); burst(n.x, n.y0 + 0.9, n.z, n.kind === 'ore' ? 0xd9762a : 0xbfbfbf, 6); wear(ts);
    if (n.hp <= 0) { stopHarvest(); n.dead = true; deadNodes.add(nk(n)); n.mesh.visible = false; nearChunks(ch => { ch.col = ch.col.filter(c => c.node !== n); }); giveItem(n.kind === 'ore' ? 'ore' : 'stone', n.yield!); sfx.brk(); }
  } else if (n.kind === 'bush') {
    n.hp -= ts.d?.tool === 'axe' ? ts.chop : 1; sfx.chop(); if (n.hp > 0) return;
    stopHarvest(); if (n.ready) harvestBush(n);
    n.dead = true; deadNodes.add(nk(n)); n.mesh.visible = false; giveItem('fiber', 1); sfx.brk();
  }
}
const falling: { m: THREE.Mesh; t: number; ax: number; az: number; x: number; z: number }[] = [];
function fellTree(n: SceneNode) {
  stopHarvest(); n.dead = true; deadNodes.add(nk(n)); nearChunks(ch => { ch.col = ch.col.filter(c => c.node !== n); });
  const dx = n.x - P.x, dz = n.z - P.z, l = Math.hypot(dx, dz) || 1; falling.push({ m: n.mesh, t: 0, ax: dz / l, az: -dx / l, x: n.x, z: n.z });
  sfx.brk(); giveItem(n.item || 'wood', n.yield!);
}
function harvestBush(n: SceneNode) {
  if (!n.ready) { toast('The bush has no berries right now'); return; }
  stopHarvest(); n.ready = false; n.regrow = BERRY_REGROW_SECONDS; bushReady[nk(n)] = todT + BERRY_REGROW_SECONDS; n.mesh.geometry = G.bush; giveItem('berries', 2 + ((Math.random() * 2) | 0)); if (Math.random() < 0.6) giveItem('seed', 1); sfx.pickup(); tip('berry', 'Berries keep your hunger up. Cook mushrooms at a campfire for more.');
}
function hitBlock(b: Station, ts: ToolStats) {
  if (b.link) b = b.link;
  if (b.t === 'crop') { harvestCrop(b); return; }
  const def = BDEF[b.t], pow = ts.d && ts.d.tool === def.tool ? ts.blockPow : 0.7; b.hp -= pow; sfx.chop(); burst(b.i + 0.5, b.j + 0.6, b.k + 0.5, (b.t as string) === 'brick' ? 0xaaaaaa : 0xc69258, 5);
  if (ts.d && ts.d.tool === def.tool) wear(ts);
  if (b.hp <= 0) { stopHarvest(); for (const slot of b.contents ?? []) if (slot) dropSlot(slot, b.i + 0.5, b.j, b.k + 0.5); removeStation(b); giveItem(def.item, 1); sfx.brk(); }
}
function powerFor(ts: ToolStats, kind: string) { const d = ts.d; if (!d) return 0.6; if (d.tool === kind) return kind === 'axe' ? CHOP[d.tier!] : kind === 'pick' ? MINE[d.tier!] : DIGP[d.tier!]; if (kind === 'shovel' && d.tool === 'pick') return MINE[d.tier!] * 0.8; return 0.6; }
function rootsBlock(i: number, k: number) {
  const x = i + 0.5, z = k + 0.5; let hit = false;
  nearChunksAt(x, z, ch => { for (const c of ch.col) if (Math.hypot(x - c.x, z - c.z) < c.r + 0.75) hit = true; for (const n of ch.nodes) if (!n.dead && n.kind === 'bush' && Math.hypot(x - n.x, z - n.z) < n.r + 0.75) hit = true; });
  return hit;
}
function removeScenery(i: number, k: number) { const ch = chunks.get(Math.floor((i + S / 2) / S) + ',' + Math.floor((k + S / 2) / S)); if (ch) removeSceneryIn(ch, i, k); }
function removeSceneryIn(ch: Chunk, i: number, k: number) {
  for (const m of ch.scen) { const xz = m.userData.xz; let ch2 = false; for (let q = 0; q < xz.length / 2; q++) if (Math.floor(xz[q * 2]) === i && Math.floor(xz[q * 2 + 1]) === k) { m.setMatrixAt(q, ZERO); ch2 = true; } if (ch2) m.instanceMatrix.needsUpdate = true; }
  for (const p of ch.picks) if (!p.dead && Math.floor(p.x) === i && Math.floor(p.z) === k) { p.dead = true; collected.add(p.id); }
}
function hitGround(c: number[], ts: ToolStats) {
  const i = c[0], j = c[1], k = c[2], id = getBlock(i, j, k), bd = BLOCK[id];
  if (!bd || bd.hp === Infinity) { sfx.clang(); toast('Bedrock cannot be broken', true, 1300); return; }
  if (bd.need > 0) {
    const tier = ts.d && ts.d.tool === 'pick' ? ts.d.tier! : 0;
    if (tier < bd.need) { sfx.clang(); toast(bd.need >= 2 ? bd.n + ' needs a stone pickaxe or better' : bd.n + ' needs a pickaxe', true, 1500); burst(i + 0.5, j + 1, k + 0.5, 0xcccccc, 3); return; }
  }
  if (j === WG.terr(i, k).h - 1 && rootsBlock(i, k)) { sfx.clang(); toast('Roots and rocks hold this ground together', true, 1600); return; }
  const kk = key(i, j, k); if (!mining || mining.key !== kk) mining = { key: kk, hp: bd.hp, max: bd.hp };
  mining.hp -= powerFor(ts, bd.tool); sfx.dig(); burst(i + 0.5, j + 1, k + 0.5, BCOL[id] || 0x888888, 6);
  if (ts.d && ts.d.tool !== 'sword') wear(ts);
  tip('dig', 'Dirt can be placed like blocks to raise the ground. Tunnels must be two blocks tall for you to fit.');
  if (mining && mining.hp <= 0) { mining = null; digCell(i, j, k, id); }
}
const NB6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function touchesWater(i: number, j: number, k: number) { for (const n of NB6) if (getBlock(i + n[0], j + n[1], k + n[2]) === B.WATER) return true; return false; }
function floodFrom(i: number, j: number, k: number) {
  if (j > SEA || !touchesWater(i, j, k)) return;
  const q: number[][] = [[i, j, k]]; let n = 0;
  while (q.length && n < 600) {
    const c = q.pop()!; if (c[1] > SEA || getBlock(c[0], c[1], c[2]) !== 0 || !touchesWater(c[0], c[1], c[2])) continue;
    setVox(c[0], c[1], c[2], B.WATER, 'flooded'); n++; for (const d of NB6) q.push([c[0] + d[0], c[1] + d[1], c[2] + d[2]]);
  }
}
function digCell(i: number, j: number, k: number, id: number) {
  stopHarvest(); setVox(i, j, k, 0); if (j === WG.terr(i, k).h - 1) removeScenery(i, k);
  const drop = BLOCK[id].drop; if (drop) giveItem(drop, 1); sfx.brk(); floodFrom(i, j, k);
}
function interact() {
  if (state !== 'play' || paused) return;
  if (journalOpen) { toggleJournal(false); return; }
  if (uiOpen) { toggleInv(false); return; }
  if ((aim.type as Aim['type']) === 'resident' && aim.resident && aim.ok) { talkTo(aim.resident); return; }
  if ((aim.type as Aim['type']) === 'site' && aim.site && aim.ok) { interactStorySite(aim.site); return; }
  if (aim.type === 'drop' && aim.drop && aim.ok) { takeDrop(aim.drop); return; }
  if (aim.type === 'pickup' && aim.pickup && aim.ok) { harvestPickup(aim.pickup); return; }
  if (aim.type === 'node' && aim.node && aim.node.kind === 'bush' && aim.ok) { harvestBush(aim.node); return; }
  if (aim.type === 'block' && aim.block && aim.ok) {
    const t = aim.block.t;
    if (t === 'bench' || t === 'furnace' || t === 'camp') { toggleInv(true); return; }
    if (t === 'chest') { storageOpen = aim.block; toggleInv(true); return; }
    if (t === 'bed') { if (TOD.night < 0.25) inspectHome(aim.block); else sleep(aim.block); return; }
    if (t === 'crop') { if (isRipe(aim.block.growth ?? 0)) harvestCrop(aim.block); else { stopHarvest(); toast(STAGE_NAMES[cropStage(aim.block.growth ?? 0)] + (aim.block.wet ? ': growing well' : ': dry, grows slowly') + '. Hit deliberately to uproot.'); } return; }
    if (t === 'door') { toggleDoor(aim.block.link ?? aim.block); return; }
  }
  if (!keys.KeyE) toast('Aim at something nearby to interact', false, 900);
}
function sleep(b: Station) {
  if (TOD.night < 0.25) { toast('You can only sleep at night', true); return; }
  for (const e of enemies) if (!e.dying && Math.hypot(e.x - P.x, e.z - P.z) < 16) { toast('Beetles are too close to sleep', true); return; }
  $('fade').classList.add('on'); state = 'sleep';
  setTimeout(() => {
    const skipped = (Math.floor(todT / DAY_LEN) + 1) * DAY_LEN + 0.1 * DAY_LEN - todT; todT += skipped;
    const garden = advanceCrops(cropStations(), skipped); for (const b of cropStations()) setCropVisual(b);
    P.hp = 100; P.hunger = Math.max(25, P.hunger - 15); P.spawnX = b.i + 0.5; P.spawnZ = b.k + 2;
    for (const e of enemies.slice()) removeEnemy(e);
    $('fade').classList.remove('on'); state = 'play';
    note('slept'); showDawn(dawnLines(tally, Math.floor(todT / DAY_LEN) + 1, nextStep(progress)?.step.text ?? null, garden, summarize(sinceDawn))); tally = newTally(); sinceDawn.length = 0;
  }, 900);
}
function die() {
  state = 'dead'; if (document.exitPointerLock) document.exitPointerLock();
  $('over').classList.remove('hidden'); $('overTitle').textContent = 'The night wins this round';
  $('overText').textContent = 'Half your ordinary supplies were lost. Tools, shields and Elder carapace are kept.';
  $('overBtn').textContent = 'Wake up';
}
function respawn() {
  for (const s of inv) if (s && s.id !== 'eshell' && ITEMS[s.id].stack > 1) s.n = Math.ceil(s.n / 2);
  P.hp = 100; P.hunger = Math.max(P.hunger, 60); P.x = P.spawnX; P.z = P.spawnZ; P.y = surf(P.x, P.z); P.vx = P.vz = P.vy = 0; P.grounded = true; P.invuln = 2;
  { const skipped = (Math.floor(todT / DAY_LEN) + 1) * DAY_LEN + 0.1 * DAY_LEN - todT; todT += skipped; advanceCrops(cropStations(), skipped); for (const b of cropStations()) setCropVisual(b); }
  for (const e of enemies.slice()) removeEnemy(e);
  $('over').classList.add('hidden'); state = 'play'; renderHot(); updateHeld();
}
function stopHarvest() { mouseHeld = false; keys.KeyE = false; }
function harvestPickup(p: Pickup, fromSwing = false) {
  if (p.dead || (!fromSwing && P.cool > 0)) return false;
  if (!canHold(p.item, 1)) { toast('Your pack is full', true, 1200); stopHarvest(); return false; }
  const rule = harvestRule(p.label), ts = toolStats();
  p.hp = (p.hp ?? rule.hits) - harvestPower(p.label, ts.d?.tool, ts.d?.tier);
  P.cool = 0.42;
  if (rule.hits > 1) { sfx.chop(); burst(p.x, (p.y ?? H(p.x, p.z)) + 0.4, p.z, 0xb8bd70, 3); if (ts.d?.tool === rule.tool) wear(ts); }
  if (p.hp > 0) return false;
  stopHarvest(); p.dead = true; collected.add(p.id); p.mesh.setMatrixAt(p.idx, ZERO); p.mesh.instanceMatrix.needsUpdate = true;
  giveItem(p.item, 1);
  if (p.seed && hash2(p.x, p.z, 823) < 0.18) giveItem('seed', 1);
  sfx.pickup(); return true;
}
// Natural resources are never collected by movement. Rewards remain at their source or in recoverable bundles.
function pickups() {}
const tips: Record<string, number> = {};
function tip(k: string, text: string) { if (tips[k]) return; tips[k] = 1; setTimeout(() => toast(text, false, 4200), 900); }
let toastTimer = 0;
function toast(text: string, bad?: boolean, ms?: number) { const el = $('toast'); el.textContent = text; el.className = 'show' + (bad ? ' bad' : ''); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { el.className = ''; }, ms || 2600); }

/* ================= story landmarks ================= */
const siteParts: StorySitePart[] = [], siteGroups: THREE.Object3D[] = [];
let siteHumAt = 0;
function clearStorySiteVisuals() { for (const group of siteGroups) scene.remove(group); siteGroups.length = 0; siteParts.length = 0; }
function addSitePart(site: StorySite, partId: string, group: THREE.Group, x: number, z: number) {
  const y = H(x, z); group.position.set(x, y, z); scene.add(group); siteGroups.push(group); siteParts.push({ siteId: site.id, partId, x, y, z, g: group });
}
function rebuildStorySiteVisuals() {
  clearStorySiteVisuals(); if (!story.enabled) return;
  const stone = new THREE.MeshStandardMaterial({ color: 0x737878, roughness: 1 }), rune = new THREE.MeshStandardMaterial({ color: 0x84e6ee, emissive: 0x2aa9bb, emissiveIntensity: 0.8, roughness: 0.45 });
  for (const site of loreSites) {
    if (site.id === 'listening') {
      const offsets: [string, number, number][] = [['north', 0, -2.3], ['east', 2, 1.35], ['west', -2, 1.35]];
      for (const [partId, ox, oz] of offsets) {
        const g = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 2.1, 0.55), stone); body.position.y = 1.05; body.rotation.z = ox * 0.035; body.castShadow = true; g.add(body);
        const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), rune.clone()); mark.position.set(0, 1.18, 0.31); g.add(mark); g.userData.rune = mark;
        addSitePart(site, partId, g, site.x + ox, site.z + oz);
      }
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.3, 12), stone); basin.position.set(site.x, site.y + 0.15, site.z); basin.receiveShadow = true; scene.add(basin); siteGroups.push(basin);
    } else {
      const repaired = !!story.sites.door?.repaired, g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: repaired ? 0x8f6339 : 0x66513b, roughness: 0.95 }), oldStone = new THREE.MeshStandardMaterial({ color: 0x77766f, roughness: 1 });
      const left = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.65, 0.42), oldStone), right = left.clone(); left.position.set(-0.85, 1.325, 0); right.position.set(0.85, 1.325, 0); g.add(left, right);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.34, 0.46), oldStone); lintel.position.y = 2.56; g.add(lintel);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.35, 2.22, 0.16), wood); panel.position.y = 1.12; panel.rotation.z = repaired ? 0 : -0.14; panel.castShadow = true; g.add(panel);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshStandardMaterial({ color: 0xb88a35, metalness: 0.6, roughness: 0.35 })); knob.position.set(0.47, 1.13, 0.12); g.add(knob);
      addSitePart(site, 'door', g, site.x, site.z);
      const chair = new THREE.Group(), seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.8), wood); seat.position.y = 0.65; chair.add(seat);
      for (const [x, z] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.65, 0.1), wood); leg.position.set(x, 0.325, z); chair.add(leg); }
      chair.rotation.y = Math.PI; chair.position.set(site.x + 2.2, H(site.x + 2.2, site.z), site.z); scene.add(chair); siteGroups.push(chair);
    }
  }
}
function storySite(id: string) { return loreSites.find(site => site.id === id) ?? null; }
function trackedStorySite() {
  if (!story.tracked || !story.active[story.tracked]) return null;
  const stage = currentStage(story, story.tracked);
  if (story.tracked === 'listening-stones' && stage?.id === 'listen') return storySite('listening');
  if (story.tracked === 'door-without-house' && stage) return storySite('door');
  return null;
}
function updateStorySites(t: number) {
  if (!story.enabled) return;
  const door = storySite('door'), side = story.active['door-without-house'];
  if (state === 'play' && door && side && currentStage(story, 'door-without-house')?.id === 'find' && Math.hypot(P.x - door.x, P.z - door.z) < 10) note('site:door:found');
  const tracked = trackedStorySite();
  if (state === 'play' && tracked && Math.hypot(P.x - tracked.x, P.z - tracked.z) < 20) {
    if (t > siteHumAt) { siteHumAt = t + 5.5; sfx.hum(); tip('site-near:' + tracked.id, 'A low hum runs through the ground. The old place is very close.'); }
  }
  for (const part of siteParts) if (part.siteId === 'listening' && part.g.userData.rune) {
    const mark = part.g.userData.rune as THREE.Mesh, mat = mark.material as THREE.MeshStandardMaterial, near = tracked?.id === 'listening' && Math.hypot(P.x - part.x, P.z - part.z) < 20;
    mat.emissiveIntensity = near ? 1.4 + Math.sin(t * 2.5) * 0.45 : 0.55;
  }
}
function interactStorySite(part: StorySitePart) {
  if (part.siteId === 'listening') {
    if (currentStage(story, 'listening-stones')?.id !== 'listen') { say('Listening Stones', 'Old place', 'The stone is cool and silent.'); return; }
    const lines: Record<string, string> = { north: 'A voice like rain says: do not take light...', east: 'A voice like iron answers: ...from beneath...', west: 'A voice like roots finishes: ...the roots.' };
    note('site:listening:' + part.partId); say('Listening Stones', 'Remembered voice', lines[part.partId] ?? 'The stone hums, then falls quiet.'); sfx.hum(); return;
  }
  const stage = currentStage(story, 'door-without-house');
  if (!stage) { say('Old Door', 'Forest ruin', story.sites.door?.knocked ? 'The keyhole is empty. Something beyond the door is listening.' : 'The frame leans without a wall to hold it.'); return; }
  if (stage.id === 'find') { note('site:door:found'); say('Old Door', 'Forest ruin', 'The frame is split, but four fresh planks would settle it.'); return; }
  if (stage.id === 'repair') {
    if (countItem('plank') < 4) { toast('The old door needs 4 planks', true, 1800); return; }
    removeItems('plank', 4); story.sites.door = { ...(story.sites.door ?? {}), found: true, repaired: true, repairedDay: dayNow() }; renderHot(); updateHeld(); note('site:door:repair'); rebuildStorySiteVisuals(); say('Old Door', 'Repaired', 'The new planks settle with a sound like a long breath. Let the door stand through one night.'); sfx.place(); return;
  }
  if (stage.id === 'wait') { say('Old Door', 'Waiting', 'The repaired frame is still warm from your hands. It needs a night to remember itself.'); return; }
  if (stage.id === 'knock') {
    story.sites.door = { ...(story.sites.door ?? {}), knocked: true }; note('site:door:knock'); say('Old Door', 'Answered', 'Three knocks answer from the empty air. An old iron key waits in the latch.'); sfx.hum(); return;
  }
}

/* ================= residents ================= */
const residents: Resident[] = [], friends: Record<string, Friend> = {};
let homeT = 1, speechTimer = 0;
const roomQuery: RoomQuery = { wall: (i, j, k) => solid(i, j, k) || blocks.get(key(i, j, k))?.t === 'door' };
function makeHedgehog() {
  const g = new THREE.Group(), fur = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.95 }), face = new THREE.MeshStandardMaterial({ color: 0xe4c8a0, roughness: 0.9 }), spine = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 }), dk = new THREE.MeshStandardMaterial({ color: 0x141010, roughness: 0.4 }), scarf = new THREE.MeshStandardMaterial({ color: 0xc8322e, roughness: 0.8 });
  const S1 = new THREE.SphereGeometry(1, 12, 10), ball = (m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => { const o = new THREE.Mesh(S1, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  ball(fur, 0.28, 0.26, 0.36, 0, 0.3, -0.04); ball(face, 0.18, 0.17, 0.22, 0, 0.27, 0.3); ball(dk, 0.04, 0.04, 0.04, 0, 0.27, 0.5);
  for (const s of [-1, 1]) { ball(dk, 0.025, 0.03, 0.02, s * 0.07, 0.34, 0.4); ball(face, 0.06, 0.08, 0.03, s * 0.12, 0.42, 0.24); }
  ball(scarf, 0.2, 0.06, 0.2, 0, 0.36, 0.16);
  for (let q = 0; q < 14; q++) { const a = (q / 14) * Math.PI - Math.PI / 2, c = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 5), spine); c.position.set(Math.sin(a) * 0.2, 0.44 + Math.cos(a) * 0.16, -0.14 - Math.abs(Math.sin(a)) * 0.06); c.rotation.x = -0.9 - Math.cos(a) * 0.3; c.rotation.z = -Math.sin(a) * 0.8; c.castShadow = true; g.add(c); }
  return g;
}
/** Looks for a valid cottage around a bed. Returns the room and its floor when it has everything a resident needs. */
function cottageAt(bed: Station) {
  for (const start of startsNear(bed, roomQuery)) {
    const room = findRoom(roomQuery, start);
    if (room.enclosed && checkCottage(room, stations).ok) return { start, floor: floorCells(room, roomQuery) };
  }
  return null;
}
function inspectHome(bed?: Station) {
  const target = bed ?? stations.filter(b => b.t === 'bed' && Math.hypot(b.i + 0.5 - P.x, b.k + 0.5 - P.z) < 8).sort((a,b) => Math.hypot(a.i-P.x,a.k-P.z)-Math.hypot(b.i-P.x,b.k-P.z))[0];
  if (!target) { toast('Place a bed in your room, then inspect the home here.', false, 4000); return; }
  let missing = ['walls and a roof with no gaps'];
  for (const start of startsNear(target, roomQuery)) {
    const room = findRoom(roomQuery, start), check = checkCottage(room, stations);
    if (check.ok) { toast('Home ready: enclosed room, space, bed, light and workbench.', false, 5000); return; }
    if (room.enclosed) missing = check.missing;
  }
  toast('Home needs: ' + missing.join(', ') + '.', false, 6000);
}
function spawnResident(id: string, home: Cell, floor: Cell[]) {
  const c = floor.length ? floor[(Math.random() * floor.length) | 0] : home;
  const r: Resident = { id, x: c[0] + 0.5, z: c[2] + 0.5, y: c[1], heading: Math.random() * TAU, phase: 0, wait: 1, home, floor, target: null, g: makeHedgehog() };
  r.g.position.set(r.x, r.y, r.z); scene.add(r.g); residents.push(r); friends[id] ||= newFriend(); return r;
}
function removeResident(r: Resident) { scene.remove(r.g); const i = residents.indexOf(r); if (i >= 0) residents.splice(i, 1); }
/** Every couple of seconds: residents whose home was broken leave, and a valid cottage attracts a resident who has none. */
function checkHomes() {
  for (const r of residents.slice()) {
    const room = findRoom(roomQuery, r.home);
    if (room.enclosed && checkCottage(room, stations).ok) { r.unsafeSince = undefined; r.floor = floorCells(room, roomQuery); continue; }
    if (r.unsafeSince === undefined) { r.unsafeSince = todT; toast(RESIDENTS[r.id].name + ' needs repairs: ' + checkCottage(room, stations).missing.join(', ') + '. You have 30 seconds.', true, 6000); }
    if (todT - r.unsafeSince < 30) continue;
    removeResident(r); toast(RESIDENTS[r.id].name + ' has left: the cottage is no longer a safe home', true, 4200);
  }
  for (const id of Object.keys(RESIDENTS)) {
    if (residents.some(r => r.id === id)) continue;
    for (const bed of stations) if (bed.t === 'bed') {
      const home = cottageAt(bed); if (!home) continue;
      spawnResident(id, home.start, home.floor); note('cottage'); note('resident:' + id);
      const def = RESIDENTS[id]; toast(def.name + ' the ' + def.title + ' has moved into your cottage!', false, 4200); sfx.craft();
      break;
    }
  }
}
function updateResidents(dt: number, t: number) {
  homeT -= dt; if (homeT <= 0 && state === 'play') { homeT = 2.5; checkHomes(); }
  for (const r of residents) {
    r.wait -= dt;
    if (!r.target && r.wait <= 0 && r.floor.length) { const c = r.floor[(Math.random() * r.floor.length) | 0]; r.target = { x: c[0] + 0.5, z: c[2] + 0.5 }; }
    let sp = 0;
    if (r.target) {
      const dx = r.target.x - r.x, dz = r.target.z - r.z, d = Math.hypot(dx, dz);
      if (d < 0.15) { r.target = null; r.wait = 2 + Math.random() * 5; }
      else { sp = 1.1; r.x += dx / d * sp * dt; r.z += dz / d * sp * dt; r.heading += angDiff(Math.atan2(dx, dz), r.heading) * Math.min(1, dt * 6); }
    } else if (Math.hypot(P.x - r.x, P.z - r.z) < 5) r.heading += angDiff(Math.atan2(P.x - r.x, P.z - r.z), r.heading) * Math.min(1, dt * 4);
    const o = { x: r.x, z: r.z }; pushFromBlocks(o, 0.3, r.y + 0.05, r.y + 0.7); r.x = o.x; r.z = o.z;
    r.y += (floorY(r.x, r.z, r.y) - r.y) * Math.min(1, dt * 12); r.phase += sp * dt * 6;
    r.g.position.set(r.x, r.y + Math.abs(Math.sin(r.phase)) * 0.03, r.z); r.g.rotation.y = r.heading;
  }
}
function say(name: string, tierLabel: string, text: string) {
  $('spName').textContent = name; $('spTier').textContent = tierLabel; $('spText').textContent = text;
  const el = $('speech'); el.classList.add('show'); clearTimeout(speechTimer); speechTimer = window.setTimeout(() => el.classList.remove('show'), 6500);
}
function hasCosts(costs: readonly ItemCost[] = []) { return costs.every(cost => countItem(cost.id) >= cost.count); }
function consumeCosts(costs: readonly ItemCost[] = []) { for (const cost of costs) removeItems(cost.id, cost.count); renderHot(); updateHeld(); }
function closeDialogue() { $('dialogue').classList.add('hidden'); uiOpen = false; if (state === 'dialogue') state = 'play'; renderGoal(); }
function dialogueButtons(buttons: { label: string; primary?: boolean; disabled?: boolean; run: () => void }[]) {
  const actions = $('dialogueActions'); actions.innerHTML = '';
  for (const def of buttons) { const button = document.createElement('button'); button.textContent = def.label; button.className = def.primary ? 'primary' : ''; button.disabled = !!def.disabled; button.addEventListener('click', def.run); actions.appendChild(button); }
}
function showQuestConversation(cue: ConversationCue) {
  state = 'dialogue'; uiOpen = true; if (document.exitPointerLock) document.exitPointerLock(); for (const k in keys) keys[k] = false; mouseHeld = false;
  $('dialogueName').textContent = 'Bramble'; $('dialogueText').textContent = cue.text; $('dialogue').classList.remove('hidden');
  const finish = (text: string) => { $('dialogueText').textContent = text; dialogueButtons([{ label: 'Close', primary: true, run: closeDialogue }]); renderGoal(); if (journalOpen) renderJournal(); };
  if (cue.kind === 'offer') {
    dialogueButtons([
      { label: 'Not now', run: closeDialogue },
      { label: cue.action, primary: true, run: () => { if (acceptQuest(story, cue.quest.id, dayNow(), progress)) finish(cue.after); else closeDialogue(); } }
    ]);
  } else {
    const ready = hasCosts(cue.items);
    dialogueButtons([
      { label: 'Not yet', run: closeDialogue },
      { label: cue.action, primary: true, disabled: !ready, run: () => { if (!hasCosts(cue.items)) return; consumeCosts(cue.items); note(cue.event!); finish(cue.after); } }
    ]);
  }
}
const dayNow = () => Math.floor(todT / DAY_LEN) + 1;
function dialogueFlags() { const flags = new Set(progress); for (const id of story.completed) flags.add('quest:' + id); for (const id of story.lore) flags.add('lore:' + id); return flags; }
function talkTo(r: Resident) {
  const questCue = residentConversation(story, progress, r.id); if (questCue) { showQuestConversation(questCue); return; }
  const def = RESIDENTS[r.id], before = tierOf(friends[r.id].friendship), res = talkStep(friends[r.id], dayNow());
  friends[r.id] = res.friend;
  const tier = tierOf(res.friend.friendship);
  const line = pickLine(candidateLines(def, { day: dayNow(), night: TOD.night > 0.35, tier, flags: dialogueFlags() }), res.friend.lastLine);
  res.friend.lastLine = line.id;
  let text = line.text;
  if (tier > before) text += '  (' + def.name + ' now counts you as a ' + TIER_NAMES[tier].toLowerCase() + '.)';
  if (res.present) {
    const gifts = presentFor(def, res.friend.friendship);
    if (gifts) { for (const [id, n] of Object.entries(gifts)) giveItem(id, n); text += '  Here, I found these for you.'; }
  }
  say(def.name, TIER_NAMES[tier], text); note('talk:' + r.id); sfx.pickup();
}
function giftTo(r: Resident) {
  const def = RESIDENTS[r.id], s = inv[sel], d = s ? ITEMS[s.id] : null;
  if (!s || !d) { toast('Hold an item in your hand to give it (G)', false, 1600); return; }
  if (d.k === 'tool' || d.k === 'shield' || d.k === 'station') { toast(def.name + ' has no use for that', false, 1600); return; }
  const res = giveGift(def, friends[r.id], s.id, dayNow());
  if (res.accepted) { friends[r.id] = res.friend; s.n--; if (s.n <= 0) inv[sel] = null; renderHot(); updateHeld(); note('gift:' + r.id); sfx.pickup(); }
  say(def.name, TIER_NAMES[tierOf(friends[r.id].friendship)], res.reaction);
}

/* ================= journal, collection log and dawn card ================= */
const progress = createProgress();
let tally = newTally(), journalOpen = false, journalTab: 'quests' | 'lore' | 'log' = 'quests', dawnTimer = 0, goalFlash = 0;
function objectiveText(questId: string) {
  const current = currentObjectives(story, questId).find(row => !row.done), active = story.active[questId];
  if (!current || !active) return null;
  const need = current.objective.count ?? 1, count = need > 1 ? ' ' + Math.min(current.value, need) + '/' + need : '';
  const site = story.tracked === questId ? trackedStorySite() : null, nav = site ? ' - ' + navigationTo(site, P.x, P.z) : '';
  return current.objective.text + count + nav;
}
function renderGoal() {
  if (performance.now() < goalFlash) return;
  if (story.tracked && story.active[story.tracked]) {
    const quest = questById(story.tracked), text = objectiveText(story.tracked);
    if (quest && text) { $('goalArc').textContent = quest.title; $('goalStep').textContent = text; return; }
  }
  const n = nextStep(progress);
  $('goalArc').textContent = n ? n.arc.title + '  ' + arcProgress(progress, n.arc).done + '/' + n.arc.steps.length : 'Journal complete';
  $('goalStep').textContent = n ? n.step.text : 'Every goal is done. The forest is yours.';
}
/** Records progress. The first time a key is seen it may complete a goal, add a log entry or finish a chapter. */
function note(key: string) {
  const questUpdates = recordQuestEvent(story, { key, day: dayNow() });
  for (const update of questUpdates) {
    for (const reward of update.rewards) giveItem(reward.id, reward.count);
    const quest = questById(update.questId);
    if (update.questCompleted && quest) setTimeout(() => toast('Quest complete: ' + quest.title, false, 3400), 250);
    else if (update.intro) { const text = update.intro; setTimeout(() => toast(text, false, 3000), 250); }
  }
  const fresh = record(progress, key);
  if (!fresh) { if (questUpdates.length) { renderGoal(); if (journalOpen) renderJournal(); } return; }
  const name = discoveryName(key); if (name) tally.discoveries.push(name);
  const done = completedBy(progress, key);
  if (done.steps.length) {
    goalFlash = performance.now() + 2600; $('goalStep').textContent = '\u2713 ' + done.steps[0].step.text; $('goal').classList.add('flash');
    setTimeout(() => { $('goal').classList.remove('flash'); goalFlash = 0; renderGoal(); }, 2600);
  }
  if (name) { const t = 'New in your log: ' + name; $('goalNote').textContent = t; setTimeout(() => { if ($('goalNote').textContent === t) $('goalNote').textContent = ''; }, 3200); }
  if (done.arcs.length) setTimeout(() => toast('Chapter complete: ' + done.arcs[0].title, false, 3200), 1500);
  renderGoal(); if (journalOpen) renderJournal();
}
function renderJournal() {
  const body = $('jBody'); body.innerHTML = '';
  $('jtGoals').classList.toggle('on', journalTab === 'quests'); $('jtLore').classList.toggle('on', journalTab === 'lore'); $('jtLog').classList.toggle('on', journalTab === 'log');
  const c = logCounts(progress); $('jCount').textContent = c.found + '/' + c.total;
  if (journalTab === 'quests') {
    if (!story.enabled) { const msg = document.createElement('div'); msg.className = 'emptyStory'; msg.textContent = 'Story landmarks are available in newly generated worlds. This world and everything you built in it remain unchanged.'; body.appendChild(msg); }
    else {
      const addQuest = (questId: string, label: string) => {
        const quest = questById(questId); if (!quest) return;
        const wrap = document.createElement('section'); wrap.className = 'quest';
        const h = document.createElement('h3'); h.textContent = quest.title + ' '; const small = document.createElement('small'); small.textContent = label; h.appendChild(small); wrap.appendChild(h);
        const p = document.createElement('p'); p.textContent = quest.summary; wrap.appendChild(p);
        if (story.active[questId]) {
          for (const row of currentObjectives(story, questId)) { const line = document.createElement('div'); line.className = 'stp' + (row.done ? ' done' : ' now'); const need = row.objective.count ?? 1; line.textContent = row.objective.text + (need > 1 ? ' ' + Math.min(row.value, need) + '/' + need : ''); wrap.appendChild(line); }
          const actions = document.createElement('div'); actions.className = 'qactions'; const track = document.createElement('button'); track.textContent = story.tracked === questId ? 'Tracked' : 'Track'; track.className = story.tracked === questId ? 'primary' : ''; track.disabled = story.tracked === questId; track.addEventListener('click', () => { story.tracked = questId; renderGoal(); renderJournal(); }); actions.appendChild(track); wrap.appendChild(actions);
        } else if (questStatus(quest, story, progress) === 'available') { const hint = document.createElement('div'); hint.className = 'stp now'; hint.textContent = 'Talk to Bramble to begin'; wrap.appendChild(hint); }
        else { const done = document.createElement('div'); done.className = 'stp done'; done.textContent = quest.completeText; wrap.appendChild(done); }
        body.appendChild(wrap);
      };
      for (const id of Object.keys(story.active)) addQuest(id, questById(id)?.kind === 'side' ? 'Side quest' : 'Main quest');
      for (const quest of availableQuests(story, progress)) addQuest(quest.id, quest.kind === 'side' ? 'Available side quest' : 'Available main quest');
      for (const id of story.completed) addQuest(id, 'Completed');
    }
    const head = document.createElement('div'); head.className = 'logsec'; head.innerHTML = '<h3>Field Guide</h3>'; body.appendChild(head);
    const cur = nextStep(progress);
    for (const arc of ARCS) {
      const pr = arcProgress(progress, arc), wrap = document.createElement('div'); wrap.className = 'arc';
      wrap.innerHTML = '<h3>' + arc.title + '<small>' + pr.done + '/' + pr.total + '</small></h3><p>' + arc.blurb + '</p>';
      for (const s of arc.steps) { const d = document.createElement('div'); d.className = 'stp' + (stepDone(progress, s) ? ' done' : cur && cur.step === s ? ' now' : ''); d.textContent = s.text; wrap.appendChild(d); }
      body.appendChild(wrap);
    }
  } else if (journalTab === 'lore') {
    if (!story.lore.length) { const empty = document.createElement('div'); empty.className = 'emptyStory'; empty.textContent = story.enabled ? 'Stories you uncover will be kept here.' : 'This older world has no generated story landmarks.'; body.appendChild(empty); }
    for (const id of story.lore) { const entry = loreById(id); if (!entry) continue; const wrap = document.createElement('article'); wrap.className = 'lore'; const h = document.createElement('h3'); h.textContent = entry.title; const p = document.createElement('p'); p.textContent = entry.body; wrap.append(h, p); body.appendChild(wrap); }
    if (story.keepsakes.length) { const wrap = document.createElement('article'); wrap.className = 'lore'; const h = document.createElement('h3'); h.textContent = 'Keepsakes'; const p = document.createElement('p'); p.textContent = story.keepsakes.map(id => id === 'listening-lens' ? 'Listening Lens' : id === 'old-hearth-key' ? 'Old Hearth Key' : id).join(', '); wrap.append(h, p); body.appendChild(wrap); }
  } else {
    const titles = { items: 'Things', places: 'Places', creatures: 'Creatures' } as const;
    for (const sec of ['items', 'places', 'creatures'] as const) {
      const wrap = document.createElement('div'); wrap.className = 'logsec'; const h = document.createElement('h3'); h.textContent = titles[sec]; wrap.appendChild(h);
      const grid = document.createElement('div'); grid.className = 'logg';
      for (const e of logEntries()) if (e.section === sec) {
        const found = progress.has(e.key), row = document.createElement('div'); row.className = 'le' + (found ? '' : ' no');
        if (found && e.icon) { const im = document.createElement('img'); im.src = icon(e.icon); row.appendChild(im); } else { const ph = document.createElement('div'); ph.className = 'ph'; ph.textContent = found ? '\u2713' : '?'; row.appendChild(ph); }
        const nm = document.createElement('span'); nm.textContent = found ? e.name : '???'; row.appendChild(nm); grid.appendChild(row);
      }
      wrap.appendChild(grid); body.appendChild(wrap);
    }
  }
}
function toggleJournal(force?: boolean) {
  const open = force !== undefined ? force : !journalOpen;
  if (open && uiOpen && !journalOpen) toggleInv(false);
  journalOpen = open; uiOpen = open; $('journal').classList.toggle('hidden', !open);
  if (open) { renderJournal(); document.exitPointerLock?.(); clearInput(); }
}
function showDawn(lines: string[]) {
  const el = $('dawn'); el.innerHTML = '';
  lines.forEach((l, i) => { const e = document.createElement(i === 0 ? 'h2' : 'p'); if (i === lines.length - 1) e.className = 'next'; e.textContent = l; el.appendChild(e); });
  el.classList.add('show'); clearTimeout(dawnTimer); dawnTimer = window.setTimeout(() => el.classList.remove('show'), 9000);
}
$('dawn').addEventListener('click', () => $('dawn').classList.remove('show'));
$('goal').addEventListener('click', () => { if (state === 'play') toggleJournal(); });
$('jtGoals').addEventListener('click', () => { journalTab = 'quests'; renderJournal(); });
$('jtLore').addEventListener('click', () => { journalTab = 'lore'; renderJournal(); });
$('jtLog').addEventListener('click', () => { journalTab = 'log'; renderJournal(); });

/* ================= input ================= */
const isTouch = matchMedia('(pointer:coarse)').matches;
const joy: { active: boolean; id: number | null; cx: number; cy: number; x: number; y: number } = { active: false, id: null, cx: 0, cy: 0, x: 0, y: 0 }; let touchRun = false, touchJump = false, touchBlock = false, look: { id: number; x: number; y: number; mouse?: boolean } | null = null;
addEventListener('keydown', e => {
  if (e.repeat && e.code !== 'KeyF') { if (['Space', 'Tab'].includes(e.code)) e.preventDefault(); return; }
  keys[e.code] = true;
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape' && state === 'dialogue') { closeDialogue(); return; }
  if (state !== 'play' && state !== 'menu') return;
  if (paused && e.code !== 'Escape') return;
  if (e.code === 'Tab' || e.code === 'KeyI' || e.code === 'KeyC') { if (state === 'play') { if (journalOpen) toggleJournal(false); else toggleInv(); } }
  else if (e.code === 'KeyJ') { if (state === 'play') toggleJournal(); }
  else if (e.code === 'KeyG') { if (state === 'play' && !uiOpen && (aim.type as Aim['type']) === 'resident' && aim.resident && aim.ok) giftTo(aim.resident); }
  else if (e.code === 'Escape' && uiOpen) { if (journalOpen) toggleJournal(false); else toggleInv(false); }
  else if (e.code === 'Escape' && state === 'play') setPaused(!paused);
  else if (paused) return;
  else if (e.code === 'KeyH' && state === 'play' && !uiOpen) { sel = -1; renderHot(); updateHeld(); }
  else if (e.code === 'KeyB' && state === 'play' && !uiOpen) inspectHome();
  else if (e.code === 'KeyE' && state === 'play' && !e.repeat) interact();
  else if (e.code === 'KeyM') { setMuted(!audioState.muted); }
  else if (e.code === 'BracketRight') camDist = clamp(camDist + 0.8, 3, 14); else if (e.code === 'BracketLeft') camDist = clamp(camDist - 0.8, 3, 14);
  else if (e.code.startsWith('Digit')) { const n = parseInt(e.code.slice(5), 10); if (n >= 1 && n <= 8) { sel = n - 1; renderHot(); updateHeld(); } }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { clearInput(); if (state === 'play' && !uiOpen) setPaused(true); });
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; $('xh').classList.toggle('on', locked || isTouch); });
document.addEventListener('pointerlockerror', () => { locked = false; });
document.addEventListener('mousemove', e => {
  mouseX = e.clientX; mouseY = e.clientY;
  if (locked) { camYaw -= e.movementX * 0.0026; camPitch = clamp(camPitch + e.movementY * 0.0022, -0.15, 1.3); }
  else if (look && look.mouse) { camYaw -= (e.clientX - look.x) * 0.006; camPitch = clamp(camPitch + (e.clientY - look.y) * 0.005, -0.15, 1.3); look.x = e.clientX; look.y = e.clientY; }
});
const stickBase = $('stickBase'), stickKnob = $('stickKnob');
canvas.addEventListener('pointerdown', e => {
  if (state !== 'play' || paused || uiOpen) return;
  if (e.pointerType === 'touch') {
    canvas.setPointerCapture(e.pointerId);
    if (e.clientX < innerWidth * 0.4 && !joy.active) { joy.active = true; joy.id = e.pointerId; joy.cx = e.clientX; joy.cy = e.clientY; joy.x = joy.y = 0; stickBase.style.display = 'block'; stickBase.style.left = e.clientX + 'px'; stickBase.style.top = e.clientY + 'px'; stickKnob.style.transform = 'translate(0,0)'; }
    else if (!look) look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    return;
  }
  if (!locked && e.button === 0 && canvas.requestPointerLock) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) {} }
  if (e.button === 2) { if (locked) touchBlock = true; else look = { id: -1, mouse: true, x: e.clientX, y: e.clientY }; }
  if (e.button === 0) { mouseHeld = true; useItem(); }
});
addEventListener('pointerup', e => {
  if (e.button === 0) mouseHeld = false;
  if (e.button === 2) { touchBlock = false; if (look && look.mouse) look = null; }
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerType !== 'touch') return;
  if (joy.active && e.pointerId === joy.id) {
    let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy; const l = Math.hypot(dx, dy), m = 56; if (l > m) { dx = dx / l * m; dy = dy / l * m; }
    joy.x = dx / m; joy.y = -dy / m; stickKnob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  } else if (look && e.pointerId === look.id) { camYaw -= (e.clientX - look.x) * 0.006; camPitch = clamp(camPitch + (e.clientY - look.y) * 0.005, -0.15, 1.3); look.x = e.clientX; look.y = e.clientY; }
});
const endPtr = (e: PointerEvent) => { if (e.pointerType !== 'touch') return; if (joy.active && e.pointerId === joy.id) { joy.active = false; joy.x = joy.y = 0; stickBase.style.display = 'none'; } if (look && e.pointerId === look.id) look = null; };
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
addEventListener('wheel', e => { if (uiOpen || paused || state !== 'play') return; sel = (sel + (e.deltaY > 0 ? 1 : 7)) % 8; renderHot(); updateHeld(); e.preventDefault(); }, { passive: false });
const bind = (id: string, down: () => void, up?: () => void) => { const el = $(id); el.addEventListener('pointerdown', e => { e.preventDefault(); down(); }); const u = () => { if (up) up(); }; el.addEventListener('pointerup', u); el.addEventListener('pointercancel', u); el.addEventListener('pointerleave', u); };
bind('tUse', () => { mouseHeld = true; useItem(); }, () => { mouseHeld = false; }); bind('tJump', () => { touchJump = true; }); bind('tBlock', () => { touchBlock = true; }, () => { touchBlock = false; });
bind('tRun', () => { touchRun = true; }, () => { touchRun = false; }); bind('tE', () => { interact(); }); bind('tBag', () => { if (state === 'play') toggleInv(); });

/* ================= player update ================= */
function updatePlayer(dt: number) {
  if (uiOpen || paused) return;
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0), iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  if (uiOpen) { ix = iz = 0; }
  if (joy.active) { ix += joy.x; iz += joy.y; }
  if (blocks.size && iz !== 0) { const lb0 = blocks.get(key(Math.floor(P.x), Math.floor(P.y + 0.05), Math.floor(P.z))) || blocks.get(key(Math.floor(P.x), Math.floor(P.y + 0.75), Math.floor(P.z))); if (lb0 && lb0.t === 'ladder') iz = 0; }
  const len = Math.hypot(ix, iz); if (len > 1) { ix /= len; iz /= len; }
  const sy = Math.sin(camYaw), cy = Math.cos(camYaw), dx = -sy * iz + cy * ix, dz = -cy * iz - sy * ix;
  const wantRun = (keys.ShiftLeft || keys.ShiftRight || touchRun) && len > 0.1;
  if (P.exhausted && P.stamina > 25) P.exhausted = false;
  P.blocking = !uiOpen && (keys.KeyF || touchBlock) && !!bestShield() && P.stamina > 3;
  const running = wantRun && !P.exhausted && P.stamina > 0 && !P.blocking;
  if (running) { P.stamina -= 22 * dt; if (P.stamina <= 0) { P.stamina = 0; P.exhausted = true; } } else P.stamina = Math.min(100, P.stamina + (len > 0.1 ? 10 : 20) * dt * (P.blocking ? 0.3 : 1));
  const wx = Math.floor(P.x), wz = Math.floor(P.z), wet = getBlock(wx, Math.floor(P.y + 0.7), wz) === B.WATER, lava = getBlock(wx, Math.floor(P.y + 0.3), wz) === B.LAVA || getBlock(wx, Math.floor(P.y + 1.0), wz) === B.LAVA;
  const speed = (running ? 8.4 : 4.8) * (P.blocking ? 0.55 : 1) * (P.swing > 0 ? 0.7 : 1) * (wet ? 0.55 : 1) * (lava ? 0.4 : 1), k = Math.min(1, dt * 12);
  P.vx += (dx * speed - P.vx) * k; P.vz += (dz * speed - P.vz) * k;
  P.x += (P.vx + P.kx) * dt; P.z += (P.vz + P.kz) * dt; P.kx *= 0.85; P.kz *= 0.85;
  const sp = Math.hypot(P.vx, P.vz); P.speed = sp;
  if ((P.swing > 0 || P.blocking) && !uiOpen) { P.heading += angDiff(Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw)), P.heading) * Math.min(1, dt * 16); }
  else if (len > 0.1 && sp > 0.5) P.heading += angDiff(Math.atan2(P.vx, P.vz), P.heading) * Math.min(1, dt * 12);
  const push = (c: Collider) => { const ddx = P.x - c.x, ddz = P.z - c.z, d = Math.hypot(ddx, ddz), md = c.r + PRAD; if (d < md && d > 1e-4) { P.x = c.x + ddx / d * md; P.z = c.z + ddz / d * md; } };
  nearChunks(ch => { for (const c of ch.col) push(c); });
  pushFromBlocks(P, PRAD, P.y + 0.03, P.y + PHGT);

  const S0 = surfaceY(P.x, P.z, P.y);
  const lb = blocks.size ? (blocks.get(key(wx, Math.floor(P.y + 0.05), wz)) || blocks.get(key(wx, Math.floor(P.y + 0.75), wz))) : null, ladder = !!lb && lb.t === 'ladder';
  if (ladder && !uiOpen) {
    const up = keys.KeyW || keys.Space || keys.ArrowUp || joy.y > 0.4 || touchJump, dn = keys.KeyS || keys.ArrowDown || joy.y < -0.4;
    if (up || dn) { P.grounded = false; P.vy = up ? 3.8 : -3.8; } else if (!P.grounded) P.vy = 0;
  } else if ((keys.Space || touchJump) && !uiOpen) { const feetWet = getBlock(wx, Math.floor(P.y + 0.1), wz) === B.WATER; if (wet) { P.vy = 4.6; P.grounded = false; } else if (feetWet && !P.grounded) { P.vy = len > 0.1 ? 8.6 : 4.6; } else if (P.grounded) { P.vy = 11.3; P.grounded = false; sfx.jump(); } }
  touchJump = false;
  if (P.grounded) { if (S0 < P.y - 0.4) P.grounded = false; else P.y = S0; }
  if (!P.grounded) {
    P.vy = Math.max(wet ? -3.2 : -30, P.vy - (ladder ? 0 : wet ? 9 : 30) * dt); let ny = P.y + P.vy * dt;
    if (P.vy > 0) { const cj = ceilingAt(P.x, P.z, P.y + PHGT - 0.05, ny + PHGT + 0.05); if (cj !== null) { P.vy = 0; ny = Math.min(ny, cj - PHGT - 0.001); } }
    if (ny <= S0 && P.vy <= 0) { if (P.vy < -17 && !wet) damagePlayer((-P.vy - 17) * 1.6, null); P.y = S0; P.vy = 0; P.grounded = true; } else P.y = ny;
  }
  if (lava) { P.hp -= 30 * dt; dmgFlash = Math.max(dmgFlash, 0.55); shake = Math.max(shake, 0.12); if (Math.random() < dt * 4) sfx.hurt(); if (P.hp <= 0) die(); }
  P.stepD += sp * dt; if (P.grounded && P.stepD > 1.6 && sp > 1) { P.stepD = 0; sfx.step(); }
  if (P.cool > 0) P.cool -= dt; if (P.invuln > 0) P.invuln -= dt;
  if (P.swing > 0) { P.swing -= dt; if (!P.swingHit && P.swing < 0.2) { P.swingHit = true; resolveSwing(); } }
  if (mouseHeld && P.cool <= 0 && !uiOpen) useItem();
  if (keys.KeyE && P.cool <= 0 && !uiOpen && aim.ok && aim.type === 'pickup') interact();

  /* hunger and healing */
  P.hunger = Math.max(0, P.hunger - dt * (running ? 0.45 : 0.24));
  if (P.hunger <= 0) { P.hp -= dt * 1.6; if (P.hp <= 0) die(); if (!tips.hungry) tip('hungry', 'You are starving. Eat berries or roasted mushrooms.'); }
  else if (P.hunger > 55 && P.hp < 100) P.hp = Math.min(100, P.hp + dt * 1.1);
  if (P.grounded && H(P.x, P.z) - P.y >= 3) tip('stuck', 'Deep hole? Dig steps into the wall, or jump and place dirt under your feet to climb out.');
  if (TOD.night > 0.4 && !tips.night) tip('night', 'Night has fallen. Gloom beetles roam. Stay by a campfire or behind walls.');
}

/* ================= gnome animation ================= */
function animateGnome(dt: number, t: number) {
  const g = gnome.g, sf = clamp(P.speed / 5, 0, 1.4); P.phase += P.speed * dt * 1.9;
  g.position.set(P.x, P.y, P.z); g.rotation.set(0, P.heading, 0);
  gnome.body.position.y = Math.abs(Math.sin(P.phase)) * 0.045 * sf; gnome.body.rotation.z = Math.sin(P.phase) * 0.04 * sf;
  gnome.legs[0].rotation.x = Math.sin(P.phase) * 0.85 * Math.min(1, sf); gnome.legs[1].rotation.x = -Math.sin(P.phase) * 0.85 * Math.min(1, sf);
  if (!P.grounded) { gnome.legs[0].rotation.x = 0.5; gnome.legs[1].rotation.x = -0.4; }
  /* right arm: idle sway or swing */
  if (P.swing > 0) { const s = 1 - P.swing / 0.34, e = 1 - Math.pow(1 - s, 3); gnome.armR.sh.rotation.x = lerp(-2.6, -0.2, e); gnome.armR.sh.rotation.z = 0; }
  else { gnome.armR.sh.rotation.x = -0.3 - Math.sin(P.phase) * 0.55 * sf; gnome.armR.sh.rotation.z = 0.08; }
  /* left arm: shield */
  const sh = bestShield(); const lt = gnome.armL.sh.rotation.x;
  if (P.blocking) { gnome.armL.sh.rotation.x = lerp(lt, -1.35, Math.min(1, dt * 16)); shieldHold.rotation.set(0, 0, 0); shieldHold.position.set(-0.12, 0.05, 0.28); }
  else { gnome.armL.sh.rotation.x = lerp(lt, Math.sin(P.phase) * 0.55 * sf, Math.min(1, dt * 12)); shieldHold.rotation.set(0, Math.PI / 2, 0); shieldHold.position.set(0.16, 0, 0); }
  shieldHold.visible = !!sh;
  const night = TOD.night; gnome.lsp.material.opacity = 0.45 + night * 0.5; gnome.lanternCore.material.color.setRGB(1, 0.75 + Math.sin(t * 9) * 0.03, 0.4);
  g.visible = (P.invuln <= 0 || Math.floor(t * 16) % 2 === 0) && camDistNow > 1.1;
  lantern.position.set(P.x + Math.cos(P.heading) * 0.4, P.y + 1.3, P.z - Math.sin(P.heading) * 0.4);
}

/* ================= camera ================= */
function updateCamera(dt: number, t: number) {
  if (state === 'menu') { const a = t * 0.07 + 0.6; camera.position.set(Math.sin(a) * 8, H(0, 0) + 3, 3 + Math.cos(a) * 8); camera.lookAt(0, 1.5, 3); return; }
  const k = Math.min(1, dt * 10); camTarget.x += (P.x - camTarget.x) * k; camTarget.y += (P.y + 1.25 - camTarget.y) * k; camTarget.z += (P.z - camTarget.z) * k;
  const cp = Math.cos(camPitch), cdx = Math.sin(camYaw) * cp, cdy = Math.sin(camPitch), cdz = Math.cos(camYaw) * cp;
  let cd = camDist;
  for (let s2 = 0.4; s2 <= camDist; s2 += 0.2) { if (solid(Math.floor(camTarget.x + cdx * s2), Math.floor(camTarget.y + cdy * s2), Math.floor(camTarget.z + cdz * s2))) { cd = Math.max(0.5, s2 - 0.45); break; } }
  camDistNow += (cd - camDistNow) * Math.min(1, dt * (cd < camDistNow ? 30 : 6));
  camera.position.set(camTarget.x + cdx * camDistNow, camTarget.y + cdy * camDistNow, camTarget.z + cdz * camDistNow);
  const pc = (c: Collider) => { const a = camera.position.x - c.x, b = camera.position.z - c.z, d = Math.hypot(a, b), md = c.r + 0.5; if (d < md && d > 0.001) { camera.position.x = c.x + a / d * md; camera.position.z = c.z + b / d * md; } };
  nearChunks(ch => { for (const c of ch.col) pc(c); });
  if (shake > 0) { shake = Math.max(0, shake - dt * 1.6); camera.position.x += (Math.random() - 0.5) * shake * 0.5; camera.position.y += (Math.random() - 0.5) * shake * 0.5; }
  camera.lookAt(camTarget);
}

/* ================= world updates ================= */
function updateWorld(dt: number, t: number) {
  if (state === 'play') for (const b of stations) if (b.t === 'crop') { b.growth = grow(b.growth ?? 0, dt, !!b.wet); setCropVisual(b); }
  for (const ch of chunks.values()) for (const n of ch.nodes) {
    if (n.dead) continue;
    if (n.shake > 0) { n.shake -= dt; const s = Math.sin(t * 60) * n.shake * (n.kind === 'tree' ? 0.05 : 0.02); n.mesh.rotation.z = s; n.mesh.rotation.x = (n.rx ?? 0) + s * 0.6; } else if (n.mesh.rotation.z !== 0) { n.mesh.rotation.z = 0; n.mesh.rotation.x = n.rx ?? 0; }
    if (n.kind === 'bush' && !n.ready) { n.regrow = Math.max(0, (bushReady[nk(n)] ?? 0) - todT); if (n.regrow === 0) { n.ready = true; delete bushReady[nk(n)]; n.mesh.geometry = G.bushBerry; } }
  }
  for (let i = falling.length - 1; i >= 0; i--) {
    const f = falling[i]; f.t += dt; const a = Math.min(1.55, f.t * f.t * 1.6); f.m.quaternion.setFromAxisAngle(tmpN.set(f.ax, 0, f.az), a);
    if (f.t > 1.6) { const s = Math.max(0.001, 1 - (f.t - 1.6) * 2); f.m.scale.multiplyScalar(0.94); if (f.t > 2.4) { f.m.visible = false; falling.splice(i, 1); } }
  }
  /* stations: flames and lights */
  const lightable = stations.filter(b => b.t === 'camp' || b.t === 'furnace' || b.t === 'torch' || b.t === 'lantern').map(b => ({ b, d: Math.hypot(b.i + 0.5 - P.x, b.k + 0.5 - P.z) + Math.abs(b.j - P.y) * 0.5 })).sort((a, b) => a.d - b.d);
  for (const b of stations) {
    if (b.t === 'camp' || b.t === 'torch') { const fl = b.obj!.userData.flames, f = 1 + Math.sin(t * 13 + b.i) * 0.14 + Math.sin(t * 7.3) * 0.1; fl[0].scale.set(f, 1 + Math.sin(t * 9) * 0.2, f); if (b.t === 'camp') fl[1].scale.set(f * 0.9, 1 + Math.sin(t * 11 + 1) * 0.25, f * 0.9); b.obj!.userData.glowSp.scale.setScalar((b.t === 'camp' ? 2.2 : 1.1) + Math.sin(t * 8) * 0.12); }
    if (b.t === 'lantern') { b.obj!.userData.core.rotation.y = t * 0.5; b.obj!.userData.glowSp.scale.setScalar(2.2 + Math.sin(t * 2.2) * 0.08); }
  }
  for (let i = 0; i < 4; i++) {
    const l = fireLights[i], e = lightable[i];
    if (e && e.d < 40) { const cfg = e.b.t === 'camp' ? [0xff9a3c, 1.9, 24, 0.9] : e.b.t === 'torch' ? [0xffb060, 1.2, 15, 0.9] : e.b.t === 'lantern' ? [0x70e8ff, 2.2, 28, 0.55] : [0xff7a20, 0.9, 24, 1.2]; l.position.set(e.b.i + 0.5, e.b.j + cfg[3], e.b.k + 0.5); l.color.set(cfg[0]); l.distance = cfg[2]; l.intensity = cfg[1] * (e.b.t === 'lantern' ? 1 : 1 + Math.sin(t * 12 + i * 3) * 0.12); } else l.intensity = 0;
  }
}
function showHarvestProgress(fraction: number, label: string) {
  $('harvestProgress').classList.remove('hidden'); $('harvestFill').style.width = Math.round(clamp(fraction, 0, 1) * 100) + '%'; $('harvestLabel').textContent = label;
}
function updateAimVisuals() {
  ghost.visible = false; selBox.visible = false; selBox.scale.set(1, 1, 1);
  const s = inv[sel], d = s ? ITEMS[s.id] : null; let prompt = '';
  $('harvestProgress').classList.add('hidden');
  if (state !== 'play' || uiOpen || paused) { $('prompt').classList.remove('on'); return; }
  if (d && (d.k === 'block' || d.k === 'station') && aim.place) {
    ghost.visible = true; const [i, j, k] = aim.place; ghost.position.set(i + 0.5, j + 0.5, k + 0.5); ghost.material.color.set(aim.placeOK ? 0x66ff88 : 0xff5544); prompt = aim.placeOK ? 'Place ' + d.n : '';
  } else if (aim.ok && aim.type === 'node' && aim.node) {
    const n = aim.node; prompt = n.kind === 'tree' ? 'Chop ' + (n.label?.toLowerCase() ?? (n.cactus ? 'cactus' : 'tree')) : n.kind === 'rock' ? 'Mine stone' : n.kind === 'ore' ? 'Mine iron ore' : (n.ready ? 'Pick berries (E), hit to uproot' : 'Bush regrowing; hit to uproot');
      if (n.kind !== 'bush' || n.hp < n.max) showHarvestProgress(1 - n.hp / n.max, n.kind === 'tree' ? (n.label === 'Ancient trunk' ? 'Axe required' : 'Faster with an axe') : n.kind === 'bush' ? 'Uprooting bush' : n.kind === 'ore' ? 'Stone pickaxe required' : 'Pickaxe required');
    selBox.visible = true; selBox.position.set(n.x, n.y0 + Math.min(n.h, 2) / 2, n.z); selBox.scale.set(n.r * 2, Math.min(n.h, 2), n.r * 2);
  } else if (aim.ok && aim.type === 'drop' && aim.drop) {
    prompt = ITEMS[aim.drop.slot.id].n + ' ×' + aim.drop.slot.n + ' (E to recover)';
  } else if (aim.ok && aim.type === 'pickup' && aim.pickup) {
    const p = aim.pickup; prompt = (p.label ?? ITEMS[p.item].n) + ' (E to gather)';
    const rule = harvestRule(p.label); showHarvestProgress(1 - (p.hp ?? rule.hits) / rule.hits, rule.hits > 1 ? (rule.tool ? 'Faster with a ' + rule.tool : 'Gathering') : 'Pick up');
    selBox.visible = true; selBox.position.set(p.x, (p.y ?? H(p.x, p.z)) + (p.h ?? 0.5) / 2, p.z); selBox.scale.set(p.r ? p.r * 2 : 0.6, p.h ?? 0.5, p.r ? p.r * 2 : 0.6);
  } else if (aim.ok && aim.type === 'ground' && aim.cell) {
    const [i, j, k] = aim.cell, id = getBlock(i, j, k), bd = BLOCK[id]; selBox.visible = true; selBox.position.set(i + 0.5, j + 0.5, k + 0.5);
    prompt = id === B.BEDROCK ? 'Bedrock' : bd.need > 0 ? 'Mine ' + bd.n.toLowerCase() + (bd.need >= 2 ? ' (stone pickaxe)' : ' (pickaxe)') : (bd.tool === 'axe' ? 'Chop ' : 'Dig ') + bd.n.toLowerCase();
    if (mining && mining.key === key(i, j, k) && id !== B.BEDROCK) prompt += '  ' + Math.round((1 - mining.hp / mining.max) * 100) + '%';
  } else if (aim.ok && aim.type === 'block' && aim.block) {
    const b = aim.block; selBox.visible = true; selBox.position.set(b.i + 0.5, b.j + 0.5, b.k + 0.5); prompt = b.t === 'chest' ? 'Storage chest (E to open)' : b.t === 'bench' ? 'Workbench (E to craft)' : b.t === 'furnace' ? 'Furnace (E to craft)' : b.t === 'camp' ? 'Campfire (E to cook)' : b.t === 'bed' ? 'Bed (E: inspect by day, sleep at night; B: inspect home)' : b.t === 'door' ? ((b.link ?? b).open ? 'Door, open (E to close)' : 'Door, closed (E to open)') : b.t === 'crop' ? (isRipe(b.growth ?? 0) ? 'Thistle root, ripe (E to harvest)' : STAGE_NAMES[cropStage(b.growth ?? 0)] + (b.wet ? '' : ', dry: grows slowly') + ' (hit to uproot)') : b.t === 'torch' ? 'Pick up torch' : b.t === 'lantern' ? 'Rootward Lantern' : 'Break block';
  } else if (aim.ok && aim.type === 'enemy') prompt = 'Gloom beetle';
  else if (aim.ok && (aim.type as Aim['type']) === 'site' && aim.site) prompt = aim.site.siteId === 'listening' ? 'Listen to the standing stone (E)' : (story.sites.door?.repaired ? 'Knock on the old door (E)' : 'Examine the ruined door (E)');
  else if (aim.ok && (aim.type as Aim['type']) === 'resident' && aim.resident) prompt = 'Talk to ' + RESIDENTS[aim.resident.id].name + ' (E), give held item (G)';
  if (d?.k === 'food') prompt = 'Click to use ' + d.n + (aim.type === 'pickup' ? '; E to gather' : '');
  const pe = $('prompt'); if (prompt) { pe.textContent = prompt; pe.classList.add('on'); } else pe.classList.remove('on');
}
const hud = { n: '', d: '', c: '' };
function updateHUD() {
  $('hpF').style.width = clamp(P.hp, 0, 100) + '%'; $('fdF').style.width = P.hunger + '%'; $('stF').style.width = P.stamina + '%';
  const p = TOD.p, name = p < 0.1 ? 'Dawn' : p < 0.4 ? 'Daylight' : p < 0.6 ? 'Dusk' : p < 0.92 ? 'Night' : 'Dawn';
  if (hud.n !== name) { hud.n = name; $('clockT').textContent = name; }
  const bn = WG.BIOME_NAME[WG.terr(Math.floor(P.x), Math.floor(P.z)).biome], dpt = Math.max(0, Math.round(H(P.x, P.z) - P.y)), alt = Math.round(P.y);
  const day = 'Day ' + (Math.floor(todT / DAY_LEN) + 1) + '  \u00b7  ' + bn + (inSpawnSanctuary(P.x, P.z) ? '  \u00b7  Safe clearing' : '  \u00b7  Wilderness') + (dpt > 1 ? '  \u00b7  Depth ' + dpt : alt > 12 ? '  \u00b7  Height ' + alt : '');
  if (hud.d !== day) { hud.d = day; $('clockS').textContent = day; }
  const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], q8 = (a: number) => CARD[Math.round((((a % TAU) + TAU) % TAU) / (TAU / 8)) % 8];
  const hx = -P.x, hz = 3 - P.z, hdist = Math.round(Math.hypot(hx, hz)), comp = 'Facing ' + q8(Math.atan2(-Math.sin(camYaw), Math.cos(camYaw))) + (hdist < 15 ? '  \u00b7  Home is close' : '  \u00b7  Home ' + hdist + ' ' + q8(Math.atan2(hx, -hz)));
  if (hud.c !== comp) { hud.c = comp; $('clockC').textContent = comp; }
}

/* ================= saving ================= */
const SAVE_KEY = 'thistlewick-save-v1'; let hasSave = false, saveT = 30, savedText: string | null = null;
/* the newest of localStorage and IndexedDB wins; a world too big for localStorage keeps saving to IndexedDB */
const backends: Backend[] = [];
try { backends.push(localBackend(SAVE_KEY, localStorage)); } catch (e) { /* storage blocked */ }
try { backends.push(idbBackend(indexedDB, 'thistlewick', SAVE_KEY)); } catch (e) { /* no IndexedDB */ }
const store = createStore(backends);
function peekSave() { try { return !!migrateSave(JSON.parse(savedText || 'null')); } catch (e) { return false; } }
function clearSave() { savedText = null; void store.clear(); }
function saveGame() {
  try {
    chronicle = compact(chronicle, MAX_EVENTS);
    const d: SaveV5 = { v: 5, events: encode(chronicle), worldSeed: world.seed, genVersion: world.genVersion, journal: [...progress], story, P: { x: P.x, y: P.y, z: P.z, hp: P.hp, hunger: P.hunger, stamina: P.stamina, heading: P.heading, spawnX: P.spawnX, spawnZ: P.spawnZ }, todT, sel, inv: inv.map(s => s ? [s.id, s.n, s.dur] as [string, number, number | undefined] : null), tips,
      stations: stations.filter(b => b.t !== 'crop').map(b => [b.t, b.i, b.j, b.k]),
      friends, homes: Object.fromEntries(residents.map(r => [r.id, r.home])),
      crops: cropStations().map(b => [b.i, b.j, b.k, Math.round(b.growth ?? 0)] as [number, number, number, number]), collected: [...collected], dead: [...deadNodes] };
    savedText = JSON.stringify(d); void store.save(savedText); return true;
  } catch (err) { return false; }
}
function loadGame() {
  let d: SaveV5 | null; try { d = migrateSave(JSON.parse(savedText || 'null')); } catch (e) { return false; } if (!d) return false;
  try {
    applyWorld(d.worldSeed, d.genVersion);
    story = d.story; loreSites = story.enabled ? makeStorySites(d.worldSeed, d.genVersion) : []; rebuildStorySiteVisuals();
    const p = d.P; P.x = p.x; P.z = p.z; P.y = p.y; P.hp = Math.max(20, p.hp); P.hunger = p.hunger; P.stamina = p.stamina; P.heading = p.heading; P.spawnX = p.spawnX; P.spawnZ = p.spawnZ; P.vx = P.vz = P.vy = 0;
    Object.assign(tips, d.tips || {}); for (const id of d.collected || []) collected.add(id); for (const k of d.dead || []) deadNodes.add(k);
    chronicle = decode(d.events); sinceDawn.length = 0;
    for (const e of chronicle) applyVox(e.i, e.j, e.k, e.id);
    inv.fill(null); (d.inv || []).forEach((s, i) => { if (s && ITEMS[s[0]] && i < 24) inv[i] = { id: s[0], n: s[1], dur: s[2] }; });
    todT = d.todT; sel = (d.sel | 0) % 8; progress.clear(); for (const k of d.journal) progress.add(k); tally = newTally();
    for (const ch of chunks.values()) disposeChunk(ch); chunks.clear();
    ensureChunks(true);
    for (const s of d.stations || []) if (BDEF[s[0]]) placeStation(s[1], s[2], s[3], s[0] as StationKind);
    for (const c of d.crops || []) placeStation(c[0], c[1], c[2], 'crop', c[3]);
    Object.assign(friends, d.friends || {}); for (const [id, home] of Object.entries(d.homes || {})) if (RESIDENTS[id]) spawnResident(id, home, []);
    homeT = 0;
    if (solid(Math.floor(P.x), Math.floor(P.y + 0.1), Math.floor(P.z)) || solid(Math.floor(P.x), Math.floor(P.y + 1.2), Math.floor(P.z))) P.y = surf(P.x, P.z);
    P.grounded = false; camTarget.set(P.x, P.y + 1.25, P.z);
    return true;
  } catch (err) { return false; }
}
addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') { saveGame(); if (!uiOpen) setPaused(true); } });
addEventListener('pagehide', () => { if (state === 'play') saveGame(); });

/* ================= start, resize, loop ================= */
function startGame(fresh: boolean) {
  if (fresh === undefined) fresh = true;
  if (!ready) return; initAudio(); resumeAudio();
  if (fresh) { applyWorld(randomSeed(), GEN_VERSION); story = createStorySave(true); loreSites = makeStorySites(world.seed, world.genVersion); rebuildStorySiteVisuals(); ensureChunks(true); P.y = surf(P.x, P.z); P.grounded = false; }
  $('start').classList.add('hidden'); $('hud').classList.remove('hidden'); if (isTouch) { $('touch').classList.remove('hidden'); $('xh').classList.add('on'); }
  progress.add('biome:' + WG.terr(Math.floor(P.x), Math.floor(P.z)).biome); renderGoal();
  state = 'play'; camTarget.set(P.x, P.y + 1.25, P.z); renderHot(); updateHeld();
  if (fresh) setTimeout(() => toast('This clearing is safe from beetles. Punch trees for wood; aim at plants and mushrooms and press E to gather.', false, 7000), 500);
  else setTimeout(() => toast('Welcome back', false, 1800), 400);
  setTimeout(() => { $('stn').style.opacity = '0'; }, 22000);
}
$('goBtn').addEventListener('click', () => {
  if (!ready) return;
  if (hasSave) { ($('goBtn') as HTMLButtonElement).disabled = true; $('goBtn').textContent = 'Loading...'; setTimeout(() => { const ok = loadGame(); startGame(!ok); }, 40); } else startGame(true);
});
$('newBtn').addEventListener('click', () => { if (!ready) return; clearSave(); hasSave = false; startGame(true); });

$('handsBtn').onclick = () => { sel = -1; renderHot(); updateHeld(); };
$('pauseBtn').onclick = () => { if (state === 'play') setPaused(true); };
$('resumeBtn').onclick = () => setPaused(false);
$('inspectHomeBtn').onclick = () => inspectHome();
$('closePackBtn').onclick = () => toggleInv(false);
$('closeJournalBtn').onclick = () => toggleJournal(false);
$('sortPackBtn').onclick = () => { sortPack(inv); sel = -1; swapFrom = null; refreshPack(); };
$('splitPackBtn').onclick = () => { if (!splitStack(inv, swapFrom ?? sel)) toast('Select a stack and leave one slot free', true); refreshPack(); };
$('transferPackBtn').onclick = () => quickTransfer(swapFrom ?? sel);
$('dropPackBtn').onclick = dropSelected;
for (const id of ['recipeCategory', 'craftBatch', 'craftableOnly']) $(id).onchange = () => renderInv();
for (const category of new Set(RECIPES.map(r => r.cat))) { const opt = document.createElement('option'); opt.value = opt.textContent = category; $('recipeCategory').appendChild(opt); }

$('overBtn').addEventListener('click', () => { if (state === 'dead') respawn(); });
function resize() {
  renderer.setPixelRatio(view.pixelRatio); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (composer) composer.setSize(Math.floor(innerWidth * view.pixelRatio), Math.floor(innerHeight * view.pixelRatio));
}
addEventListener('resize', resize);
if (composer) resize();

let last = performance.now(), T = 0, perfAcc = 0, perfN = 0, shadowsOn = true;
function frame(now: number) {
  requestAnimationFrame(frame);
  const frozen = paused || uiOpen || state === 'dialogue';
  const dt = frozen ? 0 : Math.min(0.05, (now - last) / 1000); last = now; T += dt; U.time.value = T; perfAcc += dt; perfN++;
  if (perfN >= 120) {
    const avg = perfAcc / perfN; perfAcc = 0; perfN = 0;
    if (avg > 1 / 30 && view.pixelRatio > 1) { view.pixelRatio = Math.max(1, view.pixelRatio - 0.25); resize(); }
    else if (avg > 1 / 24 && shadowsOn) { shadowsOn = false; sun.castShadow = false; if (bloom) bloom.enabled = false; }
  }
  if (state === 'play') { todT += dt; updatePlayer(dt); pickups(); if (dmgFlash > 0) dmgFlash = Math.max(0, dmgFlash - dt * 2.2); }
  else if (state === 'menu') todT += dt * 0.3;
  else if (state === 'sleep') { P.vx *= 0.8; P.vz *= 0.8; P.speed *= 0.8; }
  else { P.vx *= 0.9; P.vz *= 0.9; P.speed *= 0.9; }
  ensureChunks(false);
  { let nb = 0; for (const ch of chunks.values()) if (ch.dirty && nb < 2) { ch.dirty = false; buildGround(ch); nb++; } }
  { let cov = false; if (state === 'play') { const ci = Math.floor(P.x), ck = Math.floor(P.z), j0 = Math.floor(P.y + PHGT); for (let j = j0; j < j0 + 14; j++) if (solid(ci, j, ck)) { cov = true; break; } } ugU += ((cov ? 1 : 0) - ugU) * Math.min(1, dt * 2.5); }
  updateTOD(); if (!frozen) { updateEnemies(dt, T); updateCritters(dt); updateResidents(dt, T); updateBossBar(); } updateWorld(dt, T); if (!frozen) updateStorySites(T);
  sun.target.position.set(P.x, P.y, P.z); sun.position.set(P.x + TOD.dir.x * 160, P.y + TOD.dir.y * 160, P.z + TOD.dir.z * 160);
  animateGnome(dt, T); updateHeld();
  updateCamera(dt, T); sky.position.copy(camera.position);
  { const wetCam = getBlock(Math.floor(camera.position.x), Math.floor(camera.position.y), Math.floor(camera.position.z)) === B.WATER; uwU += ((wetCam ? 1 : 0) - uwU) * Math.min(1, dt * 6);
    const bb = WG.terr(Math.floor(P.x), Math.floor(P.z)).biome; fogD += (FOGT[bb] - fogD) * Math.min(1, dt * 0.4); snowU += ((bb === BIOME.PEAKS || P.y > 30 ? 1 : 0) - snowU) * Math.min(1, dt * 0.8);
    waterTex.offset.set((T * 0.012) % 1, (T * 0.008) % 1);
    if (state === 'play') { note('biome:' + bb); if (ugU > 0.6 && H(P.x, P.z) - P.y >= 4) note('cave'); } }
  if (state === 'play') { computeAim(); }
  updateAimVisuals(); updateShafts(T); updateMotes(dt, T); updateFlies(dt, T); updateParts(dt);
  for (const e of enemies) if (e.bar) e.bar.visible = !e.dying && e.hp < e.max && !e.boss;
  if (audioReady() && state === 'play' && TOD.night > 0.3 && Math.random() < dt * 0.6) sfx.chirp();
  if (state === 'play') { saveT -= dt; if (saveT <= 0) { saveGame(); saveT = 30; } }
  if (state === 'play' || state === 'dead') updateHUD();
  if (grade) { grade.uniforms.uTime.value = T; grade.uniforms.uDmg.value = dmgFlash * 0.85; grade.uniforms.uVig.value = 0.45 + TOD.night * 0.2 + ugU * 0.15; }
  if (composer) composer.render(dt); else renderer.render(scene, camera);
}
/** Test hooks for the browser smoke test. Only exists when the page URL contains ?debug. */
if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as { __tw: unknown }).__tw = {
    travel(x: number, z: number) { P.x = x; P.z = z; P.y = surf(x, z); P.vx = P.vz = P.vy = 0; ensureChunks(true); camTarget.set(x, P.y + 1.25, z); },
    survival: () => ({ safe: inSpawnSanctuary(P.x, P.z), hp: P.hp, enemies: enemies.length, horizon: horizon.count(), renderDistance: HORIZON_RAD * S, far: camera.far, skyRadius: SKY_RADIUS, fog: fogD }),
    spawnTrial() { const before = enemies.length; for (let i = 0; i < 80; i++) spawnBeetle(); return { added: enemies.length - before, forbidden: enemies.filter(e => inSpawnSanctuary(e.x, e.z, 4)).length }; },
    safetyTick() { updateEnemies(0.05, T); },
    resources: () => [...chunks.values()].flatMap(ch => ch.picks.filter(p => p.manual && !p.dead).map(p => ({ id: p.id, label: p.label, item: p.item, x: p.x, z: p.z }))),
    woodSources: () => [...chunks.values()].flatMap(ch => ch.nodes.filter(n => n.label && !n.dead).map(n => ({ id: nk(n), label: n.label, x: n.x, z: n.z }))),
    chopSource(id: string) {
      const n = [...chunks.values()].flatMap(ch => ch.nodes).find(n => nk(n) === id); if (!n) return false;
      for (let hits = 0; hits < 100 && !n.dead; hits++) hitNode(n, { d: null, chop: 1, mine: 0, dmg: 2, range: 2, blockPow: 0.7 });
      return n.dead;
    },
    woodState(id: string) {
      const n = [...chunks.values()].flatMap(ch => ch.nodes).find(n => nk(n) === id); if (!n) return null;
      return { dead: n.dead, colliders: [...chunks.values()].reduce((sum, ch) => sum + ch.col.filter(c => c.node === n).length, 0) };
    },
    gather(id: string, swing = false) {
      const p = [...chunks.values()].flatMap(ch => ch.picks).find(p => p.id === id); if (!p) return false;
      aim.type = 'pickup'; aim.pickup = p; aim.ok = true;
      if (swing) resolveSwing(); else interact(); return p.dead;
    },
    aimResource(id: string) {
      const p = [...chunks.values()].flatMap(ch => ch.picks).find(p => p.id === id); if (!p) return null;
      P.x = p.x; P.z = p.z; P.y = H(p.x, p.z); P.vx = P.vy = P.vz = 0;
      sel = inv.findIndex(s => !s || ITEMS[s.id].k === 'res'); if (sel < 0) sel = 0;
      camera.position.set(p.x + 0.05, (p.y ?? P.y) + (p.h ?? 0.6) + 2, p.z + 0.05);
      camera.lookAt(p.x, (p.y ?? P.y) + (p.h ?? 0.6) / 2, p.z); mouseX = innerWidth / 2; mouseY = innerHeight / 2;
      computeAim(); const target = aim.type === 'pickup' ? aim.pickup?.id : null;
      if (target === id && aim.ok) interact(); return target;
    },
    resourceState(id: string) {
      const p = [...chunks.values()].flatMap(ch => ch.picks).find(p => p.id === id); if (!p) return null;
      const m = new THREE.Matrix4(); p.mesh.getMatrixAt(p.idx, m); return { dead: p.dead, hidden: m.elements[0] === 0 && m.elements[5] === 0 && m.elements[10] === 0 };
    },
    fullPackGather(id: string) {
      const saved = inv.slice(); inv.fill(null); for (let i = 0; i < inv.length; i++) inv[i] = { id: 'stone', n: 64 };
      const p = [...chunks.values()].flatMap(ch => ch.picks).find(p => p.id === id);
      const result = p ? harvestPickup(p) : null; inv.splice(0, inv.length, ...saved); renderHot(); return result;
    },
    /** Puts a seed in the hand and plants it two blocks east through the normal placement code. */
    plant() {
      giveItem('seed', 1); sel = inv.findIndex(s => s && s.id === 'seed'); updateHeld();
      const i = Math.floor(P.x) + 2, k = Math.floor(P.z); aim.place = [i, surf(i + 0.5, k + 0.5), k]; aim.placeOK = true; tryPlace();
    },
    /** Jumps to night, places a bed at the player's feet and sleeps in it. */
    sleepNow() { todT = Math.floor(todT / DAY_LEN) * DAY_LEN + 0.7 * DAY_LEN; },
    bedAndSleep() { sleep(placeStation(Math.floor(P.x) - 2, surf(P.x - 2, P.z), Math.floor(P.z), 'bed')); },
    crops: () => cropStations().map(b => ({ stage: cropStage(b.growth ?? 0), wet: !!b.wet })),
    progress: () => [...progress],
    night: () => TOD.night,
    spawnBoss() { for (let n = 0; n < 40 && !enemies.some(e => !!e.boss); n++) spawnBoss(dayNow()); return enemies.some(e => !!e.boss); },
    boss: () => { const b = enemies.find(e => !!e.boss); return b ? { hp: b.hp, max: b.max, phase: b.boss!.phase, enraged: b.boss!.enraged } : null; },
    hitBoss(dmg: number) { const b = enemies.find(e => !!e.boss); if (b) hitEnemy(b, { d: null, chop: 0, mine: 0, dmg, range: 2, blockPow: 0 }); },
    count: (id: string) => countItem(id),
    /** Builds a sealed 5x5x3 stone hut east of the player with a door, a bed, a torch and a workbench. */
    buildCottage() {
      const ox = Math.floor(P.x) + 9, oz = Math.floor(P.z); let j0 = -99;
      for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) j0 = Math.max(j0, surf(ox + a + 0.5, oz + b + 0.5));
      for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) for (let j = j0 - 1; j <= j0 + 3; j++) {
        const shell = Math.abs(a) === 3 || Math.abs(b) === 3 || j === j0 - 1 || j === j0 + 3;
        setVox(ox + a, j, oz + b, shell ? B.STONE : 0);
      }
      setVox(ox - 3, j0, oz, 0); setVox(ox - 3, j0 + 1, oz, 0);
      placeStation(ox - 3, j0, oz, 'door');
      placeStation(ox - 2, j0, oz - 2, 'bed'); placeStation(ox + 2, j0, oz - 2, 'bench'); placeStation(ox, j0, oz + 2, 'torch');
      return { ox, oz, j0 };
    },
    breakRoof(c: { ox: number; oz: number; j0: number }) { setVox(c.ox, c.j0 + 3, c.oz, 0); },
    checkHomesNow() { checkHomes(); },
    /** Toggles the door and reports whether both of its cells now block movement. */
    toggleDoor(c: { ox: number; oz: number; j0: number }) { const d = stations.find(b => b.t === 'door'); if (d) toggleDoor(d); return { open: !!d?.open, solidLow: solid(c.ox - 3, c.j0, c.oz), solidHigh: solid(c.ox - 3, c.j0 + 1, c.oz) }; },
    residents: () => residents.map(r => ({ id: r.id, x: r.x, z: r.z })),
    friend: (id: string) => friends[id]?.friendship ?? -1,
    talk() { if (residents[0]) talkTo(residents[0]); },
    gift(id: string) { giveItem(id, 1); sel = inv.findIndex(s => s && s.id === id); if (residents[0]) giftTo(residents[0]); },
    speech: () => ($('speech').classList.contains('show') ? $('spText').textContent : ''),
    hp: () => P.hp,
    chronicle: () => ({ events: chronicle.length, sinceDawn: summarize(sinceDawn) }),
    dig() { const i = Math.floor(P.x) + 3, k = Math.floor(P.z); setVox(i, surf(i + 0.5, k + 0.5) - 1, k, 0); setVox(i + 1, surf(i + 1.5, k + 0.5), k, B.STONE); },
    world: () => ({ seed: world.seed, genVersion: world.genVersion })
  };
}

requestAnimationFrame(() => {
  ensureChunks(true); renderHot();
  store.load().then(text => { savedText = text; }, () => { /* start without a save */ }).then(() => {
    ready = true; ($('goBtn') as HTMLButtonElement).disabled = false; hasSave = peekSave(); $('goBtn').textContent = hasSave ? 'Continue' : 'Begin'; if (hasSave) $('newBtn').classList.remove('hidden');
  });
});
requestAnimationFrame(frame);

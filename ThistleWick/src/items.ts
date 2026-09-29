import { WG } from './world/worldgen';
const { B } = WG;
export type ItemKind = 'res' | 'block' | 'station' | 'food' | 'tool' | 'shield';
export type StationKind = 'bench' | 'furnace' | 'camp' | 'bed' | 'torch' | 'ladder' | 'crop';
export interface ItemDef { id: string; n: string; k: ItemKind; stack: number; bid?: number; place?: StationKind; food?: number; heal?: number; tool?: 'axe' | 'pick' | 'shovel' | 'sword'; tier?: number; dur?: number; reduce?: number }
export const ITEMS: Record<string, ItemDef> = {};
function def(id: string, o: Omit<Partial<ItemDef>, "id"> & Pick<ItemDef, "n" | "k">) { ITEMS[id] = Object.assign({ id, stack: 64 }, o); }
def('wood', { n: 'Wood', k: 'res' }); def('stick', { n: 'Stick', k: 'res' }); def('stone', { n: 'Stone', k: 'block', bid: B.STONE }); def('fiber', { n: 'Plant fiber', k: 'res' });
def('ore', { n: 'Iron ore', k: 'res' }); def('ingot', { n: 'Iron ingot', k: 'res' }); def('shell', { n: 'Beetle shell', k: 'res' });
def('plank', { n: 'Plank', k: 'block', bid: B.PLANK }); def('brick', { n: 'Stone brick', k: 'block', bid: B.BRICK }); def('dirt', { n: 'Dirt', k: 'block', bid: B.DIRT });
def('sand', { n: 'Sand', k: 'block', bid: B.SAND }); def('gravel', { n: 'Gravel', k: 'block', bid: B.GRAVEL }); def('snow', { n: 'Snow', k: 'block', bid: B.SNOW }); def('crystal', { n: 'Glow crystal', k: 'block', bid: B.CRYSTAL });
def('coal', { n: 'Coal', k: 'res' }); def('torch', { n: 'Torch', k: 'station', place: 'torch', stack: 32 }); def('ladder', { n: 'Ladder', k: 'station', place: 'ladder', stack: 32 });
def('meat', { n: 'Raw meat', k: 'food', food: 12, heal: 0, stack: 16 }); def('cmeat', { n: 'Roasted meat', k: 'food', food: 55, heal: 15, stack: 16 });
def('berries', { n: 'Berries', k: 'food', food: 14, heal: 2, stack: 32 }); def('mushroom', { n: 'Mushroom', k: 'food', food: 9, heal: 0, stack: 32 });
def('cmush', { n: 'Roasted mushroom', k: 'food', food: 34, heal: 12, stack: 32 }); def('bandage', { n: 'Bandage', k: 'food', food: 0, heal: 35, stack: 16 });
def('workbench', { n: 'Workbench', k: 'station', place: 'bench', stack: 4 }); def('furnace', { n: 'Furnace', k: 'station', place: 'furnace', stack: 4 });
def('campfire', { n: 'Campfire', k: 'station', place: 'camp', stack: 8 }); def('bed', { n: 'Bed', k: 'station', place: 'bed', stack: 2 });
def('seed', { n: 'Wild seed', k: 'station', place: 'crop', stack: 32 }); def('root', { n: 'Thistle root', k: 'food', food: 30, heal: 5, stack: 16 }); def('croot', { n: 'Roasted root', k: 'food', food: 62, heal: 14, stack: 16 });
export const TIERN = ['', 'Wooden', 'Stone', 'Iron'], DUR = { tool: [0, 45, 100, 260], shield: [0, 60, 120, 260] };
export const DMG = { sword: [0, 7, 11, 17], axe: [0, 5, 7, 10], pick: [0, 4, 6, 8], shovel: [0, 4, 6, 8] }; export const CHOP = [1, 2.2, 3.6, 5.8]; export const MINE = [0, 1.6, 3.0, 5.2]; export const DIGP = [0, 2.2, 3.6, 5.8]; export const BLOCKR = [0, 0.6, 0.75, 0.9];
const TP = ['', 'w', 's', 'i'];
for (let t = 1; t <= 3; t++) {
  def(TP[t] + 'axe', { n: TIERN[t] + ' axe', k: 'tool', tool: 'axe', tier: t, dur: DUR.tool[t], stack: 1 });
  def(TP[t] + 'pick', { n: TIERN[t] + ' pickaxe', k: 'tool', tool: 'pick', tier: t, dur: DUR.tool[t], stack: 1 });
  def(TP[t] + 'shovel', { n: TIERN[t] + ' shovel', k: 'tool', tool: 'shovel', tier: t, dur: DUR.tool[t], stack: 1 });
  def(TP[t] + 'sword', { n: TIERN[t] + ' sword', k: 'tool', tool: 'sword', tier: t, dur: DUR.tool[t], stack: 1 });
  def(TP[t] + 'shield', { n: TIERN[t] + ' shield', k: 'shield', tier: t, dur: DUR.shield[t], reduce: BLOCKR[t], stack: 1 });
}
def('cshield', { n: 'Carapace shield', k: 'shield', tier: 4, dur: 150, reduce: 0.85, stack: 1 });
export interface StationDef { hp: number; tool: string; item: string; st: number; ns?: number }
export const BDEF: Record<string, StationDef> = {
  bench: { hp: 6, tool: 'axe', item: 'workbench', st: 1 }, furnace: { hp: 9, tool: 'pick', item: 'furnace', st: 1 },
  camp: { hp: 3, tool: 'axe', item: 'campfire', st: 1 }, bed: { hp: 4, tool: 'axe', item: 'bed', st: 1 }, torch: { hp: 1, tool: 'axe', item: 'torch', st: 1, ns: 1 }, ladder: { hp: 1, tool: 'axe', item: 'ladder', st: 1, ns: 1 },
  crop: { hp: 1, tool: 'shovel', item: 'seed', st: 1, ns: 1 }
};
/* voxel block table: tiles are cells in the texture atlas */
export const TL = { DIRT: 0, LITTER_SIDE: 1, STONE: 2, IRON: 3, COAL: 4, BEDROCK: 5, SAND: 6, SANDSTONE: 7, SNOW: 8, SNOW_SIDE: 9, GRAVEL: 10, GRASS: 11, GRASS_SIDE: 12, LAVA: 14, CRYSTAL: 15, PLANK: 16, BRICK: 17 };
export interface BlockDef { solid: boolean; opq: boolean; hp: number; tool: string; need: number; drop: string | null; top: number; side: number; bot: number; mesh: 'atlas' | 'water' | 'glow'; n: string }
export const BLOCK: BlockDef[] = [];
function bdef(id: number, o: Partial<BlockDef>) { BLOCK[id] = Object.assign({ solid: true, opq: true, hp: 3, tool: 'shovel', need: 0, drop: null, top: 0, side: 0, bot: 0, mesh: 'atlas', n: '' }, o); }
const all = (t: number) => ({ top: t, side: t, bot: t });
bdef(B.AIR, { solid: false, opq: false, hp: 0 });
bdef(B.GRASS, { n: 'Forest floor', drop: 'dirt', top: TL.DIRT, side: TL.LITTER_SIDE, bot: TL.DIRT });
bdef(B.DIRT, Object.assign({ n: 'Dirt', drop: 'dirt' }, all(TL.DIRT)));
bdef(B.STONE, Object.assign({ n: 'Stone', hp: 8, tool: 'pick', need: 1, drop: 'stone' }, all(TL.STONE)));
bdef(B.IRON, Object.assign({ n: 'Iron ore', hp: 12, tool: 'pick', need: 2, drop: 'ore' }, all(TL.IRON)));
bdef(B.COAL, Object.assign({ n: 'Coal', hp: 9, tool: 'pick', need: 1, drop: 'coal' }, all(TL.COAL)));
bdef(B.BEDROCK, Object.assign({ n: 'Bedrock', hp: Infinity, tool: 'pick', need: 9 }, all(TL.BEDROCK)));
bdef(B.SAND, Object.assign({ n: 'Sand', hp: 2.5, drop: 'sand' }, all(TL.SAND)));
bdef(B.SANDSTONE, Object.assign({ n: 'Sandstone', hp: 6, tool: 'pick', need: 1, drop: 'stone' }, all(TL.SANDSTONE)));
bdef(B.SNOW, { n: 'Snow', hp: 1.5, drop: 'snow', top: TL.SNOW, side: TL.SNOW_SIDE, bot: TL.DIRT });
bdef(B.GRAVEL, Object.assign({ n: 'Gravel', hp: 3, drop: 'gravel' }, all(TL.GRAVEL)));
bdef(B.MEADOW, { n: 'Grass', drop: 'dirt', top: TL.GRASS, side: TL.GRASS_SIDE, bot: TL.DIRT });
bdef(B.WATER, { n: 'Water', solid: false, opq: false, hp: 0, mesh: 'water' as const });
bdef(B.LAVA, Object.assign({ n: 'Lava', solid: false, opq: true, hp: 0, mesh: 'glow' as const }, all(TL.LAVA)));
bdef(B.CRYSTAL, Object.assign({ n: 'Glow crystal', hp: 4, tool: 'pick', need: 1, drop: 'crystal', mesh: 'glow' as const }, all(TL.CRYSTAL)));
bdef(B.PLANK, Object.assign({ n: 'Plank', hp: 5, tool: 'axe', drop: 'plank' }, all(TL.PLANK)));
bdef(B.BRICK, Object.assign({ n: 'Stone brick', hp: 9, tool: 'pick', drop: 'brick' }, all(TL.BRICK)));
export const SOLIDB = BLOCK.map(b => !!(b && b.solid)); export const OPQ = BLOCK.map(b => !!(b && b.opq));
export const BCOL: Record<number, number> = { 1: 0x6b5638, 2: 0x7a5a3a, 3: 0xa0a0a0, 4: 0xd9762a, 5: 0x2a2a2e, 6: 0x444448, 7: 0xdccb8b, 8: 0xcdb377, 9: 0xf2f6fa, 10: 0x8a8a8a, 11: 0x5f9d3a, 14: 0x5fe0ff, 15: 0xb98450, 16: 0x8f9296 };
export interface Recipe { cat: string; st?: StationKind; out: string; n: number; in: Record<string, number> }
export const RECIPES: Recipe[] = [
  { cat: 'Basics', out: 'stick', n: 4, in: { wood: 1 } }, { cat: 'Basics', out: 'plank', n: 2, in: { wood: 1 } },
  { cat: 'Basics', out: 'bandage', n: 1, in: { fiber: 3 } }, { cat: 'Basics', out: 'workbench', n: 1, in: { plank: 4 } },
  { cat: 'Basics', out: 'campfire', n: 1, in: { wood: 3, stone: 3 } }, { cat: 'Basics', out: 'torch', n: 4, in: { coal: 1, stick: 1 } }, { cat: 'Basics', out: 'ladder', n: 3, in: { stick: 5 } },
  { cat: 'Tools', st: 'bench', out: 'waxe', n: 1, in: { plank: 3, stick: 2 } }, { cat: 'Tools', st: 'bench', out: 'wpick', n: 1, in: { plank: 3, stick: 2 } },
  { cat: 'Tools', st: 'bench', out: 'saxe', n: 1, in: { stone: 3, stick: 2, fiber: 1 } }, { cat: 'Tools', st: 'bench', out: 'spick', n: 1, in: { stone: 3, stick: 2, fiber: 1 } },
  { cat: 'Tools', st: 'bench', out: 'iaxe', n: 1, in: { ingot: 3, stick: 2 } }, { cat: 'Tools', st: 'bench', out: 'ipick', n: 1, in: { ingot: 3, stick: 2 } },
  { cat: 'Tools', st: 'bench', out: 'wshovel', n: 1, in: { plank: 1, stick: 2 } }, { cat: 'Tools', st: 'bench', out: 'sshovel', n: 1, in: { stone: 1, stick: 2 } }, { cat: 'Tools', st: 'bench', out: 'ishovel', n: 1, in: { ingot: 1, stick: 2 } },
  { cat: 'Weapons', st: 'bench', out: 'wsword', n: 1, in: { plank: 2, stick: 1 } }, { cat: 'Weapons', st: 'bench', out: 'ssword', n: 1, in: { stone: 2, stick: 1, fiber: 1 } },
  { cat: 'Weapons', st: 'bench', out: 'isword', n: 1, in: { ingot: 2, stick: 1 } },
  { cat: 'Shields', st: 'bench', out: 'wshield', n: 1, in: { plank: 5, fiber: 1 } }, { cat: 'Shields', st: 'bench', out: 'sshield', n: 1, in: { plank: 2, stone: 4 } },
  { cat: 'Shields', st: 'bench', out: 'ishield', n: 1, in: { ingot: 5, plank: 1 } }, { cat: 'Shields', st: 'bench', out: 'cshield', n: 1, in: { shell: 4, plank: 1, fiber: 2 } },
  { cat: 'Building', st: 'bench', out: 'brick', n: 3, in: { stone: 2 } }, { cat: 'Building', st: 'bench', out: 'furnace', n: 1, in: { stone: 8 } },
  { cat: 'Building', st: 'bench', out: 'bed', n: 1, in: { plank: 3, fiber: 4 } },
  { cat: 'Furnace and fire', st: 'furnace', out: 'ingot', n: 1, in: { ore: 1, wood: 1 } }, { cat: 'Furnace and fire', st: 'furnace', out: 'ingot', n: 2, in: { ore: 2, coal: 1 } }, { cat: 'Furnace and fire', st: 'camp', out: 'cmush', n: 1, in: { mushroom: 1 } }, { cat: 'Furnace and fire', st: 'camp', out: 'croot', n: 1, in: { root: 1 } }, { cat: 'Furnace and fire', st: 'camp', out: 'cmeat', n: 1, in: { meat: 1 } }
];
export const STN: Record<string, string> = { bench: 'a workbench', furnace: 'a furnace', camp: 'a campfire' };

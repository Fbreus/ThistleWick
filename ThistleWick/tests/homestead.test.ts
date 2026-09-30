import { describe, expect, it } from 'vitest';
import { MIN_CELLS, checkCottage, findRoom, floorCells, startsNear, type Cell, type RoomQuery } from '../src/systems/homestead';
import { RESIDENTS, candidateLines, giveGift, giftKind, newFriend, pickLine, presentFor, talk, tierOf } from '../src/systems/dialogue';
import { ARCS } from '../src/systems/journal';
import { ITEMS, RECIPES, BDEF } from '../src/items';

/** A hollow box from (0,0,0) to (w,h,d) exclusive of its shell: walls on the shell, free inside. Ground is y = -1. */
function hut(w: number, h: number, d: number, holes: Cell[] = [], extra: Cell[] = []): RoomQuery {
  const open = new Set(holes.map(c => c.join(',')));
  return {
    wall(i, j, k) {
      if (open.has(i + ',' + j + ',' + k)) return false;
      if (extra.some(c => c[0] === i && c[1] === j && c[2] === k)) return true;
      if (j < 0) return j === -1 && i >= -20 && i <= 30 && k >= -20 && k <= 30; // ground plane, only one layer thick
      const inside = i >= 1 && i <= w && k >= 1 && k <= d && j >= 0 && j < h;
      const shell = i >= 0 && i <= w + 1 && k >= 0 && k <= d + 1 && j >= 0 && j <= h;
      return shell && !inside;
    }
  };
}
const stations = [{ t: 'bed', i: 1, j: 0, k: 1 }, { t: 'torch', i: 3, j: 0, k: 3 }, { t: 'bench', i: 4, j: 0, k: 1 }];

describe('findRoom', () => {
  it('a sealed 4x2x4 hut is enclosed with 32 free cells', () => {
    const room = findRoom(hut(4, 2, 4), [2, 0, 2]);
    expect(room.enclosed).toBe(true);
    expect(room.cells.length).toBe(32);
  });
  it('a hole in the roof or the wall makes it open', () => {
    expect(findRoom(hut(4, 2, 4, [[2, 2, 2]]), [2, 0, 2]).enclosed).toBe(false);
    expect(findRoom(hut(4, 2, 4, [[0, 0, 2], [0, 1, 2]]), [2, 0, 2]).enclosed).toBe(false);
  });
  it('refuses to start inside a wall', () => {
    expect(findRoom(hut(4, 2, 4), [0, 0, 0]).reason).toBe('blocked-start');
  });
  it('a huge hall counts as open rather than as a cottage', () => {
    expect(findRoom(hut(30, 2, 30), [2, 0, 2]).enclosed).toBe(false);
  });
  it('a door in the doorway (a wall in both states) keeps the room sealed', () => {
    const q = hut(4, 2, 4, [], [[0, 0, 2], [0, 1, 2]]);
    const walls = hut(4, 2, 4, [[0, 0, 2], [0, 1, 2]]);
    expect(findRoom(walls, [2, 0, 2]).enclosed).toBe(false);
    const withDoor: RoomQuery = { wall: (i, j, k) => walls.wall(i, j, k) || q.wall(i, j, k) };
    expect(findRoom(withDoor, [2, 0, 2]).enclosed).toBe(true);
  });
});

describe('checkCottage', () => {
  const q = hut(4, 2, 4, [], [[1, 0, 1], [4, 0, 1]]); // the bed and the bench are solid, like in the game
  const room = findRoom(q, [2, 0, 2]);
  it('is valid with a bed, a light and a workbench', () => {
    expect(checkCottage(room, stations)).toEqual({ ok: true, missing: [] });
  });
  it('lists exactly what is missing', () => {
    expect(checkCottage(room, stations.filter(s => s.t !== 'torch')).missing).toEqual(['a light']);
    expect(checkCottage(room, []).missing).toEqual(['a bed', 'a light', 'a workbench']);
  });
  it('a campfire counts as a light', () => {
    expect(checkCottage(room, [...stations.filter(s => s.t !== 'torch'), { t: 'camp', i: 2, j: 0, k: 4 }]).ok).toBe(true);
  });
  it('a Rootward Lantern counts as a light', () => {
    expect(checkCottage(room, [...stations.filter(s => s.t !== 'torch'), { t: 'lantern', i: 2, j: 0, k: 4 }]).ok).toBe(true);
  });
  it('stations outside the room do not count', () => {
    expect(checkCottage(room, [...stations.filter(s => s.t !== 'bed'), { t: 'bed', i: 20, j: 0, k: 20 }]).missing).toEqual(['a bed']);
  });
  it('needs space and a sealed room', () => {
    const tiny = findRoom(hut(2, 2, 1), [1, 0, 1]);
    expect(tiny.cells.length).toBeLessThan(MIN_CELLS);
    expect(checkCottage(tiny, [{ t: 'bed', i: 1, j: 0, k: 1 }, { t: 'torch', i: 2, j: 0, k: 2 }, { t: 'bench', i: 1, j: 0, k: 2 }]).missing).toContain('more space');
    expect(checkCottage(findRoom(hut(4, 2, 4, [[2, 2, 2]]), [2, 0, 2]), stations).ok).toBe(false);
  });
  it('finds floor cells and start cells next to a bed', () => {
    expect(floorCells(room, q).every(c => c[1] === 0)).toBe(true);
    expect(startsNear({ t: 'bed', i: 1, j: 0, k: 1 }, q).length).toBeGreaterThan(0);
  });
});

describe('residents and friendship', () => {
  const bramble = RESIDENTS.bramble;
  const ctx = (o: Partial<{ day: number; night: boolean; tier: number; flags: string[] }> = {}) => ({ day: 1, night: false, tier: 0, ...o, flags: new Set(o.flags ?? []) });

  it('tiers rise with friendship', () => {
    expect([0, 2, 3, 7, 8, 14, 15, 99].map(tierOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
  it('talking builds friendship once per day and hands out presents from tier 2', () => {
    let f = newFriend();
    let r = talk(f, 1); f = r.friend; expect([r.gained, f.friendship, r.present]).toEqual([1, 1, false]);
    r = talk(f, 1); f = r.friend; expect([r.gained, f.friendship]).toEqual([0, 1]);
    f = { ...f, friendship: 7 };
    r = talk(f, 2); expect(r.present).toBe(true); expect(r.friend.friendship).toBe(8);
    expect(talk(r.friend, 2).present).toBe(false);
  });
  it('presents depend on the tier reached', () => {
    expect(presentFor(bramble, 3)).toBeNull();
    expect(presentFor(bramble, 8)).toEqual({ seed: 2 });
    expect(presentFor(bramble, 20)).toEqual({ bandage: 2, coal: 3 });
  });
  it('gifts: loved beats liked beats neutral, disliked hurts, and only one per day', () => {
    expect(['crystal', 'berries', 'wood', 'meat'].map(id => giftKind(bramble, id))).toEqual(['love', 'like', 'neutral', 'dislike']);
    let f = newFriend();
    const g1 = giveGift(bramble, f, 'croot', 3); expect([g1.accepted, g1.friend.friendship]).toEqual([true, 4]);
    const g2 = giveGift(bramble, g1.friend, 'berries', 3); expect([g2.accepted, g2.friend.friendship, g2.reaction]).toEqual([false, 4, bramble.reactions.already]);
    expect(giveGift(bramble, newFriend(), 'meat', 1).friend.friendship).toBe(0);
    f = giveGift(bramble, f, 'wood', 4).friend; expect(f.friendship).toBe(1);
  });
  it('every gift preference and present names a real item', () => {
    for (const id of [...bramble.likes, ...bramble.loves, ...bramble.dislikes]) expect(ITEMS[id], id).toBeDefined();
    for (const t of Object.values(bramble.presents)) for (const id of Object.keys(t)) expect(ITEMS[id], id).toBeDefined();
  });
  it('line choice follows tier, time of day and what the player has done', () => {
    const ids = (c: ReturnType<typeof ctx>) => candidateLines(bramble, c).map(l => l.id);
    expect(ids(ctx())).toContain('g0a');
    expect(ids(ctx())).not.toContain('t1a');
    expect(ids(ctx({ tier: 2 }))).toEqual(expect.arrayContaining(['t1a', 't2a']));
    expect(ids(ctx({ night: true }))).toContain('night');
    expect(ids(ctx({ night: true }))).not.toContain('day');
    expect(ids(ctx({ flags: ['place:crop'] }))).toContain('garden');
  });
  it('does not repeat the last line when there is a choice, and always returns something', () => {
    const c = candidateLines(bramble, ctx());
    for (const r of [0, 0.4, 0.99]) expect(pickLine(c, c[0].id, () => r).id).not.toBe(c[0].id);
    expect(pickLine([c[0]], c[0].id).id).toBe(c[0].id);
  });
});

describe('cottage content', () => {
  it('doors are craftable placeable stations and a home arc exists', () => {
    expect(ITEMS.door.place).toBe('door');
    expect(BDEF.door.item).toBe('door');
    expect(RECIPES.some(r => r.out === 'door' && r.st === 'bench')).toBe(true);
    expect(ARCS.some(a => a.id === 'home')).toBe(true);
  });
  it('the Rootward Lantern is a gated placeable recipe', () => {
    expect(ITEMS.lantern.place).toBe('lantern');
    expect(BDEF.lantern.item).toBe('lantern');
    expect(RECIPES.find(r => r.out === 'lantern')).toMatchObject({ st: 'bench', unlock: 'lantern', in: { crystal: 1, ingot: 1, shell: 1, plank: 2 } });
  });
});

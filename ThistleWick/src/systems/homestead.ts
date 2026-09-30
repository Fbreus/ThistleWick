/** Cottage rules: is a room sealed, and does it hold what a resident needs? Pure, so it can be tested. */

export type Cell = [number, number, number];
export interface RoomQuery { /** True for terrain, solid stations and doors (open or closed). */ wall(i: number, j: number, k: number): boolean }
export interface Room { enclosed: boolean; cells: Cell[]; reason: 'ok' | 'open' | 'blocked-start' }
export interface StationRef { t: string; i: number; j: number; k: number }

/** Horizontal reach from the start cell, and how far the room may extend up and down. Bigger than this counts as open. */
export const ROOM_RADIUS = 8, ROOM_UP = 5, ROOM_DOWN = 1, ROOM_MAX_CELLS = 500;
export const MIN_CELLS = 8;

const DIRS: Cell[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const cellKey = (i: number, j: number, k: number) => i + ',' + j + ',' + k;

/** Flood-fills the free cells around `start`. The room is enclosed only if the fill never leaves its bounding box. */
export function findRoom(q: RoomQuery, start: Cell): Room {
  const [si, sj, sk] = start;
  if (q.wall(si, sj, sk)) return { enclosed: false, cells: [], reason: 'blocked-start' };
  const seen = new Set<string>([cellKey(si, sj, sk)]), cells: Cell[] = [], queue: Cell[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    cells.push(c);
    for (const d of DIRS) {
      const i = c[0] + d[0], j = c[1] + d[1], k = c[2] + d[2];
      if (q.wall(i, j, k)) continue;
      if (Math.abs(i - si) > ROOM_RADIUS || Math.abs(k - sk) > ROOM_RADIUS || j - sj > ROOM_UP || sj - j > ROOM_DOWN) return { enclosed: false, cells: [], reason: 'open' };
      const kk = cellKey(i, j, k);
      if (seen.has(kk)) continue;
      seen.add(kk);
      if (seen.size > ROOM_MAX_CELLS) return { enclosed: false, cells: [], reason: 'open' };
      queue.push([i, j, k]);
    }
  }
  return { enclosed: true, cells, reason: 'ok' };
}

export interface CottageCheck { ok: boolean; missing: string[] }

/** What a resident wants in the room: space to stand, a bed, a light and a workbench. */
export function checkCottage(room: Room, stations: readonly StationRef[]): CottageCheck {
  if (!room.enclosed) return { ok: false, missing: ['walls and a roof with no gaps'] };
  const set = new Set(room.cells.map(c => cellKey(c[0], c[1], c[2])));
  const inRoom = (s: StationRef) => set.has(cellKey(s.i, s.j, s.k)) || DIRS.some(d => set.has(cellKey(s.i + d[0], s.j + d[1], s.k + d[2])));
  const here = stations.filter(inRoom);
  const missing: string[] = [];
  if (room.cells.length < MIN_CELLS) missing.push('more space');
  if (!room.cells.some(c => set.has(cellKey(c[0], c[1] + 1, c[2])))) missing.push('room to stand up');
  if (!here.some(s => s.t === 'bed')) missing.push('a bed');
  if (!here.some(s => s.t === 'torch' || s.t === 'camp' || s.t === 'lantern')) missing.push('a light');
  if (!here.some(s => s.t === 'bench')) missing.push('a workbench');
  return { ok: missing.length === 0, missing };
}

/** Cells a resident can stand on: free, with a wall below and headroom above. */
export function floorCells(room: Room, q: RoomQuery): Cell[] {
  return room.cells.filter(c => q.wall(c[0], c[1] - 1, c[2]) && !q.wall(c[0], c[1] + 1, c[2]));
}

/** Cells next to a bed where a room search can start. */
export function startsNear(s: StationRef, q: RoomQuery): Cell[] {
  return DIRS.map(d => [s.i + d[0], s.j + d[1], s.k + d[2]] as Cell).filter(c => !q.wall(c[0], c[1], c[2]));
}

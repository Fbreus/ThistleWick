import { describe, expect, it } from 'vitest';
import { cellHistory, compact, decode, encode, fromEdits, replay, summarize, type WorldEvent } from '../src/systems/chronicle';

const ev = (day: number, cause: WorldEvent['cause'], i: number, j: number, k: number, id: number): WorldEvent => ({ day, cause, i, j, k, id });

describe('chronicle', () => {
  const log = [ev(1, 'dug', 0, 5, 0, 0), ev(1, 'placed', 1, 5, 0, 3), ev(2, 'placed', 0, 5, 0, 15), ev(3, 'flooded', 2, 4, 0, 12)];

  it('round-trips through the packed save form', () => {
    expect(decode(encode(log))).toEqual(log);
  });
  it('survives a truncated or damaged tail without losing the rest', () => {
    const flat = encode(log);
    expect(decode(flat.slice(0, flat.length - 2))).toEqual(log.slice(0, 3));
    expect(decode([...flat, NaN, 1, 2, 3, 4, 5])).toEqual(log);
    expect(decode([1, 99, 0, 0, 0, 3])).toEqual([ev(1, 'legacy', 0, 0, 0, 3)]);
    expect(decode('nonsense')).toEqual([]);
  });
  it('replays to the latest state of each cell', () => {
    const w = replay(log);
    expect(w.size).toBe(3);
    expect(w.get('0,5,0')!.id).toBe(15);
  });
  it('keeps the history of a cell, oldest first', () => {
    expect(cellHistory(log, 0, 5, 0).map(e => e.cause)).toEqual(['dug', 'placed']);
    expect(cellHistory(log, 9, 9, 9)).toEqual([]);
  });
  it('turns an old edit list into legacy events with the same final state', () => {
    const events = fromEdits([0, 5, 0, 0, 1, 5, 0, 3]);
    expect(events).toEqual([ev(0, 'legacy', 0, 5, 0, 0), ev(0, 'legacy', 1, 5, 0, 3)]);
    expect(fromEdits([1, 2, 3])).toEqual([]);
  });

  describe('compaction', () => {
    it('drops only overwritten events, so the replayed world is unchanged', () => {
      const before = replay(log);
      const small = compact(log, 3);
      expect(small).toHaveLength(3);
      expect(small.find(e => e.i === 0 && e.cause === 'dug')).toBeUndefined();
      expect(replay(small).get('0,5,0')!.id).toBe(15);
      expect(replay(small).size).toBe(before.size);
    });
    it('never drops an event that still defines a cell', () => {
      const many = Array.from({ length: 50 }, (_, n) => ev(1, 'placed', n, 0, 0, 3));
      expect(compact(many, 10)).toHaveLength(50);
    });
    it('leaves a short log alone', () => {
      expect(compact(log, 100)).toBe(log);
    });
    it('trims heavily rewritten cells first, oldest overwrites first', () => {
      const churn = [ev(1, 'placed', 0, 0, 0, 3), ev(2, 'dug', 0, 0, 0, 0), ev(3, 'placed', 0, 0, 0, 15), ev(4, 'placed', 5, 0, 0, 3)];
      const out = compact(churn, 3);
      expect(out.map(e => e.day)).toEqual([2, 3, 4]);
    });
  });

  it('counts what the player changed and ignores legacy events', () => {
    const c = summarize([ev(0, 'legacy', 0, 0, 0, 3), ...log]);
    expect(c).toEqual({ dug: 1, placed: 2, flooded: 1, built: 0 });
    expect(summarize(log, 2)).toEqual({ dug: 0, placed: 1, flooded: 1, built: 0 });
  });
});

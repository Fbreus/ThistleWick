import { describe, expect, it } from 'vitest';
import { createStore, localBackend, type Backend, type Stamped } from '../src/storage';

const memory = (name = 'mem', opts: { failWrite?: boolean; failRead?: boolean; hangRead?: boolean } = {}) => {
  let cell: Stamped | null = null;
  const b: Backend & { cell: () => Stamped | null; set: (s: Stamped | null) => void } = {
    name,
    read: () => opts.hangRead ? new Promise(() => undefined) : opts.failRead ? Promise.reject(new Error('read')) : Promise.resolve(cell),
    write: s => { if (opts.failWrite) return Promise.reject(new Error('quota')); cell = s; return Promise.resolve(); },
    remove: () => { cell = null; return Promise.resolve(); },
    cell: () => cell, set: s => { cell = s; }
  };
  return b;
};
const clock = () => { let t = 1000; return () => ++t; };

describe('save store', () => {
  it('writes to every backend and reads the text back', async () => {
    const a = memory('a'), b = memory('b'), store = createStore([a, b], { now: clock() });
    expect(await store.save('{"v":4}')).toBe(true);
    expect(a.cell()!.text).toBe('{"v":4}');
    expect(b.cell()!.text).toBe('{"v":4}');
    expect(await store.load()).toBe('{"v":4}');
  });
  it('loads the newest copy when the backends disagree', async () => {
    const a = memory('a'), b = memory('b');
    a.set({ text: 'old', savedAt: 1 }); b.set({ text: 'new', savedAt: 2 });
    expect(await createStore([a, b]).load()).toBe('new');
    expect(await createStore([b, a]).load()).toBe('new');
  });
  it('keeps saving when one backend is full', async () => {
    const full = memory('ls', { failWrite: true }), big = memory('idb'), store = createStore([full, big], { now: clock() });
    expect(await store.save('world')).toBe(true);
    expect(await store.load()).toBe('world');
  });
  it('reports failure only when every backend refused', async () => {
    const store = createStore([memory('a', { failWrite: true }), memory('b', { failWrite: true })]);
    expect(await store.save('x')).toBe(false);
  });
  it('survives a backend that cannot read or never answers', async () => {
    const good = memory('good');
    good.set({ text: 'kept', savedAt: 5 });
    const store = createStore([memory('bad', { failRead: true }), memory('slow', { hangRead: true }), good], { timeoutMs: 20 });
    expect(await store.load()).toBe('kept');
  });
  it('returns null when there is nothing saved', async () => {
    expect(await createStore([memory(), memory()]).load()).toBeNull();
  });
  it('clears every backend', async () => {
    const a = memory('a'), b = memory('b'), store = createStore([a, b]);
    await store.save('x'); await store.clear();
    expect(a.cell()).toBeNull(); expect(b.cell()).toBeNull();
    expect(await store.load()).toBeNull();
  });
  it('starts the write synchronously so a closing page still saves', () => {
    const a = memory('a'), store = createStore([a], { now: clock() });
    void store.save('sync');
    expect(a.cell()!.text).toBe('sync');
  });
});

describe('local backend', () => {
  const fake = (limit = Infinity) => {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => { m.delete(k); },
      setItem: (k: string, v: string) => { const used = [...m].reduce((n, [key, val]) => key === k ? n : n + val.length, 0); if (used + v.length > limit) throw new Error('QuotaExceededError'); m.set(k, v); } };
  };

  it('reads a save from before timestamps existed', async () => {
    const s = fake(); s.m.set('save', '{"v":2}');
    expect(await localBackend('save', s).read()).toEqual({ text: '{"v":2}', savedAt: 0 });
  });
  it('stores payload and timestamp under separate keys', async () => {
    const s = fake(), b = localBackend('save', s);
    await b.write({ text: 'abc', savedAt: 42 });
    expect(s.m.get('save')).toBe('abc');
    expect(await b.read()).toEqual({ text: 'abc', savedAt: 42 });
  });
  it('removes a stale copy when the new one does not fit, so IndexedDB wins', async () => {
    const s = fake(20), ls = localBackend('save', s), other = memory('idb'), store = createStore([ls, other], { now: clock() });
    await store.save('small');
    expect(s.m.get('save')).toBe('small');
    const big = 'x'.repeat(100);
    expect(await store.save(big)).toBe(true);
    expect(s.m.has('save')).toBe(false);
    expect(await store.load()).toBe(big);
  });
});

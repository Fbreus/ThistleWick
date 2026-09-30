import { describe, expect, it } from 'vitest';
import { ARCS, arcComplete, arcProgress, completedBy, createProgress, nextStep, record } from '../src/systems/journal';
import { logCounts, logEntries, discoveryName } from '../src/systems/discoveries';
import { dawnLines, landLine, newTally, tallyAdd } from '../src/systems/dawn';
import { inferProgress, migrateSave } from '../src/save';
import { BDEF, ITEMS, RECIPES } from '../src/items';
import { RESIDENTS } from '../src/systems/dialogue';

describe('journal', () => {
  it('every step key refers to something the game can actually produce', () => {
    const outs = new Set(RECIPES.map(r => r.out));
    const special = new Set(['slept', 'cave', 'cottage']);
    for (const arc of ARCS) for (const s of arc.steps) {
      if (special.has(s.key)) continue;
      const [kind, id] = s.key.split(':');
      if (kind === 'got') expect(ITEMS[id], s.key).toBeDefined();
      else if (kind === 'craft') expect(outs.has(id), s.key).toBe(true);
      else if (kind === 'place') expect(BDEF[id], s.key).toBeDefined();
      else if (kind === 'kill') expect(['beetle', 'hare', 'elder']).toContain(id);
      else if (kind === 'resident' || kind === 'talk' || kind === 'gift') expect(RESIDENTS[id], s.key).toBeDefined();
      else throw new Error('unknown key kind ' + s.key);
    }
  });

  it('step ids are unique within an arc and keys are unique overall', () => {
    const keys = ARCS.flatMap(a => a.steps.map(s => s.key));
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of ARCS) expect(new Set(a.steps.map(s => s.id)).size).toBe(a.steps.length);
  });

  it('starts at the first step and advances as keys are recorded', () => {
    const p = createProgress();
    expect(nextStep(p)?.step.key).toBe('got:wood');
    expect(record(p, 'got:wood')).toBe(true);
    expect(record(p, 'got:wood')).toBe(false);
    expect(nextStep(p)?.step.key).toBe('craft:workbench');
  });

  it('steps done out of order still count, and the next step skips them', () => {
    const p = createProgress(['craft:wpick']);
    expect(arcProgress(p, ARCS[0]).done).toBe(1);
    expect(nextStep(p)?.step.key).toBe('got:wood');
  });

  it('reports arc completion on the last step and moves on to the next arc', () => {
    const p = createProgress(ARCS[0].steps.map(s => s.key).filter(k => k !== 'slept'));
    record(p, 'slept');
    const done = completedBy(p, 'slept');
    expect(done.arcs.map(a => a.id)).toEqual(['hearth']);
    expect(arcComplete(p, ARCS[0])).toBe(true);
    expect(nextStep(p)?.arc.id).toBe('garden');
  });

  it('returns null when everything is done', () => {
    expect(nextStep(createProgress(ARCS.flatMap(a => a.steps.map(s => s.key))))).toBeNull();
  });
});

describe('collection log', () => {
  it('lists every item, biome, the caves and the creatures with unique keys', () => {
    const e = logEntries();
    expect(new Set(e.map(x => x.key)).size).toBe(e.length);
    expect(e.filter(x => x.section === 'items').length).toBe(Object.keys(ITEMS).length);
  });
  it('counts found entries and names discoveries', () => {
    const p = createProgress(['got:wood', 'biome:1', 'not-a-log-key']);
    expect(logCounts(p).found).toBe(2);
    expect(discoveryName('got:wood')).toBe('Wood');
    expect(discoveryName('slept')).toBeNull();
  });
});

describe('dawn summary', () => {
  it('summarises the day and points at the next goal', () => {
    const t = newTally();
    tallyAdd(t, 'gathered', 'wood', 6); tallyAdd(t, 'crafted', 'workbench', 1); t.kills = 2; t.discoveries.push('Wood');
    const lines = dawnLines(t, 2, 'Craft a stone pickaxe');
    expect(lines[0]).toBe('Day 2 begins');
    expect(lines).toContain('Gathered 6 wood');
    expect(lines).toContain('Made workbench');
    expect(lines).toContain('Sent 2 beetles back into the dark');
    expect(lines[lines.length - 1]).toBe('Today: Craft a stone pickaxe');
  });
  it('still says something on a quiet day and when all goals are done', () => {
    const lines = dawnLines(newTally(), 5, null);
    expect(lines[1]).toMatch(/quiet day/);
    expect(lines[2]).toMatch(/forest is yours/);
  });
});

describe('dawn land line', () => {
  it('summarises digging and placing and ignores flooding', () => {
    expect(landLine({ dug: 14, placed: 6, flooded: 200, built: 0 })).toBe('Dug 14 blocks, placed 6');
    expect(landLine({ dug: 1, placed: 0, flooded: 0, built: 0 })).toBe('Dug 1 block');
    expect(landLine({ dug: 0, placed: 2, flooded: 0, built: 3 })).toBe('Placed 5');
    expect(landLine({ dug: 0, placed: 0, flooded: 9, built: 0 })).toBeNull();
  });
  it('appears on the dawn card before the news', () => {
    const lines = dawnLines(newTally(), 3, null, undefined, { dug: 4, placed: 0, flooded: 0, built: 0 });
    expect(lines[1]).toBe('Dug 4 blocks');
  });
});

describe('save migration', () => {
  const v1 = {
    v: 1, P: { x: 0, y: 5, z: 3, hp: 100, hunger: 80, stamina: 100, heading: 0, spawnX: 0, spawnZ: 3 }, todT: 40, sel: 0,
    inv: [['wood', 5, undefined], null, ['wpick', 1, 40]], tips: {}, edits: [], stations: [['bench', 1, 2, 3], ['bed', 4, 2, 3]], collected: [], dead: []
  };
  it('upgrades v1 and infers progress from what the player already has', () => {
    const s = migrateSave(v1)!;
    expect(s.v).toBe(5);
    expect(s.worldSeed).toBe(0);
    expect(s.genVersion).toBe(1);
    expect(s.journal).toEqual(expect.arrayContaining(['got:wood', 'got:wpick', 'place:bench', 'place:bed', 'craft:bed']));
    expect(s.story.enabled).toBe(false);
    expect(inferProgress(v1 as never)).toEqual(s.journal);
  });
  it('upgrades v2 to the original world and v3 keeps its seed', () => {
    const v2 = { ...v1, v: 2, journal: ['got:wood'] };
    const up2 = migrateSave(v2)!;
    expect(up2).toMatchObject({ v: 5, worldSeed: 0, genVersion: 1, journal: ['got:wood'], story: { enabled: false } });
    const v3 = { ...v1, v: 3, journal: ['got:wood'], worldSeed: 12345, genVersion: 2 };
    expect(migrateSave(v3)).toMatchObject({ v: 5, worldSeed: 12345, genVersion: 2, story: { enabled: false } });
  });
  it('turns the old edit list into legacy chronicle events and drops the list', () => {
    const s = migrateSave({ ...v1, v: 3, journal: [], worldSeed: 1, genVersion: 2, edits: [0, 5, 0, 0, 1, 5, 0, 3] })!;
    expect(s.events).toEqual([0, 0, 0, 5, 0, 0, 0, 0, 1, 5, 0, 3]);
    expect('edits' in s).toBe(false);
  });
  it('upgrades v4 with disabled story state and passes v5 through', () => {
    const { edits, ...rest } = v1;
    const v4 = { ...rest, v: 4, journal: ['got:wood'], worldSeed: 9, genVersion: 2, events: [3, 1, 0, 5, 0, 0] };
    const up = migrateSave(v4)!;
    expect(up).toMatchObject({ ...v4, v: 5, story: { enabled: false, active: {}, completed: [] } });
    expect(migrateSave({ ...v4, events: undefined })).toBeNull();
    expect(migrateSave(up)).toEqual(up);
  });
  it('rejects junk and worlds from a newer generator', () => {
    const v3 = { ...v1, v: 3, journal: [], worldSeed: 7, genVersion: 2 };
    expect(migrateSave(null)).toBeNull();
    expect(migrateSave({ v: 5 })).toBeNull();
    expect(migrateSave({ ...v1, v: 2 })).toBeNull();
    expect(migrateSave({ ...v3, genVersion: 99 })).toBeNull();
    expect(migrateSave({ ...v3, genVersion: 0 })).toBeNull();
    expect(migrateSave({ ...v3, worldSeed: undefined })).toBeNull();
    expect(migrateSave({ ...v3, v: 4, events: [], edits: undefined, genVersion: 99 })).toBeNull();
  });
});

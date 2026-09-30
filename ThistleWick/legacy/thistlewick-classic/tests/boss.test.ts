import { describe, expect, it } from 'vitest';
import { CHARGE_TIME, RECOVER, RECOVER_DAMAGE_MULT, SLAM_RADIUS, WINDUP, damageMult, newBoss, shouldSpawn, speedOf, stepBoss, type BossState } from '../src/systems/boss';
import { ARCS } from '../src/systems/journal';
import { ITEMS, RECIPES } from '../src/items';

const run = (s: BossState, seconds: number, dist: number, hp = 1, dt = 0.05) => {
  let hits = 0;
  for (let t = 0; t < seconds; t += dt) if (stepBoss(s, dt, dist, hp).hit) hits++;
  return hits;
};

describe('when the Elder Beetle wakes', () => {
  const base = { day: 3, night: 0.9, underground: false, bossOut: false, lastBossDay: 0, defeated: false };
  it('wakes on the third night on the surface', () => {
    expect(shouldSpawn(base)).toBe(true);
    expect(shouldSpawn({ ...base, day: 2 })).toBe(false);
    expect(shouldSpawn({ ...base, night: 0.3 })).toBe(false);
    expect(shouldSpawn({ ...base, underground: true })).toBe(false);
  });
  it('only once per night and never two at a time', () => {
    expect(shouldSpawn({ ...base, lastBossDay: 3 })).toBe(false);
    expect(shouldSpawn({ ...base, bossOut: true })).toBe(false);
    expect(shouldSpawn({ ...base, day: 4, lastBossDay: 3 })).toBe(true);
    expect(shouldSpawn({ ...base, defeated: true })).toBe(false);
  });
});

describe('attack pattern', () => {
  it('walks up, telegraphs, then slams once when the player is close', () => {
    const s = newBoss();
    stepBoss(s, 0.05, 2, 1);
    expect(s.phase).toBe('windup');
    expect(run(s, WINDUP + 0.2, 2)).toBe(1);
    expect(s.phase).toBe('recover');
  });
  it('a slam misses a player who stepped back out of range during the windup', () => {
    const s = newBoss();
    stepBoss(s, 0.05, 2, 1);
    expect(run(s, WINDUP + 0.2, SLAM_RADIUS + 1)).toBe(0);
  });
  it('is vulnerable while recovering, then goes back to stalking', () => {
    const s = newBoss();
    stepBoss(s, 0.05, 2, 1); run(s, WINDUP + 0.2, 2);
    expect(damageMult(s)).toBe(RECOVER_DAMAGE_MULT);
    expect(speedOf(s)).toBe(0);
    run(s, RECOVER + 0.2, 20);
    expect(s.phase).toBe('stalk');
    expect(damageMult(s)).toBe(1);
  });
  it('stays put while winding up so the telegraph is fair', () => {
    const s = newBoss();
    stepBoss(s, 0.05, 2, 1);
    expect(speedOf(s)).toBe(0);
  });
});

describe('enraged phase', () => {
  it('enrages below half health, stalks faster and never calms down', () => {
    const s = newBoss();
    const calm = speedOf(s);
    stepBoss(s, 0.05, 30, 0.4);
    expect(s.enraged).toBe(true);
    expect(speedOf(s)).toBeGreaterThan(calm);
    stepBoss(s, 0.05, 30, 1);
    expect(s.enraged).toBe(true);
  });
  it('charges from a distance once the cooldown is over, and hits at most once', () => {
    const s = newBoss(); s.enraged = true; s.chargeCd = 0;
    stepBoss(s, 0.05, 10, 0.3);
    expect(s.phase).toBe('windup');
    expect(s.next).toBe('charge');
    let hits = 0;
    for (let t = 0; t < WINDUP + CHARGE_TIME + 0.3; t += 0.05) if (stepBoss(s, 0.05, 1.5, 0.3).hit) hits++;
    expect(hits).toBe(1);
    expect(s.chargeCd).toBeGreaterThan(0);
  });
  it('a calm boss never charges', () => {
    const s = newBoss(); s.chargeCd = 0;
    stepBoss(s, 0.05, 10, 1);
    expect(s.phase).toBe('stalk');
  });
});

describe('boss content', () => {
  it('drops an Elder carapace that gates a shield only the boss can supply', () => {
    expect(ITEMS.eshell).toBeDefined();
    const shield = RECIPES.find(r => r.out === 'eshield')!;
    expect(shield.in.eshell).toBeGreaterThan(0);
    expect(ITEMS.eshield.reduce!).toBeGreaterThan(ITEMS.cshield.reduce!);
    expect(RECIPES.some(r => r.in.eshell && r.out !== 'eshield' && !ITEMS[r.out])).toBe(false);
  });
  it('the Deep arc asks the player to face it and craft the shield', () => {
    const keys = ARCS.find(a => a.id === 'deep')!.steps.map(s => s.key);
    expect(keys).toEqual(expect.arrayContaining(['kill:elder', 'craft:eshield']));
  });
});

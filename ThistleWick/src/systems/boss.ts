/** The Elder Beetle: when it wakes and how its attack pattern runs. Pure, so it can be tested without the game. */

export type Phase = 'stalk' | 'windup' | 'slam' | 'charge' | 'recover';
export interface BossState { phase: Phase; t: number; next: 'slam' | 'charge'; enraged: boolean; chargeCd: number; hitDone: boolean }

export const BOSS_NAME = 'Elder Beetle';
export const BOSS_HP = 240, BOSS_DAMAGE = 22, BOSS_SCALE = 3.1;
export const FIRST_NIGHT = 3;
export const WINDUP = 1.1, RECOVER = 1.7, CHARGE_TIME = 0.85, SLAM_RADIUS = 3.6, CHARGE_HIT_RADIUS = 2.6, CHARGE_COOLDOWN = 6;
export const STALK_SPEED = 2.5, ENRAGED_STALK_SPEED = 3.5, CHARGE_SPEED = 9;
/** Fraction of health at which the boss enrages and starts charging. */
export const ENRAGE_AT = 0.5;
/** Extra damage taken while it is recovering from an attack: the window to strike. */
export const RECOVER_DAMAGE_MULT = 1.6;

export const newBoss = (): BossState => ({ phase: 'stalk', t: 0, next: 'slam', enraged: false, chargeCd: 3, hitDone: false });

/** It wakes at night from the third day on, on the surface, once per night, never while one is already out, and never again once beaten. */
export function shouldSpawn(o: { day: number; night: number; underground: boolean; bossOut: boolean; lastBossDay: number; defeated: boolean }): boolean {
  return !o.defeated && o.day >= FIRST_NIGHT && o.night > 0.5 && !o.underground && !o.bossOut && o.lastBossDay !== o.day;
}

export const damageMult = (s: BossState) => (s.phase === 'recover' ? RECOVER_DAMAGE_MULT : 1);
export const speedOf = (s: BossState) => (s.phase === 'stalk' ? (s.enraged ? ENRAGED_STALK_SPEED : STALK_SPEED) : s.phase === 'charge' ? CHARGE_SPEED : 0);

/** Advances the pattern by `dt`. `hit` is true on the single frame an attack lands in range, so the caller applies damage once. */
export function stepBoss(s: BossState, dt: number, dist: number, hpFrac: number): { hit: boolean } {
  if (hpFrac < ENRAGE_AT) s.enraged = true;
  s.t += dt; s.chargeCd = Math.max(0, s.chargeCd - dt);
  let hit = false;
  switch (s.phase) {
    case 'stalk':
      if (dist < SLAM_RADIUS - 0.4) { s.phase = 'windup'; s.t = 0; s.next = 'slam'; }
      else if (s.enraged && s.chargeCd <= 0 && dist > 5 && dist < 16) { s.phase = 'windup'; s.t = 0; s.next = 'charge'; }
      break;
    case 'windup':
      if (s.t >= WINDUP) { s.phase = s.next; s.t = 0; s.hitDone = false; }
      break;
    case 'slam':
      hit = dist < SLAM_RADIUS; s.phase = 'recover'; s.t = 0;
      break;
    case 'charge':
      if (!s.hitDone && dist < CHARGE_HIT_RADIUS) { s.hitDone = true; hit = true; }
      if (s.t >= CHARGE_TIME) { s.phase = 'recover'; s.t = 0; s.chargeCd = CHARGE_COOLDOWN; }
      break;
    case 'recover':
      if (s.t >= RECOVER) { s.phase = 'stalk'; s.t = 0; }
      break;
  }
  return { hit };
}

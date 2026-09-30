/** Residents: who they are, what they like, how friendship grows and which line they say. Pure, so it can be tested.
 *  `candidateLines` is deliberately separate from `pickLine`: it is the list a smarter chooser can later pick from. */

export interface ResidentDef {
  id: string; name: string; title: string;
  likes: string[]; loves: string[]; dislikes: string[];
  /** Items handed over once a day, per friendship tier reached (tier 2 and up). */
  presents: Record<number, Record<string, number>>;
  lines: Line[];
  reactions: { love: string; like: string; neutral: string; dislike: string; already: string };
}
export interface Friend { friendship: number; lastTalkDay: number; lastGiftDay: number; lastPresentDay: number; lastLine: string }
export interface Ctx { day: number; night: boolean; tier: number; flags: ReadonlySet<string> }
export interface Line { id: string; text: string; when?: (c: Ctx) => boolean }

export const newFriend = (): Friend => ({ friendship: 0, lastTalkDay: -1, lastGiftDay: -1, lastPresentDay: -1, lastLine: '' });

/** 0 stranger, 1 acquaintance, 2 friend, 3 close friend. */
export const TIER_AT = [0, 3, 8, 15];
export const tierOf = (friendship: number) => TIER_AT.reduce((t, at, i) => (friendship >= at ? i : t), 0);
export const TIER_NAMES = ['Stranger', 'Acquaintance', 'Friend', 'Close friend'];

const BRAMBLE: ResidentDef = {
  id: 'bramble', name: 'Bramble', title: 'hedgehog tinkerer',
  likes: ['berries', 'mushroom', 'cmush', 'root', 'stick', 'plank'], loves: ['croot', 'crystal', 'coal', 'ingot'], dislikes: ['meat', 'cmeat', 'shell'],
  presents: { 2: { seed: 2 }, 3: { bandage: 2, coal: 3 } },
  reactions: {
    love: 'Oh! For me? This is exactly the sort of thing I like to put on a shelf and look at.',
    like: 'Ah, thank you. That will come in handy.',
    neutral: 'Hm. Kind of you. I will find something to do with it.',
    dislike: 'Oh. Oh no. I will... put it outside, if that is alright.',
    already: 'You have already given me something today. I am not used to so much kindness.'
  },
  lines: [
    { id: 'g0a', text: 'Hm? Oh. You are the one who built these walls. Good walls. Not a draught in them.', when: c => c.tier === 0 },
    { id: 'g0b', text: 'I fix things. Mostly things that were never broken.', when: c => c.tier === 0 },
    { id: 'night', text: 'The beetles come out at night. I stay in. You should too.', when: c => c.night },
    { id: 'day', text: 'Good light today. Good for tinkering.', when: c => !c.night },
    { id: 'garden', text: 'Thistle roots! Plant three, eat two. That is the old rule.', when: c => c.flags.has('place:crop') },
    { id: 'beetle', text: 'You smell of beetle. Stand downwind, friend.', when: c => c.flags.has('kill:beetle') && c.tier >= 1 },
    { id: 'crystal', text: 'A glow crystal, was it? Bring me one. Just to look at.', when: c => c.flags.has('got:crystal') },
    { id: 'rule-done', text: 'The old thistle rule worked. Whether that makes it wisdom or superstition, I could not say.', when: c => c.flags.has('quest:old-thistle-rule') },
    { id: 'borrowed-done', text: 'Crystals store morning. That is a beautiful fact, which is often the dangerous kind.', when: c => c.flags.has('quest:light-borrowed') },
    { id: 'stones-done', text: 'A Rootward Lantern is a promise: light enough for home, never more than the roots can spare.', when: c => c.flags.has('quest:listening-stones') },
    { id: 'door-done', text: 'A door that knocks back is still a door. Best keep the key somewhere polite.', when: c => c.flags.has('quest:door-without-house') },
    { id: 'ipick', text: 'An iron pickaxe. I could not have made a better one. I could have made it slower.', when: c => c.flags.has('craft:ipick') },
    { id: 't1a', text: 'Your hearth is warmer than my last three burrows put together.', when: c => c.tier >= 1 },
    { id: 't2a', text: 'Sit, if you like. The stool wobbles. It is a feature.', when: c => c.tier >= 2 },
    { id: 't3a', text: 'I do not say this to many. Thank you for the room. And the company.', when: c => c.tier >= 3 }
  ]
};

export const RESIDENTS: Record<string, ResidentDef> = { bramble: BRAMBLE };

/** Every line that fits right now. */
export function candidateLines(def: ResidentDef, ctx: Ctx): Line[] {
  const fit = def.lines.filter(l => !l.when || l.when(ctx));
  return fit.length ? fit : def.lines.slice(0, 1);
}

/** Picks one line, preferring one that was not said last time. `rand` is injectable for tests. */
export function pickLine(cands: Line[], lastLine: string, rand: () => number = Math.random): Line {
  const fresh = cands.filter(l => l.id !== lastLine);
  const pool = fresh.length ? fresh : cands;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

/** Talking once per day builds friendship. Returns whether a present is due (tier 2 and up, once a day). */
export function talk(f: Friend, day: number): { friend: Friend; gained: number; present: boolean } {
  const first = f.lastTalkDay !== day;
  const next: Friend = { ...f, lastTalkDay: day, friendship: f.friendship + (first ? 1 : 0) };
  const present = first && tierOf(next.friendship) >= 2 && f.lastPresentDay !== day;
  if (present) next.lastPresentDay = day;
  return { friend: next, gained: first ? 1 : 0, present };
}

export function presentFor(def: ResidentDef, friendship: number): Record<string, number> | null {
  const t = tierOf(friendship);
  for (let k = t; k >= 2; k--) if (def.presents[k]) return def.presents[k];
  return null;
}

export type GiftKind = 'love' | 'like' | 'neutral' | 'dislike';
export const giftKind = (def: ResidentDef, itemId: string): GiftKind => (def.loves.includes(itemId) ? 'love' : def.likes.includes(itemId) ? 'like' : def.dislikes.includes(itemId) ? 'dislike' : 'neutral');
const GIFT_DELTA: Record<GiftKind, number> = { love: 4, like: 2, neutral: 1, dislike: -1 };

/** One gift per day. A refused gift changes nothing. */
export function giveGift(def: ResidentDef, f: Friend, itemId: string, day: number): { friend: Friend; accepted: boolean; reaction: string; kind: GiftKind } {
  const kind = giftKind(def, itemId);
  if (f.lastGiftDay === day) return { friend: f, accepted: false, reaction: def.reactions.already, kind };
  return { friend: { ...f, lastGiftDay: day, friendship: Math.max(0, f.friendship + GIFT_DELTA[kind]) }, accepted: true, reaction: def.reactions[kind], kind };
}

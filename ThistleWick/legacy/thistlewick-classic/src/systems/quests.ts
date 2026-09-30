/** Story quests: definitions and pure progression rules. */

export type QuestStatus = 'locked' | 'available' | 'active' | 'complete';
export type QuestKind = 'main' | 'side';

export interface GameEvent { key: string; amount?: number; day?: number }
export interface ItemCost { id: string; count: number }
export interface ItemReward { id: string; count: number }
export interface ObjectiveDef { id: string; text: string; event: string; count?: number }
export interface ResidentCue {
  resident: string;
  text: string;
  action: string;
  event: string;
  items?: ItemCost[];
  after: string;
}
export interface Unlocks { lore?: string[]; keepsakes?: string[]; recipes?: string[]; items?: ItemReward[] }
export interface QuestStage {
  id: string;
  intro: string;
  objectives: ObjectiveDef[];
  residentCue?: ResidentCue;
  unlocks?: Unlocks;
}
export interface QuestDef {
  id: string;
  title: string;
  kind: QuestKind;
  giver?: string;
  summary: string;
  offer: string;
  accepted: string;
  requires?: { quests?: string[]; flags?: string[] };
  stages: QuestStage[];
  rewards?: Unlocks;
  completeText: string;
}
export interface ActiveQuest { stage: number; counts: Record<string, number>; startedDay: number }
export interface QuestState {
  enabled: boolean;
  active: Record<string, ActiveQuest>;
  completed: string[];
  tracked: string | null;
  lore: string[];
  keepsakes: string[];
  recipes: string[];
}
export interface QuestUpdate {
  questId: string;
  stageCompleted: boolean;
  questCompleted: boolean;
  intro: string | null;
  rewards: ItemReward[];
}
export interface ConversationCue {
  kind: 'offer' | 'stage';
  quest: QuestDef;
  text: string;
  action: string;
  event?: string;
  items?: ItemCost[];
  after: string;
}

const HOME_FLAGS = ['craft:door', 'place:door', 'cottage', 'resident:bramble', 'talk:bramble', 'gift:bramble'];

export const QUESTS: QuestDef[] = [
  {
    id: 'old-thistle-rule', title: 'The Old Thistle Rule', kind: 'main', giver: 'bramble',
    summary: 'Follow the old rule exactly and see what Bramble remembers.',
    offer: 'Thistle roots. Plant three, eat two, leave one for those below. That was the rule before folk forgot why. Will you try it properly?',
    accepted: 'Good. Old rules are like old tools. Best test them before throwing them away.',
    requires: { flags: HOME_FLAGS },
    stages: [
      { id: 'plant', intro: 'Plant three thistles after accepting the old rule.', objectives: [{ id: 'plant', text: 'Plant three thistles', event: 'place:crop', count: 3 }] },
      { id: 'eat', intro: 'The second part of the rule was meant literally.', objectives: [{ id: 'eat', text: 'Roast and eat two thistle roots', event: 'eat:croot', count: 2 }] },
      {
        id: 'leave', intro: 'Keep one uncooked root for Bramble.', objectives: [{ id: 'root', text: 'Give Bramble one raw thistle root', event: 'quest:handin:root' }],
        residentCue: { resident: 'bramble', text: 'Three planted and two eaten? Then one remains. Let me see the root you kept.', action: 'Hand over 1 thistle root', event: 'quest:handin:root', items: [{ id: 'root', count: 1 }], after: 'There. The root curls downward. The old folk said that meant someone below was listening.' }
      }
    ],
    rewards: { lore: ['old-thistle-rule'], items: [{ id: 'seed', count: 3 }] },
    completeText: 'Bramble has remembered the complete Old Thistle Rule.'
  },
  {
    id: 'light-borrowed', title: 'A Light Borrowed', kind: 'main', giver: 'bramble',
    summary: 'Help Bramble examine a glow crystal without treating it as ordinary fuel.',
    offer: 'You found the caves, then. If you bring me one glow crystal, I can test an old suspicion. I promise not to fix it.',
    accepted: 'Handle it gently. A glow crystal has had a much longer morning than either of us.',
    requires: { quests: ['old-thistle-rule'], flags: ['cave'] },
    stages: [
      {
        id: 'crystal', intro: 'Bring a glow crystal to Bramble.', objectives: [{ id: 'crystal', text: 'Give Bramble one glow crystal', event: 'quest:handin:crystal' }],
        residentCue: { resident: 'bramble', text: 'That crystal is warm on the sunrise side. May I?', action: 'Hand over 1 glow crystal', event: 'quest:handin:crystal', items: [{ id: 'crystal', count: 1 }], after: 'Just as I feared. It stores morning. It does not make light at all.' }
      },
      {
        id: 'frame', intro: 'Bramble needs a shell and iron to make a listening lens.', objectives: [
          { id: 'shell', text: 'Give Bramble one beetle shell and one iron ingot', event: 'quest:handin:lens-parts' }
        ],
        residentCue: { resident: 'bramble', text: 'Beetle shell carries darkness away. Iron holds its shape. With one of each, I can make the crystal safe to listen through.', action: 'Hand over shell and ingot', event: 'quest:handin:lens-parts', items: [{ id: 'shell', count: 1 }, { id: 'ingot', count: 1 }], after: 'A Listening Lens. Never point it at noon, and never lick the iron. Both lessons were expensive.' }
      }
    ],
    rewards: { lore: ['dawnstone'], keepsakes: ['listening-lens'] },
    completeText: 'The Listening Lens is ready to carry to the old stones.'
  },
  {
    id: 'listening-stones', title: 'The Listening Stones', kind: 'main', giver: 'bramble',
    summary: 'Carry Bramble\'s lens to the old meadow stones and listen to what they remember.',
    offer: 'The lens is humming toward an old circle in the meadow. Three stones, if the moss has not swallowed them. Listen to each one and come back.',
    accepted: 'Follow the hum. The stones are patient, but they have never been good at giving directions.',
    requires: { quests: ['light-borrowed'] },
    stages: [
      { id: 'listen', intro: 'Find the meadow circle and attune all three stones.', objectives: [
        { id: 'north', text: 'Listen to the first standing stone', event: 'site:listening:north' },
        { id: 'east', text: 'Listen to the second standing stone', event: 'site:listening:east' },
        { id: 'west', text: 'Listen to the third standing stone', event: 'site:listening:west' }
      ] },
      {
        id: 'return', intro: 'Tell Bramble what the stones said.', objectives: [{ id: 'return', text: 'Return to Bramble', event: 'quest:return:listening' }],
        residentCue: { resident: 'bramble', text: 'You heard three voices, did you? Tell me the words they shared.', action: 'Repeat the warning', event: 'quest:return:listening', after: 'Do not take light from beneath the roots. Hm. That sounds less like superstition than I hoped.' }
      },
      {
        id: 'lantern', intro: 'Build a safer light from what Bramble learned.', unlocks: { recipes: ['lantern'] }, objectives: [
          { id: 'craft', text: 'Craft a Rootward Lantern', event: 'craft:lantern' },
          { id: 'place', text: 'Place the Rootward Lantern', event: 'place:lantern' }
        ]
      }
    ],
    rewards: { lore: ['listening-stones', 'first-hearth'] },
    completeText: 'A safer light now burns above the roots.'
  },
  {
    id: 'door-without-house', title: 'The Door Without a House', kind: 'side', giver: 'bramble',
    summary: 'Repair a lonely forest door and return after the land has slept.',
    offer: 'There is a door in the forest with no house around it. I used to avoid it. Lately I have wondered whether it was waiting for someone less sensible.',
    accepted: 'Four planks should settle its frame. If it knocks back, be polite.',
    requires: { quests: ['old-thistle-rule'] },
    stages: [
      { id: 'find', intro: 'Find the ruined door in the autumn forest.', objectives: [{ id: 'find', text: 'Reach the Door Without a House', event: 'site:door:found' }] },
      { id: 'repair', intro: 'Repair the old frame with four planks.', objectives: [{ id: 'repair', text: 'Repair the door with four planks', event: 'site:door:repair' }] },
      { id: 'wait', intro: 'Let the repaired door stand through one night.', objectives: [{ id: 'sleep', text: 'Sleep once after repairing the door', event: 'slept' }] },
      { id: 'knock', intro: 'Return to the door and knock.', objectives: [{ id: 'knock', text: 'Knock on the repaired door', event: 'site:door:knock' }] }
    ],
    rewards: { lore: ['door-without-house'], keepsakes: ['old-hearth-key'], items: [{ id: 'coal', count: 2 }] },
    completeText: 'Something answered from the other side, and an old key remained in the latch.'
  }
];

export const questById = (id: string) => QUESTS.find(quest => quest.id === id) ?? null;
export const createQuestState = (enabled = true): QuestState => ({ enabled, active: {}, completed: [], tracked: null, lore: [], keepsakes: [], recipes: [] });

const addUnique = (to: string[], values: readonly string[] = []) => { for (const value of values) if (!to.includes(value)) to.push(value); };
const requirementsMet = (quest: QuestDef, state: QuestState, flags: ReadonlySet<string>) =>
  (quest.requires?.quests ?? []).every(id => state.completed.includes(id)) && (quest.requires?.flags ?? []).every(flag => flags.has(flag));

export function questStatus(quest: QuestDef, state: QuestState, flags: ReadonlySet<string>): QuestStatus {
  if (state.completed.includes(quest.id)) return 'complete';
  if (state.active[quest.id]) return 'active';
  return state.enabled && requirementsMet(quest, state, flags) ? 'available' : 'locked';
}

export const availableQuests = (state: QuestState, flags: ReadonlySet<string>) => QUESTS.filter(quest => questStatus(quest, state, flags) === 'available');
export const currentStage = (state: QuestState, questId: string) => {
  const active = state.active[questId], quest = questById(questId);
  return active && quest ? quest.stages[active.stage] ?? null : null;
};
export const objectiveDone = (active: ActiveQuest, objective: ObjectiveDef) => (active.counts[objective.id] ?? 0) >= (objective.count ?? 1);
export const currentObjectives = (state: QuestState, questId: string) => {
  const active = state.active[questId], stage = currentStage(state, questId);
  return active && stage ? stage.objectives.map(objective => ({ objective, done: objectiveDone(active, objective), value: active.counts[objective.id] ?? 0 })) : [];
};

function applyUnlocks(state: QuestState, unlocks: Unlocks | undefined): ItemReward[] {
  if (!unlocks) return [];
  addUnique(state.lore, unlocks.lore); addUnique(state.keepsakes, unlocks.keepsakes); addUnique(state.recipes, unlocks.recipes);
  return [...(unlocks.items ?? [])];
}

export function acceptQuest(state: QuestState, questId: string, day: number, flags: ReadonlySet<string>): boolean {
  const quest = questById(questId);
  if (!quest || questStatus(quest, state, flags) !== 'available') return false;
  state.active[questId] = { stage: 0, counts: {}, startedDay: day };
  state.tracked = questId;
  applyUnlocks(state, quest.stages[0].unlocks);
  return true;
}

export function recordQuestEvent(state: QuestState, event: GameEvent): QuestUpdate[] {
  const updates: QuestUpdate[] = [];
  for (const [questId, active] of Object.entries(state.active)) {
    const quest = questById(questId), stage = quest?.stages[active.stage];
    if (!quest || !stage) continue;
    let matched = false;
    for (const objective of stage.objectives) if (objective.event === event.key && !objectiveDone(active, objective)) {
      active.counts[objective.id] = Math.min(objective.count ?? 1, (active.counts[objective.id] ?? 0) + Math.max(1, event.amount ?? 1));
      matched = true;
    }
    if (!matched || !stage.objectives.every(objective => objectiveDone(active, objective))) continue;
    let rewards: ItemReward[] = [];
    active.stage++; active.counts = {};
    const complete = active.stage >= quest.stages.length;
    let intro: string | null = null;
    if (complete) {
      delete state.active[questId]; addUnique(state.completed, [questId]); rewards = applyUnlocks(state, quest.rewards);
      if (state.tracked === questId) state.tracked = Object.keys(state.active)[0] ?? null;
    } else {
      const next = quest.stages[active.stage]; intro = next.intro; rewards = applyUnlocks(state, next.unlocks);
    }
    updates.push({ questId, stageCompleted: true, questCompleted: complete, intro, rewards });
  }
  return updates;
}

export function residentConversation(state: QuestState, flags: ReadonlySet<string>, resident: string): ConversationCue | null {
  for (const kind of ['main', 'side'] as const) {
    for (const quest of QUESTS.filter(q => q.kind === kind)) {
      const cue = currentStage(state, quest.id)?.residentCue;
      if (cue?.resident === resident) return { kind: 'stage', quest, text: cue.text, action: cue.action, event: cue.event, items: cue.items, after: cue.after };
    }
    const offered = availableQuests(state, flags).find(quest => quest.kind === kind && quest.giver === resident);
    if (offered) return { kind: 'offer', quest: offered, text: offered.offer, action: 'Accept quest', after: offered.accepted };
  }
  return null;
}

export function normalizeQuestState(raw: unknown, enabledFallback = false): QuestState {
  if (!raw || typeof raw !== 'object') return createQuestState(enabledFallback);
  const value = raw as Partial<QuestState>;
  const active: Record<string, ActiveQuest> = {};
  if (value.active && typeof value.active === 'object') for (const [id, a] of Object.entries(value.active)) {
    if (!questById(id) || !a || typeof a !== 'object') continue;
    active[id] = { stage: Math.max(0, Number(a.stage) | 0), counts: { ...(a.counts ?? {}) }, startedDay: Math.max(1, Number(a.startedDay) | 0) };
  }
  const valid = (xs: unknown) => Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string') : [];
  return { enabled: value.enabled === true, active, completed: valid(value.completed), tracked: typeof value.tracked === 'string' ? value.tracked : null, lore: valid(value.lore), keepsakes: valid(value.keepsakes), recipes: valid(value.recipes) };
}

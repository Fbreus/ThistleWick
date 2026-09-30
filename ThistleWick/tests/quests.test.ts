import { describe, expect, it } from 'vitest';
import { LORE } from '../src/systems/lore';
import { QUESTS, acceptQuest, availableQuests, createQuestState, currentStage, questStatus, recordQuestEvent, residentConversation } from '../src/systems/quests';
import { ITEMS } from '../src/items';

const HOME = new Set(['craft:door', 'place:door', 'cottage', 'resident:bramble', 'talk:bramble', 'gift:bramble']);

describe('story quests', () => {
  it('unlocks, accepts and tracks the first quest without retroactive counters', () => {
    const state = createQuestState(true);
    expect(availableQuests(state, HOME).map(q => q.id)).toEqual(['old-thistle-rule']);
    recordQuestEvent(state, { key: 'place:crop' });
    expect(acceptQuest(state, 'old-thistle-rule', 2, HOME)).toBe(true);
    expect(state.tracked).toBe('old-thistle-rule');
    expect(state.active['old-thistle-rule'].counts).toEqual({});
    recordQuestEvent(state, { key: 'place:crop', amount: 2 });
    expect(currentStage(state, 'old-thistle-rule')?.id).toBe('plant');
    recordQuestEvent(state, { key: 'place:crop' });
    expect(currentStage(state, 'old-thistle-rule')?.id).toBe('eat');
  });

  it('advances stages once per matching event and grants completion rewards', () => {
    const state = createQuestState(true);
    acceptQuest(state, 'old-thistle-rule', 1, HOME);
    recordQuestEvent(state, { key: 'place:crop', amount: 3 });
    recordQuestEvent(state, { key: 'eat:croot', amount: 2 });
    const updates = recordQuestEvent(state, { key: 'quest:handin:root' });
    expect(updates[0]).toMatchObject({ questId: 'old-thistle-rule', questCompleted: true, rewards: [{ id: 'seed', count: 3 }] });
    expect(state.completed).toContain('old-thistle-rule');
    expect(state.lore).toContain('old-thistle-rule');
  });

  it('offers main quests before the optional side quest', () => {
    const state = createQuestState(true);
    state.completed.push('old-thistle-rule');
    const flags = new Set([...HOME, 'cave']);
    expect(residentConversation(state, flags, 'bramble')?.quest.id).toBe('light-borrowed');
    expect(questStatus(QUESTS.find(q => q.id === 'door-without-house')!, state, flags)).toBe('available');
  });

  it('keeps story quests unavailable in legacy worlds', () => {
    const state = createQuestState(false);
    expect(availableQuests(state, HOME)).toEqual([]);
  });

  it('uses unique ids and references real lore, items and quests', () => {
    expect(new Set(QUESTS.map(q => q.id)).size).toBe(QUESTS.length);
    const lore = new Set(LORE.map(entry => entry.id)), quests = new Set(QUESTS.map(q => q.id));
    for (const quest of QUESTS) {
      expect(new Set(quest.stages.map(stage => stage.id)).size).toBe(quest.stages.length);
      for (const required of quest.requires?.quests ?? []) expect(quests.has(required), required).toBe(true);
      for (const unlocks of [...quest.stages.map(stage => stage.unlocks), quest.rewards]) {
        for (const id of unlocks?.lore ?? []) expect(lore.has(id), id).toBe(true);
        for (const item of unlocks?.items ?? []) expect(ITEMS[item.id], item.id).toBeDefined();
      }
      for (const stage of quest.stages) for (const item of stage.residentCue?.items ?? []) expect(ITEMS[item.id], item.id).toBeDefined();
    }
  });
});

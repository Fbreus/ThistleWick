/** Lore unlocked by story quests. Kept separate from rendering so saves and tests only store ids. */

export interface LoreEntry { id: string; title: string; body: string }

export const LORE: LoreEntry[] = [
  {
    id: 'old-thistle-rule',
    title: 'The Old Thistle Rule',
    body: 'Plant three. Eat two. Leave one for those below. Bramble remembers the words, but not whether they were a kindness, a warning, or simply good gardening.'
  },
  {
    id: 'dawnstone',
    title: 'A Light Borrowed',
    body: 'Glow crystals do not make light. Their facets hold the warmth of mornings gathered through root, rain and stone. Every bright shard is tomorrow borrowed early.'
  },
  {
    id: 'listening-stones',
    title: 'The Listening Stones',
    body: 'Three stones remember one warning: do not take light from beneath the roots. Their voices disagree about who first broke that rule.'
  },
  {
    id: 'first-hearth',
    title: 'The First Hearth',
    body: 'The first hearth was not a palace. It was a cottage built around a coal that would not go cold, with a chair left ready for whoever found the path home.'
  },
  {
    id: 'door-without-house',
    title: 'The Door Without a House',
    body: 'An empty home should keep one chair facing its entrance. The chair is for the person who did not return on the Night of Shuttered Doors.'
  }
];

export const loreById = (id: string) => LORE.find(entry => entry.id === id) ?? null;

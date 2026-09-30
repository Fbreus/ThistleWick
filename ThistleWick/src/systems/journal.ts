/** Journal: goal arcs derived from a set of progress keys. Pure logic, no DOM or renderer. */

export interface Step { id: string; text: string; key: string }
export interface Arc { id: string; title: string; blurb: string; steps: Step[] }

/** Progress is a set of string keys such as `got:wood`, `craft:workbench`, `place:bed`, `slept`, `cave`, `kill:beetle`, `biome:2`. */
export type Progress = Set<string>;

export const ARCS: Arc[] = [
  {
    id: 'hearth', title: 'A Warm Hearth', blurb: 'The forest is kind by day. Make a place that keeps the night out.',
    steps: [
      { id: 'wood', text: 'Punch a tree to gather wood', key: 'got:wood' },
      { id: 'bench', text: 'Craft a workbench (Tab opens your pack)', key: 'craft:workbench' },
      { id: 'benchPlaced', text: 'Place the workbench on the ground', key: 'place:bench' },
      { id: 'wpick', text: 'Craft a wooden pickaxe at the workbench', key: 'craft:wpick' },
      { id: 'camp', text: 'Build a campfire (wood and stone)', key: 'place:camp' },
      { id: 'bed', text: 'Craft a bed and place it near your fire', key: 'place:bed' },
      { id: 'slept', text: 'Sleep through a night in your bed', key: 'slept' }
    ]
  },
  {
    id: 'garden', title: 'A Kitchen Garden', blurb: 'Things grow while you sleep. Give them soil, water and a night or two.',
    steps: [
      { id: 'seed', text: 'Find a wild seed (berry bushes sometimes hold one)', key: 'got:seed' },
      { id: 'plant', text: 'Plant the seed in grass or dirt, ideally near water', key: 'place:crop' },
      { id: 'root', text: 'Sleep, then harvest a ripe thistle root', key: 'got:root' },
      { id: 'croot', text: 'Roast a root over a campfire', key: 'craft:croot' }
    ]
  },
  {
    id: 'home', title: 'A Place to Call Home', blurb: 'Walls, a roof and a door. Somebody might be glad of them.',
    steps: [
      { id: 'door', text: 'Craft a door at your workbench', key: 'craft:door' },
      { id: 'placeDoor', text: 'Place the door in a wall (it takes two blocks of height)', key: 'place:door' },
      { id: 'cottage', text: 'Seal a room with a bed, a light and a workbench inside', key: 'cottage' },
      { id: 'resident', text: 'Wait for a visitor to move in', key: 'resident:bramble' },
      { id: 'talk', text: 'Talk to your new neighbour (E)', key: 'talk:bramble' },
      { id: 'gift', text: 'Give them a gift (G with an item in hand)', key: 'gift:bramble' }
    ]
  },
  {
    id: 'forge', title: 'Iron and Fire', blurb: 'Stone bends to a good pickaxe, and iron bends to a hotter fire.',
    steps: [
      { id: 'stone', text: 'Break rock for stone', key: 'got:stone' },
      { id: 'spick', text: 'Craft a stone pickaxe', key: 'craft:spick' },
      { id: 'furnace', text: 'Build a furnace next to your workbench', key: 'place:furnace' },
      { id: 'ore', text: 'Mine iron ore (look for orange flecks in rock)', key: 'got:ore' },
      { id: 'ingot', text: 'Smelt an iron ingot in the furnace', key: 'craft:ingot' },
      { id: 'ipick', text: 'Craft an iron pickaxe', key: 'craft:ipick' }
    ]
  },
  {
    id: 'deep', title: 'Into the Dark', blurb: 'Under the roots the forest glows. Bring light, and something sturdy.',
    steps: [
      { id: 'cave', text: 'Walk into a cave', key: 'cave' },
      { id: 'torch', text: 'Craft torches from coal and sticks', key: 'craft:torch' },
      { id: 'crystal', text: 'Find a glow crystal in the cave walls', key: 'got:crystal' },
      { id: 'beetle', text: 'Defeat a gloom beetle', key: 'kill:beetle' },
      { id: 'cshield', text: 'Craft a carapace shield from beetle shells', key: 'craft:cshield' },
      { id: 'elder', text: 'Face the Elder Beetle. It wakes on the third night and slams hard, so strike when it recovers', key: 'kill:elder' },
      { id: 'eshield', text: 'Craft an Elder shield from its carapace, iron and crystal', key: 'craft:eshield' }
    ]
  }
];

export const createProgress = (keys: Iterable<string> = []): Progress => new Set(keys);

/** Records a key. Returns true only the first time it is seen. */
export function record(p: Progress, key: string): boolean {
  if (p.has(key)) return false;
  p.add(key);
  return true;
}

export const stepDone = (p: Progress, s: Step) => p.has(s.key);
export const arcProgress = (p: Progress, a: Arc) => ({ done: a.steps.filter(s => stepDone(p, s)).length, total: a.steps.length });
export const arcComplete = (p: Progress, a: Arc) => a.steps.every(s => stepDone(p, s));

/** The first unfinished step of the first unfinished arc, or null once everything is done. */
export function nextStep(p: Progress): { arc: Arc; step: Step } | null {
  for (const arc of ARCS) {
    const step = arc.steps.find(s => !stepDone(p, s));
    if (step) return { arc, step };
  }
  return null;
}

/** What a newly recorded key just completed: journal steps and, if it was the last one, the arc. */
export function completedBy(p: Progress, key: string): { steps: { arc: Arc; step: Step }[]; arcs: Arc[] } {
  const steps: { arc: Arc; step: Step }[] = [], arcs: Arc[] = [];
  for (const arc of ARCS) {
    for (const step of arc.steps) if (step.key === key) steps.push({ arc, step });
    if (arc.steps.some(s => s.key === key) && arcComplete(p, arc)) arcs.push(arc);
  }
  return { steps, arcs };
}

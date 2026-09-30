export function harvestRule(label = ''): { hits: number; tool?: string } {
  switch (label) {
    case 'Grass': return { hits: 3, tool: 'shovel' };
    case 'Fern': return { hits: 4, tool: 'shovel' };
    case 'Leaf litter': case 'Wildflower': return { hits: 2, tool: 'shovel' };
    case 'Twig': return { hits: 3, tool: 'axe' };
    case 'Loose stone': return { hits: 4, tool: 'pick' };
    default: return { hits: 1 };
  }
}
export function harvestPower(label: string | undefined, tool?: string, tier = 0): number {
  return tool && tool === harvestRule(label).tool ? [1, 2, 3, 4][Math.min(3, tier)] : 1;
}
/** Selection never consumes a generation RNG draw or renumbers scenery identities. */
export function harvestableScenery(tag: string, roll: number, genVersion: number): boolean {
  if (genVersion < 4) return true;
  return roll < (tag === 'grass' ? 0.035 : tag === 'leaf' ? 0.15 : 1);
}
export const BERRY_REGROW_SECONDS = 180;

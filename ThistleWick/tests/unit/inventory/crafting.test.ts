import { describe, expect, it } from 'vitest';

import {
  CRAFTING_RECIPES,
  checkCraft,
  craftRecipe,
  craftingRecipeById,
} from '@/inventory/Crafting';
import { PlayerInventory } from '@/inventory/Inventory';
import { MAX_STACK_SIZE } from '@/inventory/types';
import { BlockId } from '@/world/BlockRegistry';

function recipe(id: string) {
  const found = craftingRecipeById(id);
  if (found === null) {
    throw new Error(`missing recipe ${id}`);
  }
  return found;
}

describe('crafting registry', () => {
  it('has stable unique ids and valid quantities', () => {
    expect(new Set(CRAFTING_RECIPES.map((entry) => entry.id)).size).toBe(CRAFTING_RECIPES.length);
    for (const entry of CRAFTING_RECIPES) {
      expect(entry.output.count).toBeGreaterThan(0);
      expect(entry.output.count).toBeLessThanOrEqual(MAX_STACK_SIZE);
      expect(entry.ingredients.length).toBeGreaterThan(0);
      expect(entry.ingredients.every((ingredient) => ingredient.count > 0)).toBe(true);
    }
  });
});

describe('craftRecipe', () => {
  it('consumes ingredients across stacks and adds the result', () => {
    const inventory = new PlayerInventory({ size: 4 });
    inventory.setSlot(0, { item: BlockId.Cobblestone, count: 1 });
    inventory.setSlot(2, { item: BlockId.Cobblestone, count: 2 });

    expect(craftRecipe(inventory, recipe('bricks'))).toEqual({
      ok: true,
      output: { item: BlockId.Brick, count: 3 },
    });
    expect(inventory.countItem(BlockId.Cobblestone)).toBe(1);
    expect(inventory.countItem(BlockId.Brick)).toBe(3);
  });

  it('reports missing ingredients without changing the inventory', () => {
    const inventory = new PlayerInventory({ size: 2 });
    inventory.add(BlockId.Sand, 3);
    const before = inventory.snapshot();

    const result = craftRecipe(inventory, recipe('sandstone'));

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: 'missing-ingredients' });
    expect(inventory.snapshot()).toEqual(before);
  });

  it('does not consume ingredients when the output cannot fit', () => {
    const inventory = new PlayerInventory({ size: 2 });
    inventory.setSlot(0, { item: BlockId.Log, count: 2 });
    inventory.setSlot(1, { item: BlockId.Stone, count: MAX_STACK_SIZE });
    const before = inventory.snapshot();

    expect(craftRecipe(inventory, recipe('planks'))).toEqual({
      ok: false,
      reason: 'inventory-full',
    });
    expect(inventory.snapshot()).toEqual(before);
  });

  it('uses space released by consumed ingredients', () => {
    const inventory = new PlayerInventory({ size: 1 });
    inventory.setSlot(0, { item: BlockId.Log, count: 1 });

    expect(checkCraft(inventory.snapshot(), recipe('planks')).ok).toBe(true);
    expect(craftRecipe(inventory, recipe('planks')).ok).toBe(true);
    expect(inventory.getSlot(0)).toEqual({ item: BlockId.Planks, count: 4 });
  });
});

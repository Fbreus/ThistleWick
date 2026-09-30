/** Data-driven inventory crafting with atomic ingredient/output updates. */

import { BlockId } from '@/world/BlockRegistry';

import { MAX_STACK_SIZE, type Inventory, type InventorySnapshot, type ItemStack } from './types';

export interface CraftingIngredient {
  readonly item: BlockId;
  readonly count: number;
}

export interface CraftingRecipe {
  readonly id: string;
  readonly category: 'Basics' | 'Building' | 'Light';
  readonly output: ItemStack;
  readonly ingredients: readonly CraftingIngredient[];
}

export interface MissingIngredient extends CraftingIngredient {
  readonly available: number;
}

export type CraftingCheck =
  | { readonly ok: true; readonly output: ItemStack }
  | {
      readonly ok: false;
      readonly reason: 'missing-ingredients';
      readonly missing: readonly MissingIngredient[];
    }
  | { readonly ok: false; readonly reason: 'inventory-full' };

/**
 * The first recipe set intentionally uses only existing block items. Item ids in
 * current saves remain valid, while the registry can later grow tools and food
 * without changing the transaction code.
 */
export const CRAFTING_RECIPES: readonly CraftingRecipe[] = [
  {
    id: 'planks',
    category: 'Basics',
    output: { item: BlockId.Planks, count: 4 },
    ingredients: [{ item: BlockId.Log, count: 1 }],
  },
  {
    id: 'sandstone',
    category: 'Building',
    output: { item: BlockId.Sandstone, count: 1 },
    ingredients: [{ item: BlockId.Sand, count: 4 }],
  },
  {
    id: 'bricks',
    category: 'Building',
    output: { item: BlockId.Brick, count: 3 },
    ingredients: [{ item: BlockId.Cobblestone, count: 2 }],
  },
  {
    id: 'glow-lamp',
    category: 'Light',
    output: { item: BlockId.Lamp, count: 1 },
    ingredients: [
      { item: BlockId.Planks, count: 2 },
      { item: BlockId.CoalOre, count: 1 },
      { item: BlockId.Crystal, count: 1 },
    ],
  },
];

const RECIPE_BY_ID = new Map(CRAFTING_RECIPES.map((recipe) => [recipe.id, recipe]));

export function craftingRecipeById(id: string): CraftingRecipe | null {
  return RECIPE_BY_ID.get(id) ?? null;
}

/** Checks both ingredient counts and whether the result fits after consumption. */
export function checkCraft(snapshot: InventorySnapshot, recipe: CraftingRecipe): CraftingCheck {
  const missing: MissingIngredient[] = [];
  for (const ingredient of recipe.ingredients) {
    const available = countItem(snapshot.slots, ingredient.item);
    if (available < ingredient.count) {
      missing.push({ ...ingredient, available });
    }
  }
  if (missing.length > 0) {
    return { ok: false, reason: 'missing-ingredients', missing };
  }

  const slots = snapshot.slots.map((stack) => (stack === null ? null : { ...stack }));
  for (const ingredient of recipe.ingredients) {
    consume(slots, ingredient);
  }

  let remaining = recipe.output.count;
  for (let index = 0; index < slots.length && remaining > 0; index += 1) {
    const stack = slots[index];
    if (
      stack === undefined ||
      stack === null ||
      stack.item !== recipe.output.item ||
      stack.count >= MAX_STACK_SIZE
    ) {
      continue;
    }
    const moved = Math.min(MAX_STACK_SIZE - stack.count, remaining);
    slots[index] = { item: stack.item, count: stack.count + moved };
    remaining -= moved;
  }
  for (let index = 0; index < slots.length && remaining > 0; index += 1) {
    if (slots[index] !== null && slots[index] !== undefined) {
      continue;
    }
    const moved = Math.min(MAX_STACK_SIZE, remaining);
    slots[index] = { item: recipe.output.item, count: moved };
    remaining -= moved;
  }

  return remaining === 0
    ? { ok: true, output: recipe.output }
    : { ok: false, reason: 'inventory-full' };
}

/** Crafts once. A failed craft leaves every inventory slot untouched. */
export function craftRecipe(inventory: Inventory, recipe: CraftingRecipe): CraftingCheck {
  const snapshot = inventory.snapshot();
  const check = checkCraft(snapshot, recipe);
  if (!check.ok) {
    return check;
  }

  const slots = snapshot.slots.map((stack) => (stack === null ? null : { ...stack }));
  for (const ingredient of recipe.ingredients) {
    consume(slots, ingredient);
  }
  addOutput(slots, recipe.output);
  inventory.restore({ slots, selected: snapshot.selected });
  return check;
}

function countItem(slots: readonly (ItemStack | null)[], item: BlockId): number {
  let count = 0;
  for (const stack of slots) {
    if (stack?.item === item) {
      count += stack.count;
    }
  }
  return count;
}

function consume(slots: (ItemStack | null)[], ingredient: CraftingIngredient): void {
  let remaining = ingredient.count;
  for (let index = 0; index < slots.length && remaining > 0; index += 1) {
    const stack = slots[index];
    if (stack === undefined || stack === null || stack.item !== ingredient.item) {
      continue;
    }
    const taken = Math.min(stack.count, remaining);
    const left = stack.count - taken;
    slots[index] = left === 0 ? null : { item: stack.item, count: left };
    remaining -= taken;
  }
}

function addOutput(slots: (ItemStack | null)[], output: ItemStack): void {
  let remaining = output.count;
  for (let index = 0; index < slots.length && remaining > 0; index += 1) {
    const stack = slots[index];
    if (
      stack === undefined ||
      stack === null ||
      stack.item !== output.item ||
      stack.count >= MAX_STACK_SIZE
    ) {
      continue;
    }
    const moved = Math.min(MAX_STACK_SIZE - stack.count, remaining);
    slots[index] = { item: stack.item, count: stack.count + moved };
    remaining -= moved;
  }
  for (let index = 0; index < slots.length && remaining > 0; index += 1) {
    if (slots[index] === null || slots[index] === undefined) {
      const moved = Math.min(MAX_STACK_SIZE, remaining);
      slots[index] = { item: output.item, count: moved };
      remaining -= moved;
    }
  }
}

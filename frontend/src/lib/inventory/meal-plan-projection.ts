import { detectInventoryCategory, normalizeInventoryName, type InventoryCategory } from './normalize-inventory';
import {
  compareRecipeRequirementsToInventory,
  type ComparedRequirement,
  type InventoryComparableItem,
  type RecipeRequirement,
} from './recipe-requirements';

export type ProjectionStatus = 'sufficient' | 'partial' | 'missing' | 'unknown';

export type MealPlanProjectionItem = {
  ingredientName: string;
  normalizedName: string;
  requiredTotalQuantity: number | null;
  requiredUnit: RecipeRequirement['requiredUnit'];
  availableQuantity: number | null;
  availableUnit: RecipeRequirement['requiredUnit'];
  projectedUsedQuantity: number | null;
  projectedRemainingQuantity: number | null;
  missingQuantity: number | null;
  status: ProjectionStatus;
  usedInRecipes: string[];
  category: InventoryCategory;
  estimatedUnitPrice: number | null;
};

export type MealPlanInventoryProjection = {
  items: MealPlanProjectionItem[];
  summary: {
    sufficient: number;
    partial: number;
    missing: number;
    unknown: number;
    estimatedCost: number;
  };
};

export type ConsolidatedMissingIngredient = {
  normalizedName: string;
  ingredientName: string;
  category: InventoryCategory;
  unit: RecipeRequirement['requiredUnit'];
  missingQuantity: number | null;
  usedInRecipes: string[];
  status: 'missing' | 'partial' | 'unknown';
  estimatedUnitPrice: number | null;
};

export type ShoppingListGroupItem = {
  normalizedName: string;
  ingredientName: string;
  quantityToBuy: number | null;
  unit: RecipeRequirement['requiredUnit'];
  status: 'buy' | 'review' | 'covered';
  usedInRecipes: string[];
  estimatedCost: number | null;
};

export type SmartShoppingList = {
  groups: Array<{
    category: InventoryCategory;
    items: ShoppingListGroupItem[];
  }>;
  estimatedCostTotal: number;
};

type InventoryProjectionComparableItem = InventoryComparableItem & {
  category?: string | null;
  estimated_unit_price?: number | null;
};

function mergeRecipeSources(existing: string[], incoming: string[]): string[] {
  const set = new Set(existing);
  for (const source of incoming) set.add(source);
  return Array.from(set);
}

function inferCategory(name: string, category?: string | null): InventoryCategory {
  const safeCategory = category?.trim();
  if (
    safeCategory === 'Proteínas' ||
    safeCategory === 'Verduras' ||
    safeCategory === 'Frutas' ||
    safeCategory === 'Lácteos' ||
    safeCategory === 'Granos' ||
    safeCategory === 'Especias' ||
    safeCategory === 'Despensa' ||
    safeCategory === 'Otros'
  ) {
    return safeCategory;
  }
  return detectInventoryCategory(name);
}

function toProjectionItem(
  req: ComparedRequirement,
  inv: InventoryProjectionComparableItem | undefined,
): MealPlanProjectionItem {
  const required = req.requiredQuantity;
  const available = req.availableQuantity;
  const missing = req.missingQuantity;
  const used =
    req.status === 'unknown' || required === null
      ? null
      : available === null
        ? 0
        : Number(Math.min(available, required).toFixed(2));

  return {
    ingredientName: req.ingredientName,
    normalizedName: req.normalizedName,
    requiredTotalQuantity: required,
    requiredUnit: req.requiredUnit,
    availableQuantity: available,
    availableUnit: req.availableUnit,
    projectedUsedQuantity: used,
    projectedRemainingQuantity: req.remainingQuantity,
    missingQuantity: missing,
    status: req.status,
    usedInRecipes: req.usedInRecipes,
    category: inferCategory(req.ingredientName, inv?.category),
    estimatedUnitPrice:
      typeof inv?.estimated_unit_price === 'number' && Number.isFinite(inv.estimated_unit_price)
        ? inv.estimated_unit_price
        : null,
  };
}

export function estimateShoppingCost(items: Array<{
  missingQuantity: number | null;
  estimatedUnitPrice: number | null;
  status: 'missing' | 'partial' | 'unknown' | 'sufficient';
}>): number {
  let total = 0;
  for (const item of items) {
    if (item.status === 'unknown') continue;
    if (item.missingQuantity === null || item.estimatedUnitPrice === null) continue;
    total += item.missingQuantity * item.estimatedUnitPrice;
  }
  return Number(total.toFixed(2));
}

export function buildMealPlanInventoryProjection(
  mealPlanRecipes: RecipeRequirement[],
  inventoryItems: InventoryProjectionComparableItem[],
): MealPlanInventoryProjection {
  const compared = compareRecipeRequirementsToInventory(mealPlanRecipes, inventoryItems);
  const invMap = new Map(inventoryItems.map((item) => [normalizeInventoryName(item.ingredient_name), item]));
  const items = compared
    .map((item) => toProjectionItem(item, invMap.get(item.normalizedName)))
    .sort((a, b) => a.normalizedName.localeCompare(b.normalizedName));

  return {
    items,
    summary: {
      sufficient: items.filter((item) => item.status === 'sufficient').length,
      partial: items.filter((item) => item.status === 'partial').length,
      missing: items.filter((item) => item.status === 'missing').length,
      unknown: items.filter((item) => item.status === 'unknown').length,
      estimatedCost: estimateShoppingCost(items),
    },
  };
}

export function consolidateMissingIngredients(
  comparisons: MealPlanProjectionItem[],
): ConsolidatedMissingIngredient[] {
  const map = new Map<string, ConsolidatedMissingIngredient>();

  for (const item of comparisons) {
    if (item.status === 'sufficient') continue;
    const existing = map.get(item.normalizedName);
    if (!existing) {
      map.set(item.normalizedName, {
        normalizedName: item.normalizedName,
        ingredientName: item.ingredientName,
        category: item.category,
        unit: item.requiredUnit,
        missingQuantity: item.missingQuantity,
        usedInRecipes: [...item.usedInRecipes],
        status: item.status === 'partial' ? 'partial' : item.status === 'missing' ? 'missing' : 'unknown',
        estimatedUnitPrice: item.estimatedUnitPrice,
      });
      continue;
    }

    existing.usedInRecipes = mergeRecipeSources(existing.usedInRecipes, item.usedInRecipes);
    if (existing.missingQuantity !== null && item.missingQuantity !== null && existing.unit === item.requiredUnit) {
      existing.missingQuantity = Number((existing.missingQuantity + item.missingQuantity).toFixed(2));
    } else if (existing.missingQuantity === null && item.missingQuantity !== null) {
      existing.missingQuantity = item.missingQuantity;
      existing.unit = item.requiredUnit;
    } else if (item.missingQuantity === null) {
      existing.missingQuantity = null;
      existing.unit = 'unknown';
    }

    if (existing.status === 'unknown' || item.status === 'unknown') {
      existing.status = 'unknown';
    } else if (existing.status === 'partial' || item.status === 'partial') {
      existing.status = 'partial';
    } else {
      existing.status = 'missing';
    }

    if (existing.estimatedUnitPrice === null && item.estimatedUnitPrice !== null) {
      existing.estimatedUnitPrice = item.estimatedUnitPrice;
    }
  }

  return Array.from(map.values()).sort((a, b) => a.normalizedName.localeCompare(b.normalizedName));
}

export function buildSmartShoppingList(
  projection: MealPlanInventoryProjection,
): SmartShoppingList {
  const consolidated = consolidateMissingIngredients(projection.items);
  const byCategory = new Map<InventoryCategory, ShoppingListGroupItem[]>();

  for (const item of consolidated) {
    const category = item.category;
    const current = byCategory.get(category) ?? [];
    const estimatedCost =
      item.status === 'unknown' || item.missingQuantity === null || item.estimatedUnitPrice === null
        ? null
        : Number((item.missingQuantity * item.estimatedUnitPrice).toFixed(2));

    current.push({
      normalizedName: item.normalizedName,
      ingredientName: item.ingredientName,
      quantityToBuy: item.missingQuantity,
      unit: item.unit,
      status: item.status === 'unknown' ? 'review' : item.missingQuantity && item.missingQuantity > 0 ? 'buy' : 'covered',
      usedInRecipes: item.usedInRecipes,
      estimatedCost,
    });

    byCategory.set(category, current);
  }

  const orderedCategories: InventoryCategory[] = [
    'Proteínas',
    'Verduras',
    'Frutas',
    'Lácteos',
    'Granos',
    'Especias',
    'Despensa',
    'Otros',
  ];

  const groups = orderedCategories
    .map((category) => ({
      category,
      items: (byCategory.get(category) ?? []).sort((a, b) => a.ingredientName.localeCompare(b.ingredientName)),
    }))
    .filter((group) => group.items.length > 0);

  return {
    groups,
    estimatedCostTotal: Number(
      groups
        .flatMap((group) => group.items)
        .reduce((acc, item) => acc + (item.estimatedCost ?? 0), 0)
        .toFixed(2),
    ),
  };
}

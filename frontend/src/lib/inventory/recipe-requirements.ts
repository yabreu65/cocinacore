import { normalizeInventoryName } from './normalize-inventory';
import {
  type NormalizedUnit,
  compareInventoryToRequirement,
  normalizeUnit,
  parseQuantity,
} from './quantity-normalization';

export type RecipeRequirement = {
  ingredientName: string;
  normalizedName: string;
  requiredQuantity: number | null;
  requiredUnit: NormalizedUnit;
  usedInRecipes: string[];
};

export type InventoryComparableItem = {
  ingredient_name: string;
  quantity: string | null;
  unit: string | null;
};

export type ComparedRequirement = {
  ingredientName: string;
  normalizedName: string;
  requiredQuantity: number | null;
  requiredUnit: NormalizedUnit;
  availableQuantity: number | null;
  availableUnit: NormalizedUnit;
  missingQuantity: number | null;
  remainingQuantity: number | null;
  status: 'sufficient' | 'partial' | 'missing' | 'unknown';
  usedInRecipes: string[];
};

function extractIngredientsNode(recipePayload: unknown): unknown[] {
  if (Array.isArray(recipePayload)) return Array.from(recipePayload as unknown[]);
  if (!recipePayload || typeof recipePayload !== 'object') return [];

  const payload = recipePayload as Record<string, unknown>;
  if (Array.isArray(payload.structured_ingredients) && payload.structured_ingredients.length > 0) {
    return Array.from(payload.structured_ingredients as unknown[]);
  }
  if (
    payload.recipe &&
    typeof payload.recipe === 'object' &&
    Array.isArray((payload.recipe as Record<string, unknown>).structured_ingredients) &&
    ((payload.recipe as Record<string, unknown>).structured_ingredients as unknown[]).length > 0
  ) {
    return Array.from((payload.recipe as Record<string, unknown>).structured_ingredients as unknown[]);
  }

  const candidates: unknown[] = [];
  if (Array.isArray(payload.ingredients)) {
    for (const node of payload.ingredients as unknown[]) candidates.push(node);
  }
  if (payload.recipe && typeof payload.recipe === 'object') {
    const recipe = payload.recipe as Record<string, unknown>;
    if (Array.isArray(recipe.ingredients)) {
      for (const node of recipe.ingredients as unknown[]) candidates.push(node);
    }
  }
  if (payload.sections && typeof payload.sections === 'object') {
    const sections = payload.sections as Record<string, unknown>;
    if (Array.isArray(sections.ingredients)) {
      for (const node of sections.ingredients as unknown[]) candidates.push(node);
    }
  }
  if (typeof payload.markdown === 'string') {
    const lines = payload.markdown.split('\n');
    let inIngredients = false;
    for (const line of lines) {
      const clean = line.trim();
      if (/^#+\s*ingredientes/i.test(clean) || /^ingredientes:?$/i.test(clean)) {
        inIngredients = true;
        continue;
      }
      if (inIngredients && /^#+\s+/.test(clean)) break;
      if (inIngredients && clean.length > 0) candidates.push(clean);
    }
  }
  return candidates;
}

function parseIngredientObject(input: Record<string, unknown>): { name: string; quantity: number | null; unit: NormalizedUnit } {
  const rawName =
    (typeof input.name === 'string' && input.name) ||
    (typeof input.ingredient === 'string' && input.ingredient) ||
    (typeof input.title === 'string' && input.title) ||
    '';
  const qty = typeof input.quantity === 'number' ? input.quantity : null;
  const unit = normalizeUnit(typeof input.unit === 'string' ? input.unit : null);
  return {
    name: rawName.trim(),
    quantity: qty,
    unit: unit === 'unknown' ? 'unidad' : unit,
  };
}

export function normalizeRecipeIngredient(input: unknown): RecipeRequirement | null {
  if (typeof input === 'string') {
    const clean = input.replace(/^[-*•]\s*/, '').trim();
    if (!clean) return null;
    const parsed = parseQuantity(clean);
    const ingredientName = parsed.structured
      ? clean.replace(/^(\d+([.,]\d+)?|\d+\s*\/\s*\d+|\d+\s+\d+\s*\/\s*\d+)\s*/u, '').replace(/^(de)\s+/i, '').trim()
      : clean;
    const normalizedName = normalizeInventoryName(ingredientName);
    if (!normalizedName) return null;
    return {
      ingredientName,
      normalizedName,
      requiredQuantity: parsed.structured ? parsed.value : null,
      requiredUnit: parsed.structured ? parsed.unit : 'unknown',
      usedInRecipes: [],
    };
  }

  if (input && typeof input === 'object') {
    const parsed = parseIngredientObject(input as Record<string, unknown>);
    if (!parsed.name) return null;
    return {
      ingredientName: parsed.name,
      normalizedName: normalizeInventoryName(parsed.name),
      requiredQuantity: parsed.quantity,
      requiredUnit: parsed.unit,
      usedInRecipes: [],
    };
  }

  return null;
}

export function extractRecipeRequirements(recipePayload: unknown): RecipeRequirement[] {
  const nodes = extractIngredientsNode(recipePayload);
  const recipeTitle =
    recipePayload && typeof recipePayload === 'object' && typeof (recipePayload as Record<string, unknown>).title === 'string'
      ? ((recipePayload as Record<string, unknown>).title as string)
      : undefined;

  const requirements: RecipeRequirement[] = [];
  for (const node of nodes) {
    const normalized = normalizeRecipeIngredient(node);
    if (!normalized) continue;
    if (recipeTitle) normalized.usedInRecipes = [recipeTitle];
    requirements.push(normalized);
  }
  return requirements;
}

export function groupRequirementsByIngredient(requirements: RecipeRequirement[]): RecipeRequirement[] {
  const map = new Map<string, RecipeRequirement>();
  for (const item of requirements) {
    const existing = map.get(item.normalizedName);
    if (!existing) {
      map.set(item.normalizedName, { ...item, usedInRecipes: [...item.usedInRecipes] });
      continue;
    }

    if (existing.requiredUnit === item.requiredUnit && existing.requiredQuantity !== null && item.requiredQuantity !== null) {
      existing.requiredQuantity = Number((existing.requiredQuantity + item.requiredQuantity).toFixed(2));
    } else if (existing.requiredQuantity === null && item.requiredQuantity !== null) {
      existing.requiredQuantity = item.requiredQuantity;
      existing.requiredUnit = item.requiredUnit;
    } else if (existing.requiredQuantity !== null && item.requiredQuantity === null) {
      // keep structured quantity
    } else {
      existing.requiredQuantity = null;
      existing.requiredUnit = 'unknown';
    }

    for (const source of item.usedInRecipes) {
      if (!existing.usedInRecipes.includes(source)) existing.usedInRecipes.push(source);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.normalizedName.localeCompare(b.normalizedName));
}

export function compareRecipeRequirementsToInventory(
  requirements: RecipeRequirement[],
  inventoryItems: InventoryComparableItem[],
): ComparedRequirement[] {
  const groupedRequirements = groupRequirementsByIngredient(requirements);
  const inventoryByName = new Map(
    inventoryItems.map((item) => [normalizeInventoryName(item.ingredient_name), item]),
  );

  return groupedRequirements.map((req) => {
    const inv = inventoryByName.get(req.normalizedName);
    if (!inv) {
      return {
        ingredientName: req.ingredientName,
        normalizedName: req.normalizedName,
        requiredQuantity: req.requiredQuantity,
        requiredUnit: req.requiredUnit,
        availableQuantity: 0,
        availableUnit: req.requiredUnit,
        missingQuantity: req.requiredQuantity,
        remainingQuantity: 0,
        status: req.requiredQuantity === null ? 'unknown' : 'missing',
        usedInRecipes: req.usedInRecipes,
      };
    }

    const compared = compareInventoryToRequirement(
      { quantity: inv.quantity, unit: inv.unit },
      {
        quantity: req.requiredQuantity === null ? null : String(req.requiredQuantity),
        unit: req.requiredUnit === 'unknown' ? null : req.requiredUnit,
      },
    );

    return {
      ingredientName: req.ingredientName,
      normalizedName: req.normalizedName,
      requiredQuantity: req.requiredQuantity,
      requiredUnit: req.requiredUnit,
      availableQuantity: compared.available,
      availableUnit: normalizeUnit(inv.unit),
      missingQuantity: compared.missing,
      remainingQuantity: compared.remaining,
      status: compared.status,
      usedInRecipes: req.usedInRecipes,
    };
  });
}

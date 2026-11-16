import {
  addQuantity,
  compareQuantity,
  subtractQuantity,
  quantityNumber,
  zeroQuantity,
  quantityBasis,
  readQuantityBasis,
  readUntrustedQuantityBasis,
  parseExactQuantity,
  type ExactQuantityBasis,
} from './exact-quantity';
import { normalizeInventoryName } from './normalize-inventory';
import { readExactRecipeAmount } from '@/lib/recipes/recipe-amount';
import {
  type NormalizedUnit,
  canCompareUnits,
  convertExactQuantity,
  normalizeUnit,
  normalizeExplicitUnit,
  parseExactStoredQuantity,
  parseExplicitRecipeLine,
} from './quantity-normalization';

export type RecipeRequirement = {
  ingredientName: string;
  normalizedName: string;
  requiredQuantity: number | null;
  exactQuantityBasis?: ExactQuantityBasis;
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
    return Array.from(
      (payload.recipe as Record<string, unknown>).structured_ingredients as unknown[]
    );
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
      if (
        inIngredients &&
        (/^#+\s+/.test(clean) ||
          /^#?\s*(preparaci[oó]n|elaboraci[oó]n|instrucciones|pasos|procedimiento|modo de preparaci[oó]n):?\s*$/i.test(
            clean
          ))
      ) {
        break;
      }
      if (inIngredients && clean.length > 0) candidates.push(clean);
    }
  }
  return candidates;
}

function parseIngredientObject(input: Record<string, unknown>): {
  name: string;
  quantity: number | null;
  exactQuantityBasis?: ExactQuantityBasis;
  unit: NormalizedUnit;
} {
  const rawName =
    (typeof input.name === 'string' && input.name) ||
    (typeof input.ingredient === 'string' && input.ingredient) ||
    (typeof input.title === 'string' && input.title) ||
    '';
  const rawUnit = typeof input.unit === 'string' ? input.unit : null;
  const stored =
    typeof input.quantity === 'string' && input.exactQuantityBasis === undefined && input.exact_quantity_text === undefined
      ? parseExactStoredQuantity({ quantity: input.quantity, unit: rawUnit })
      : null;
  const unit = stored?.unit ?? normalizeExplicitUnit(rawUnit);
  const exact =
    unit === 'unknown'
      ? null
      : input.exact_quantity_text !== undefined
        ? input.exactQuantityBasis === undefined &&
            !(input.structured === false && input.quantity !== null) &&
            !(input.structured === true && input.quantity === null)
          ? readExactRecipeAmount(input.exact_quantity_text, input.quantity, input.optional_quantity_text)
          : null
        : input.structured === false
          ? null
          : input.exactQuantityBasis !== undefined
            ? readUntrustedQuantityBasis(input.quantity, input.exactQuantityBasis)
            : (stored?.quantity ??
              (typeof input.quantity === 'number' ? parseExactQuantity(input.quantity) : null));
  const numeric = exact && exact.numerator > BigInt(0) ? quantityNumber(exact) : null;
  const known = numeric !== null && Number.isFinite(numeric) && numeric > 0;
  const basis = known && exact ? quantityBasis(exact) : undefined;
  return {
    name: rawName.trim(),
    quantity: known ? numeric : null,
    ...(basis ? { exactQuantityBasis: basis } : {}),
    unit: known ? unit : 'unknown',
  };
}

export function normalizeRecipeIngredient(input: unknown): RecipeRequirement | null {
  if (typeof input === 'string') {
    const clean = input.replace(/^[-*•]\s*/, '').trim();
    if (!clean) return null;
    // Preserve the existing explicit tomato count alias without allowing the
    // permissive legacy parser to promote an ambiguous amount to exact stock.
    const countAlias = /^(\d+)\s+(tomates?)$/i.exec(clean);
    const explicit = parseExplicitRecipeLine(countAlias
      ? `${countAlias[1]} unidad ${countAlias[2]}`
      : clean);
    const normalizedName = normalizeInventoryName(explicit.name);
    if (!normalizedName) return null;
    const numeric = explicit.amount ? quantityNumber(explicit.amount) : null;
    const known = numeric !== null && Number.isFinite(numeric) && numeric > 0;
    return {
      ingredientName: explicit.name,
      normalizedName,
      requiredQuantity: known ? numeric : null,
      ...(known && explicit.amount ? { exactQuantityBasis: quantityBasis(explicit.amount) } : {}),
      requiredUnit: known ? explicit.unit : 'unknown',
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
      ...(parsed.exactQuantityBasis ? { exactQuantityBasis: parsed.exactQuantityBasis } : {}),
      requiredUnit: parsed.unit,
      usedInRecipes: [],
    };
  }

  return null;
}

export function extractRecipeRequirements(recipePayload: unknown): RecipeRequirement[] {
  const nodes = extractIngredientsNode(recipePayload);
  const recipeTitle =
    recipePayload &&
    typeof recipePayload === 'object' &&
    typeof (recipePayload as Record<string, unknown>).title === 'string'
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

export function groupRequirementsByIngredient(
  requirements: RecipeRequirement[]
): RecipeRequirement[] {
  const groups = new Map<string, RecipeRequirement[]>();
  for (const item of requirements) {
    const group = groups.get(item.normalizedName) ?? [];
    group.push(item);
    groups.set(item.normalizedName, group);
  }

  return Array.from(groups.entries())
    .map(([normalizedName, group]): RecipeRequirement => {
      const first = { ...group[0]! };
      // Do not retain a previous group's fraction after regrouping or invalidation.
      delete first.exactQuantityBasis;
      const usedInRecipes = Array.from(new Set(group.flatMap((item) => item.usedInRecipes)));
      const allKnown = group.every(
        (item) => item.requiredQuantity !== null && item.requiredUnit !== 'unknown'
      );
      if (!allKnown)
        return {
          ...first,
          normalizedName,
          requiredQuantity: null,
          requiredUnit: 'unknown',
          usedInRecipes,
        };

      const units = group.map((item) => item.requiredUnit);
      if (units.some((unit) => !canCompareUnits(units[0]!, unit))) {
        return {
          ...first,
          normalizedName,
          requiredQuantity: null,
          requiredUnit: 'unknown',
          usedInRecipes,
        };
      }
      const targetUnit = units.includes('kg')
        ? 'kg'
        : units.includes('l')
          ? 'l'
          : units.includes('cucharada')
            ? 'cucharada'
            : units[0]!;
      let exactTotal = zeroQuantity;
      for (const item of group) {
        const exact = readQuantityBasis(item.requiredQuantity, item.exactQuantityBasis);
        const quantity = exact && convertExactQuantity(exact, item.requiredUnit, targetUnit);
        if (!quantity || quantity.numerator <= BigInt(0))
          return {
            ...first,
            normalizedName,
            requiredQuantity: null,
            requiredUnit: 'unknown',
            usedInRecipes,
          };
        exactTotal = addQuantity(exactTotal, quantity);
      }
      const total = quantityNumber(exactTotal);
      const basis = quantityBasis(exactTotal);
      return !Number.isFinite(total) || (total === 0 && exactTotal.numerator > BigInt(0))
        ? {
            ...first,
            normalizedName,
            requiredQuantity: null,
            requiredUnit: 'unknown',
            usedInRecipes,
          }
        : {
            ...first,
            normalizedName,
            requiredQuantity: total,
            ...(basis ? { exactQuantityBasis: basis } : {}),
            requiredUnit: targetUnit,
            usedInRecipes,
          };
    })
    .sort((a, b) => a.normalizedName.localeCompare(b.normalizedName));
}

export function compareRecipeRequirementsToInventory(
  requirements: RecipeRequirement[],
  inventoryItems: InventoryComparableItem[]
): ComparedRequirement[] {
  const groupedRequirements = groupRequirementsByIngredient(requirements);
  const inventoryByName = new Map<string, InventoryComparableItem[]>();
  for (const item of inventoryItems) {
    const key = normalizeInventoryName(item.ingredient_name);
    const current = inventoryByName.get(key) ?? [];
    current.push(item);
    inventoryByName.set(key, current);
  }

  return groupedRequirements.map((req) => {
    const matchingInventory = inventoryByName.get(req.normalizedName) ?? [];
    if (matchingInventory.length === 0) {
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

    const required = readQuantityBasis(req.requiredQuantity, req.exactQuantityBasis);
    let available = zeroQuantity;
    let comparableRows = 0;
    let ambiguousRows = 0;
    for (const item of matchingInventory) {
      const parsed = parseExactStoredQuantity({ quantity: item.quantity, unit: item.unit });
      const converted = parsed && convertExactQuantity(parsed.quantity, parsed.unit, req.requiredUnit);
      if (!converted || converted.numerator < BigInt(0)) {
        ambiguousRows += 1;
        continue;
      }
      available = addQuantity(available, converted);
      comparableRows += 1;
    }
    const availableNumber = quantityNumber(available);
    const comparable = required !== null && req.requiredUnit !== 'unknown' &&
      comparableRows > 0 && Number.isFinite(availableNumber);
    const diff = comparable && required ? subtractQuantity(available, required) : null;
    const sufficient = diff !== null && compareQuantity(diff, zeroQuantity) >= 0;
    // Known lots can establish sufficiency, but unknown lots prevent an
    // exact remaining balance. availableQuantity is the comparable subtotal.
    const determinate = diff !== null && (sufficient || ambiguousRows === 0);
    const missing = determinate && diff && !sufficient ? quantityNumber(subtractQuantity(zeroQuantity, diff)) : 0;
    const remaining = determinate && diff && sufficient ? quantityNumber(diff) : 0;
    return {
      ingredientName: req.ingredientName,
      normalizedName: req.normalizedName,
      requiredQuantity: req.requiredQuantity,
      requiredUnit: req.requiredUnit,
      availableQuantity: comparableRows > 0 && Number.isFinite(availableNumber) ? availableNumber : null,
      availableUnit: comparableRows > 0 ? req.requiredUnit : normalizeUnit(matchingInventory[0].unit),
      missingQuantity: determinate ? missing : null,
      remainingQuantity: determinate && ambiguousRows === 0 ? remaining : null,
      status: !determinate ? 'unknown' : sufficient ? 'sufficient' : available.numerator > BigInt(0) ? 'partial' : 'missing',
      usedInRecipes: req.usedInRecipes,
    };
  });
}

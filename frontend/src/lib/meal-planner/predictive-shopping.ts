import { createHash } from 'node:crypto';
import type { RecipeInventoryItemRow, ShoppingListItemRow } from '@/lib/db/types';
import { buildMealPlanCoverageForecast, type MealPlanCoverageForecast } from './coverage-forecast';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import { getLocalDateInTimeZone, type StructuredMealPlan } from './structured-plan';

export type PredictiveShoppingStatus = 'ready' | 'unknown';
export type PredictiveShoppingItemStatus = 'buy' | 'review';
export type PredictiveShoppingCostStatus = 'complete' | 'partial' | 'unknown';

export type PredictiveShoppingItem = {
  normalizedName: string;
  ingredientName: string;
  requiredQuantity: number | null;
  availableQuantity: number | null;
  quantityToBuy: number | null;
  unit: string;
  status: PredictiveShoppingItemStatus;
  usedInRecipes: string[];
  estimatedCost: number | null;
  alreadyPresent: boolean;
  shoppingStatus: ShoppingListItemRow['status'] | null;
  transferCompleted: boolean;
  existingShoppingSources: string[];
};

export type PredictiveShoppingCost = {
  status: PredictiveShoppingCostStatus;
  estimatedTotal: number | null;
  knownItemCount: number;
  itemCount: number;
};

export type PredictiveShoppingProposal = {
  status: PredictiveShoppingStatus;
  reason?: MealPlanCoverageForecast['reason'];
  horizonDays: 7 | 14;
  timeZone: string | null;
  fromDate: string | null;
  throughDate: string | null;
  scheduledMealCount: number;
  consumedMealCount: number;
  sourceFingerprint: string;
  items: PredictiveShoppingItem[];
  cost: PredictiveShoppingCost;
};

export type BuildPredictiveShoppingProposalInput = {
  plan: StructuredMealPlan;
  inventoryItems: RecipeInventoryItemRow[];
  shoppingItems: ShoppingListItemRow[];
  consumptionPayload: unknown;
  horizonDays: 7 | 14;
  now: Date;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)])
  );
}

function currentShoppingIdentity(rows: ShoppingListItemRow[]): Map<string, ShoppingListItemRow[]> {
  const byName = new Map<string, ShoppingListItemRow[]>();
  for (const row of rows) {
    const normalizedName = normalizeInventoryName(row.ingredient_name);
    if (!normalizedName) continue;
    const existing = byName.get(normalizedName) ?? [];
    existing.push(row);
    byName.set(normalizedName, existing);
  }
  return byName;
}

function createCost(items: PredictiveShoppingItem[]): PredictiveShoppingCost {
  const knownItems = items.filter(
    (item) => item.status === 'buy' && item.quantityToBuy !== null && item.estimatedCost !== null
  );
  const hasUnknownItems = items.some((item) => item.status === 'review');
  const hasUnpricedItems = items.some(
    (item) => item.status === 'buy' && (item.quantityToBuy === null || item.estimatedCost === null)
  );
  const status: PredictiveShoppingCostStatus =
    items.length === 0 || (!hasUnknownItems && !hasUnpricedItems)
      ? 'complete'
      : knownItems.length > 0
        ? 'partial'
        : 'unknown';

  return {
    status,
    estimatedTotal:
      knownItems.length > 0
        ? Number(
            knownItems.reduce((total, item) => total + (item.estimatedCost ?? 0), 0).toFixed(2)
          )
        : status === 'complete'
          ? 0
          : null,
    knownItemCount: knownItems.length,
    itemCount: items.length,
  };
}

function hasInventoryEvidence(
  inventoryItems: RecipeInventoryItemRow[],
  normalizedName: string
): boolean {
  return inventoryItems.some(
    (item) => normalizeInventoryName(item.ingredient_name) === normalizedName
  );
}

export function createPredictiveShoppingFingerprint(
  input: BuildPredictiveShoppingProposalInput
): string {
  const scheduleDate = input.plan.schedule?.timeZone
    ? getLocalDateInTimeZone(input.now, input.plan.schedule.timeZone)
    : null;
  const payload = {
    horizonDays: input.horizonDays,
    scheduleDate,
    plan: input.plan,
    consumptionPayload: input.consumptionPayload,
    inventoryItems: [...input.inventoryItems]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => ({
        id: item.id,
        tenant_id: item.tenant_id,
        user_id: item.user_id,
        ingredient_name: item.ingredient_name,
        quantity: item.quantity,
        unit: item.unit,
        expiration_date: item.expiration_date,
        estimated_unit_price: item.estimated_unit_price,
        updated_at: item.updated_at,
      })),
    shoppingItems: [...input.shoppingItems]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => ({
        id: item.id,
        tenant_id: item.tenant_id,
        user_id: item.user_id,
        source: item.source,
        ingredient_name: item.ingredient_name,
        quantity: item.quantity,
        status: item.status,
        transfer_inventory_item_id: item.transfer_inventory_item_id,
        transferred_at: item.transferred_at,
        updated_at: item.updated_at,
      })),
  };

  return createHash('sha256')
    .update(JSON.stringify(stableValue(payload)))
    .digest('hex');
}

function unknownProposal(
  input: BuildPredictiveShoppingProposalInput,
  forecast: MealPlanCoverageForecast
): PredictiveShoppingProposal {
  return {
    status: 'unknown',
    reason: forecast.reason,
    horizonDays: input.horizonDays,
    timeZone: forecast.timeZone,
    fromDate: forecast.fromDate,
    throughDate: forecast.throughDate,
    scheduledMealCount: forecast.scheduledMealCount,
    consumedMealCount: forecast.consumedMealCount,
    sourceFingerprint: createPredictiveShoppingFingerprint(input),
    items: [],
    cost: createCost([]),
  };
}

export function buildPredictiveShoppingProposal(
  input: BuildPredictiveShoppingProposalInput
): PredictiveShoppingProposal {
  const forecast = buildMealPlanCoverageForecast({
    plan: input.plan,
    inventoryItems: input.inventoryItems,
    consumptionPayload: input.consumptionPayload,
    horizonDays: input.horizonDays,
    now: input.now,
  });
  if (forecast.status !== 'ready') return unknownProposal(input, forecast);

  const shoppingByName = currentShoppingIdentity(input.shoppingItems);
  const items = forecast.items
    .filter((item) => item.status !== 'sufficient')
    .map((item): PredictiveShoppingItem => {
      const noInventoryEvidence = !hasInventoryEvidence(input.inventoryItems, item.normalizedName);
      const knownMissing =
        item.status === 'unknown' &&
        noInventoryEvidence &&
        item.requiredTotalQuantity !== null &&
        item.requiredUnit !== 'unknown';
      const effectiveStatus = knownMissing ? 'missing' : item.status;
      const effectiveAvailableQuantity = knownMissing ? 0 : item.availableQuantity;
      const effectiveMissingQuantity = knownMissing
        ? item.requiredTotalQuantity
        : item.missingQuantity;
      const existing = shoppingByName.get(item.normalizedName) ?? [];
      const purchased = existing.find((row) => row.status === 'purchased');
      const representative = purchased ?? existing[0];
      const estimatedCost =
        effectiveStatus !== 'unknown' &&
        effectiveMissingQuantity !== null &&
        item.estimatedUnitPrice !== null
          ? Number((effectiveMissingQuantity * item.estimatedUnitPrice).toFixed(2))
          : null;

      return {
        normalizedName: item.normalizedName,
        ingredientName: item.ingredientName,
        requiredQuantity: item.requiredTotalQuantity,
        availableQuantity: effectiveAvailableQuantity,
        quantityToBuy: effectiveMissingQuantity,
        unit: item.requiredUnit,
        status: effectiveStatus === 'unknown' ? 'review' : 'buy',
        usedInRecipes: item.usedInRecipes,
        estimatedCost,
        alreadyPresent: existing.length > 0,
        shoppingStatus: representative?.status ?? null,
        transferCompleted: existing.some(
          (row) => row.transfer_inventory_item_id != null || row.transferred_at != null
        ),
        existingShoppingSources: Array.from(new Set(existing.map((row) => row.source))).sort(),
      };
    });

  return {
    status: 'ready',
    horizonDays: input.horizonDays,
    timeZone: forecast.timeZone,
    fromDate: forecast.fromDate,
    throughDate: forecast.throughDate,
    scheduledMealCount: forecast.scheduledMealCount,
    consumedMealCount: forecast.consumedMealCount,
    sourceFingerprint: createPredictiveShoppingFingerprint(input),
    items,
    cost: createCost(items),
  };
}

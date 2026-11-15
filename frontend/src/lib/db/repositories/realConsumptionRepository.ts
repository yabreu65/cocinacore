import { createHash } from 'node:crypto';
import { scopedTransaction } from '@/lib/db';
import { lockInventorySourceTenant } from '@/lib/db/inventory-source-lock';
import { parseExactQuantity } from '@/lib/inventory/exact-quantity';
import { planRationalStockDeduction } from '@/lib/inventory/stock-precision';
import { inventoryExpirationStatus } from '@/lib/meal-planner/expiration-date';
import { parseStructuredMealPlanValue } from '@/lib/meal-planner/structured-plan';
import { parseMealConsumptionPayload } from '@/lib/meal-planner/consumption';
import type { CookingSessionRow, RecipeInventoryItemRow } from '@/lib/db/types';
import type { DbTransactionClient } from '@/lib/db/transaction-client';
import { revalidateCookingSessionSourceInTransaction } from '@/lib/db/repositories/cookingSessionRepository';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import {
  convertExactQuantity,
  normalizeExplicitUnit,
  parseExactStoredQuantity,
  type NormalizedUnit,
} from '@/lib/inventory/quantity-normalization';

export type RealConsumptionOutcome = 'used' | 'omitted' | 'unknown' | 'substituted';

export interface ReconciliationInventoryOption {
  id: string;
  ingredient_name: string;
  normalized_name: string | null;
  quantity: string | null;
  unit: string | null;
  expiration_date: string | null;
}

export interface RealConsumptionItemInput {
  ingredientIndex?: number;
  originalIngredient: string;
  outcome: RealConsumptionOutcome;
  effectiveIngredient?: string | null;
  quantity: number | null;
  unit: string | null;
  inventoryItemId?: string | null;
  substituteIngredient?: string | null;
  substituteInventoryItemId?: string | null;
}

export interface ReconcileRealConsumptionInput {
  tenantId: string;
  userId: string;
  sessionId: string;
  expectedVersion: number;
  idempotencyKey: string;
  confirmed: true;
  items: RealConsumptionItemInput[];
}

export type RealConsumptionResult =
  | {
      status: 'applied' | 'already_applied';
      operationId: string;
      items: Array<{
        ingredientIndex?: number;
        originalIngredient: string;
        outcome: RealConsumptionOutcome;
        quantityStatus: 'known' | 'unknown';
      }>;
      movementIds: string[];
    }
  | {
      status:
        | 'not_found'
        | 'session_not_completed'
        | 'conflict'
        | 'source_conflict'
        | 'invalid_items'
        | 'inventory_not_found'
        | 'inventory_expired'
        | 'inventory_insufficient'
        | 'incompatible_units'
        | 'unrepresentable_inventory_quantity'
        | 'legacy_already_claimed';
    };

export class RealConsumptionError extends Error {
  constructor(
    public readonly code: Exclude<
      RealConsumptionResult,
      { status: 'applied' | 'already_applied' }
    >['status']
  ) {
    super(code);
    this.name = 'RealConsumptionError';
  }
}

type SnapshotIngredient = { name: string; quantity: string | null; unit: string | null };

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashPayload(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function normalizedName(value: string): string {
  return normalizeInventoryName(value).trim();
}

function snapshotIngredients(session: CookingSessionRow): SnapshotIngredient[] | null {
  if (!session.instruction_snapshot || typeof session.instruction_snapshot !== 'object')
    return null;
  const raw = (session.instruction_snapshot as { ingredients?: unknown }).ingredients;
  if (!Array.isArray(raw)) return null;
  const ingredients: SnapshotIngredient[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object') return null;
    const ingredient = value as Record<string, unknown>;
    if (typeof ingredient.name !== 'string' || !ingredient.name.trim()) return null;
    if (ingredient.quantity !== null && typeof ingredient.quantity !== 'string') return null;
    if (ingredient.unit !== null && typeof ingredient.unit !== 'string') return null;
    ingredients.push({
      name: ingredient.name.trim(),
      quantity: ingredient.quantity ?? null,
      unit: ingredient.unit ?? null,
    });
  }
  return ingredients;
}

async function setRlsContext(client: DbTransactionClient, tenantId: string, userId: string) {
  await client.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
    [tenantId, userId]
  );
}

async function loadLockedSession(
  client: DbTransactionClient,
  input: ReconcileRealConsumptionInput
): Promise<CookingSessionRow | null> {
  const result = await client.query<CookingSessionRow>(
    `select * from public.cooking_sessions
     where id = $1 and tenant_id = $2 and user_id = $3
     for update`,
    [input.sessionId, input.tenantId, input.userId]
  );
  return result.rows[0] ?? null;
}

async function existingIdempotentOperation(
  client: DbTransactionClient,
  input: ReconcileRealConsumptionInput,
  requestHash: string
): Promise<RealConsumptionResult | null> {
  // Immutable audit rows need no row lock (which would require UPDATE ACL).
  // New writes are serialized by the session/plan locks and unique constraints.
  const result = await client.query<{
    id: string;
    request_hash: string;
    source_snapshot_hash: string;
  }>(
    `select id, request_hash, source_snapshot_hash from public.real_consumption_operations
     where tenant_id = $1 and user_id = $2 and idempotency_key = $3`,
    [input.tenantId, input.userId, input.idempotencyKey]
  );
  const operation = result.rows[0];
  if (!operation) return null;
  if (operation.request_hash !== requestHash) {
    // An upgraded client adds indices to otherwise byte-identical legacy
    // requests. Strip ONLY the added field, and prove every index identifies
    // the unique original ingredient in the immutable, hash-bound snapshot.
    if (!input.items.some((item) => item.ingredientIndex !== undefined))
      return { status: 'conflict' };
    const legacyItems = input.items.map(({ ingredientIndex, ...item }) => {
      void ingredientIndex;
      return item;
    });
    if (operation.request_hash !== reconciliationRequestHash(input, legacyItems))
      return { status: 'conflict' };
    const session = await loadLockedSession(client, input);
    if (!session || hashPayload(session.instruction_snapshot) !== operation.source_snapshot_hash)
      return { status: 'conflict' };
    const ingredients = snapshotIngredients(session);
    if (
      !ingredients ||
      new Set(ingredients.map((i) => normalizedName(i.name))).size !== ingredients.length ||
      !resolveItems(input.items, ingredients)
    )
      return { status: 'conflict' };
  }
  const items = await client.query<{
    ingredient_index: number | null;
    original_ingredient: string;
    outcome: RealConsumptionOutcome;
    quantity_status: 'known' | 'unknown';
  }>(
    `select ingredient_index, original_ingredient, outcome, quantity_status
       from public.real_consumption_items
      where operation_id = $1 and tenant_id = $2 and user_id = $3
      order by ingredient_index asc nulls last, created_at asc, id asc`,
    [operation.id, input.tenantId, input.userId]
  );
  const movements = await client.query<{ movement_id: string }>(
    `select movement_id from public.real_consumption_movement_links
      where operation_id = $1 and tenant_id = $2 and user_id = $3
      order by created_at asc, movement_id asc`,
    [operation.id, input.tenantId, input.userId]
  );
  return {
    status: 'already_applied',
    operationId: operation.id,
    items: items.rows.map((row) => ({
      ...(row.ingredient_index != null ? { ingredientIndex: row.ingredient_index } : {}),
      originalIngredient: row.original_ingredient,
      outcome: row.outcome,
      quantityStatus: row.quantity_status,
    })),
    movementIds: movements.rows.map((row) => row.movement_id),
  };
}

async function validateInventory(
  client: DbTransactionClient,
  input: ReconcileRealConsumptionInput,
  item: RealConsumptionItemInput,
  now: Date,
  timeZone: string,
  priorLot?: { row: RecipeInventoryItemRow; remaining: number; unit: NormalizedUnit }
): Promise<
  | { row: RecipeInventoryItemRow; quantity: number; unit: NormalizedUnit; remaining: number }
  | RealConsumptionResult
> {
  if (!item.inventoryItemId || item.quantity === null || !item.unit || item.quantity <= 0) {
    return { status: 'invalid_items' };
  }
  const requested = parseExactQuantity(item.quantity);
  if (!requested || requested.numerator <= BigInt(0)) return { status: 'invalid_items' };
  const requestedUnit = normalizeExplicitUnit(item.unit);
  if (requestedUnit === 'unknown') return { status: 'incompatible_units' };
  const result = priorLot
    ? { rows: [priorLot.row] }
    : await client.query<RecipeInventoryItemRow>(
        `select * from public.recipe_inventory_items
      where id = $1 and tenant_id = $2 and user_id = $3
      for update`,
        [item.inventoryItemId, input.tenantId, input.userId]
      );
  const row = result.rows[0];
  if (!row) return { status: 'inventory_not_found' };
  const expectedName = normalizedName(item.effectiveIngredient ?? item.originalIngredient);
  if (normalizedName(row.ingredient_name) !== expectedName) {
    return { status: 'invalid_items' };
  }
  if (inventoryExpirationStatus(row.expiration_date, now, timeZone) !== 'eligible')
    return { status: 'inventory_expired' };
  const stored = parseExactStoredQuantity(row);
  if (!stored) return { status: 'incompatible_units' };
  const available = priorLot ? parseExactQuantity(priorLot.remaining) : stored.quantity;
  if (!available || available.numerator <= BigInt(0)) return { status: 'inventory_insufficient' };
  const unit = priorLot?.unit ?? stored.unit;
  const converted = convertExactQuantity(requested, requestedUnit, unit);
  if (!converted) return { status: 'incompatible_units' };
  const deduction = planRationalStockDeduction(available, converted);
  if (!deduction.ok)
    return {
      status:
        deduction.reason === 'insufficient'
          ? 'inventory_insufficient'
          : 'unrepresentable_inventory_quantity',
    };
  return {
    row,
    quantity: deduction.quantity,
    unit,
    remaining: deduction.remaining,
  };
}

/** Snapshot order is immutable for a session. Legacy clients may omit the index
 * only when the name identifies exactly one occurrence. */
function resolveItems(
  inputs: RealConsumptionItemInput[],
  ingredients: SnapshotIngredient[]
): Array<RealConsumptionItemInput & { ingredientIndex: number }> | null {
  if (inputs.length !== ingredients.length || inputs.length < 1 || inputs.length > 100) return null;
  const seen = new Set<number>();
  const resolved: Array<RealConsumptionItemInput & { ingredientIndex: number }> = [];
  const names = ingredients.map((ingredient) => normalizedName(ingredient.name));
  for (const item of inputs) {
    const key = normalizedName(item.originalIngredient);
    if (!key) return null;
    let index = item.ingredientIndex;
    if (index === undefined) {
      const matches = names.flatMap((name, i) => (name === key ? [i] : []));
      if (matches.length !== 1) return null;
      index = matches[0];
    }
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= ingredients.length ||
      seen.has(index) ||
      names[index] !== key
    )
      return null;
    seen.add(index);
    if (!['used', 'omitted', 'unknown', 'substituted'].includes(item.outcome)) return null;
    if (item.outcome === 'used' || item.outcome === 'substituted') {
      if (
        item.quantity === null ||
        !Number.isFinite(item.quantity) ||
        item.quantity <= 0 ||
        !item.unit ||
        !item.effectiveIngredient ||
        !item.inventoryItemId
      )
        return null;
    } else if (
      item.quantity !== null ||
      item.unit ||
      item.inventoryItemId ||
      item.effectiveIngredient
    ) {
      return null;
    }
    if (item.outcome === 'substituted') {
      if (!item.substituteIngredient || !item.substituteInventoryItemId) return null;
      if (
        normalizedName(item.substituteIngredient) !== normalizedName(item.effectiveIngredient ?? '')
      )
        return null;
      if (normalizedName(item.substituteIngredient) === key) return null;
      if (item.substituteInventoryItemId !== item.inventoryItemId) return null;
    } else if (item.outcome === 'used' && normalizedName(item.effectiveIngredient ?? '') !== key) {
      return null;
    } else if (item.substituteIngredient || item.substituteInventoryItemId) {
      return null;
    }

    resolved.push({ ...item, ingredientIndex: index, originalIngredient: ingredients[index].name });
  }
  return seen.size === ingredients.length
    ? resolved.sort((a, b) => a.ingredientIndex - b.ingredientIndex)
    : null;
}

async function getSlotClaim(
  client: DbTransactionClient,
  input: ReconcileRealConsumptionInput,
  session: CookingSessionRow
): Promise<{ mode: 'planned_legacy' | 'real_reconciliation'; operation_id: string | null } | null> {
  // Claims are append-only; the caller already holds the meal-plan lock.
  const existing = await client.query<{
    mode: 'planned_legacy' | 'real_reconciliation';
    operation_id: string | null;
  }>(
    `select mode, operation_id from public.meal_consumption_claims
      where tenant_id = $1 and user_id = $2 and meal_plan_id = $3 and day_index = $4 and meal_type = $5`,
    [input.tenantId, input.userId, session.meal_plan_id, session.day_index, session.meal_type]
  );
  return existing.rows[0] ?? null;
}

async function claimRealSlot(
  client: DbTransactionClient,
  input: ReconcileRealConsumptionInput,
  session: CookingSessionRow,
  operationId: string
): Promise<void> {
  await client.query(
    `insert into public.meal_consumption_claims
      (tenant_id, user_id, meal_plan_id, day_index, meal_type, mode, operation_id, operation_status)
      values ($1, $2, $3, $4, $5, 'real_reconciliation', $6, 'confirmed')`,
    [
      input.tenantId,
      input.userId,
      session.meal_plan_id,
      session.day_index,
      session.meal_type,
      operationId,
    ]
  );
}

async function readLockedPlanContext(
  client: DbTransactionClient,
  input: ReconcileRealConsumptionInput,
  session: CookingSessionRow
): Promise<{ hasLegacyConsumption: boolean; timeZone: string } | null> {
  const result = await client.query<{
    period: 'week' | 'fortnight' | 'month';
    calendar_payload: unknown;
    consumption_payload: unknown;
  }>(
    `select period, calendar_payload, consumption_payload from public.user_meal_plans
      where id = $1 and tenant_id = $2 and user_id = $3
      for update`,
    [session.meal_plan_id, input.tenantId, input.userId]
  );
  const plan = result.rows[0];
  if (!plan) return null;
  const parsed = parseStructuredMealPlanValue(plan.calendar_payload, plan.period);
  if (
    !parsed.success ||
    !parsed.plan.days.some(
      (day) =>
        day.dayIndex === session.day_index &&
        day.meals.some((meal) => meal.mealType === session.meal_type)
    )
  )
    return null;
  const payload = plan.consumption_payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (Object.hasOwn(payload, `${session.day_index}:${session.meal_type}`))
    return { hasLegacyConsumption: true, timeZone: parsed.plan.schedule?.timeZone ?? 'UTC' };
  if (Object.keys(payload).length !== Object.keys(parseMealConsumptionPayload(payload)).length)
    return null;
  return { hasLegacyConsumption: false, timeZone: parsed.plan.schedule?.timeZone ?? 'UTC' };
}

function reconciliationRequestHash(
  input: ReconcileRealConsumptionInput,
  items = input.items
): string {
  return hashPayload({
    sessionId: input.sessionId,
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    confirmed: input.confirmed,
    items,
  });
}

export async function reconcileRealConsumptionInTransaction(
  client: DbTransactionClient,
  input: ReconcileRealConsumptionInput,
  now?: Date
): Promise<RealConsumptionResult> {
  await setRlsContext(client, input.tenantId, input.userId);
  await lockInventorySourceTenant(client, input.tenantId);
  const requestHash = reconciliationRequestHash(input);
  const prior = await existingIdempotentOperation(client, input, requestHash);
  if (prior) return prior;

  const session = await loadLockedSession(client, input);
  if (!session) return { status: 'not_found' };
  if (session.status !== 'completed') return { status: 'session_not_completed' };
  if (session.version !== input.expectedVersion) return { status: 'conflict' };
  if (!(await revalidateCookingSessionSourceInTransaction(client, session))) {
    return { status: 'source_conflict' };
  }
  const ingredients = snapshotIngredients(session);
  const resolvedItems = ingredients && resolveItems(input.items, ingredients);
  if (!resolvedItems) return { status: 'invalid_items' };
  const planContext = await readLockedPlanContext(client, input, session);
  if (!planContext) return { status: 'source_conflict' };
  if (planContext.hasLegacyConsumption) return { status: 'legacy_already_claimed' };

  const existingClaim = await getSlotClaim(client, input, session);
  if (existingClaim) {
    return {
      status: existingClaim.mode === 'planned_legacy' ? 'legacy_already_claimed' : 'conflict',
    };
  }

  const evaluationTime = now ?? new Date();
  type ValidatedLot = {
    row: RecipeInventoryItemRow;
    quantity: number;
    unit: NormalizedUnit;
    remaining: number;
  };
  const inventories = new Map<number, ValidatedLot>();
  const balances = new Map<string, ValidatedLot>();
  for (const item of resolvedItems) {
    if (item.outcome !== 'used' && item.outcome !== 'substituted') continue;
    if (!item.inventoryItemId) return { status: 'invalid_items' };
    const lotId = item.inventoryItemId.toLowerCase();
    const checked = await validateInventory(
      client,
      input,
      item,
      evaluationTime,
      planContext.timeZone,
      balances.get(lotId)
    );
    if ('status' in checked) return checked;
    inventories.set(item.ingredientIndex, checked);
    balances.set(lotId, checked);
  }

  const operationResult = await client.query<{ id: string }>(
    `insert into public.real_consumption_operations
      (tenant_id, user_id, cooking_session_id, meal_plan_id, day_index, meal_type,
       recipe_id, recipe_version_id, idempotency_key, request_hash, source_snapshot_hash,
       status, confirmed_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'confirmed', now())
      returning id`,
    [
      input.tenantId,
      input.userId,
      input.sessionId,
      session.meal_plan_id,
      session.day_index,
      session.meal_type,
      session.recipe_id,
      session.recipe_version_id,
      input.idempotencyKey,
      requestHash,
      hashPayload(session.instruction_snapshot),
    ]
  );
  const operationId = operationResult.rows[0]?.id;
  if (!operationId) throw new RealConsumptionError('conflict');
  await claimRealSlot(client, input, session, operationId);

  const movementIds: string[] = [];
  const itemResults: Array<{
    ingredientIndex: number;
    originalIngredient: string;
    outcome: RealConsumptionOutcome;
    quantityStatus: 'known' | 'unknown';
  }> = [];
  for (const item of resolvedItems) {
    const quantityStatus = item.quantity === null ? 'unknown' : 'known';
    const inventory = inventories.get(item.ingredientIndex) ?? null;
    const storedQuantity = inventory?.quantity ?? null;
    const storedUnit = inventory?.unit ?? null;
    const itemResult = await client.query<{ id: string }>(
      `insert into public.real_consumption_items
        (operation_id, tenant_id, user_id, original_ingredient, normalized_original_ingredient,
         outcome, effective_ingredient, normalized_effective_ingredient, quantity, unit,
         quantity_status, inventory_item_id, ingredient_index)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning id`,
      [
        operationId,
        input.tenantId,
        input.userId,
        item.originalIngredient.trim(),
        normalizedName(item.originalIngredient),
        item.outcome,
        item.effectiveIngredient?.trim() ?? null,
        item.effectiveIngredient ? normalizedName(item.effectiveIngredient) : null,
        storedQuantity,
        storedUnit,
        quantityStatus,
        item.inventoryItemId ?? null,
        item.ingredientIndex,
      ]
    );
    const itemId = itemResult.rows[0]?.id;
    if (!itemId) throw new RealConsumptionError('conflict');
    if (item.outcome === 'substituted') {
      await client.query(
        `insert into public.real_consumption_substitutions
          (operation_id, item_id, tenant_id, user_id, original_ingredient, substitute_ingredient, substitute_inventory_item_id)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          operationId,
          itemId,
          input.tenantId,
          input.userId,
          item.originalIngredient.trim(),
          item.substituteIngredient?.trim(),
          item.substituteInventoryItemId,
        ]
      );
    }
    if (inventory) {
      const nextStoredQuantity = inventory.row.unit?.trim()
        ? String(inventory.remaining)
        : `${inventory.remaining} ${inventory.unit}`;
      const updated = await client.query<{ id: string }>(
        `update public.recipe_inventory_items
            set quantity = $1, updated_at = now()
          where id = $2 and tenant_id = $3 and user_id = $4 returning id`,
        [nextStoredQuantity, inventory.row.id, input.tenantId, input.userId]
      );
      if (updated.rows[0]?.id !== inventory.row.id) throw new RealConsumptionError('conflict');
      const movement = await client.query<{ id: string }>(
        `insert into public.inventory_movements
          (tenant_id, user_id, inventory_item_id, movement_type, quantity, unit, normalized_name,
           source, source_recipe, source_meal_plan_id, notes)
         values ($1, $2, $3, 'recipe_consumption', $4, $5, $6, $7, $8, $9, $10)
         returning id`,
        [
          input.tenantId,
          input.userId,
          inventory.row.id,
          inventory.quantity,
          inventory.unit,
          normalizedName(item.effectiveIngredient ?? item.originalIngredient),
          `real-consumption:${operationId}`,
          session.recipe_id,
          session.meal_plan_id,
          'Confirmed by user via cooking-session reconciliation',
        ]
      );
      const movementId = movement.rows[0]?.id;
      if (!movementId) throw new RealConsumptionError('conflict');
      movementIds.push(movementId);
      await client.query(
        `insert into public.real_consumption_movement_links
          (operation_id, item_id, movement_id, tenant_id, user_id)
         values ($1, $2, $3, $4, $5)`,
        [operationId, itemId, movementId, input.tenantId, input.userId]
      );
    }
    itemResults.push({
      ingredientIndex: item.ingredientIndex,
      originalIngredient: item.originalIngredient.trim(),
      outcome: item.outcome,
      quantityStatus,
    });
  }
  return { status: 'applied', operationId, items: itemResults, movementIds };
}

export async function reconcileRealConsumption(
  input: ReconcileRealConsumptionInput
): Promise<RealConsumptionResult> {
  return scopedTransaction(
    { tenantId: input.tenantId, userId: input.userId },
    (client) => reconcileRealConsumptionInTransaction(client, input),
    { isolationLevel: 'read committed' }
  ).catch((error: unknown) => {
    if (error instanceof RealConsumptionError) return { status: error.code };
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === '23505' || error.code === '40001' || error.code === '40P01')
    ) {
      return { status: 'conflict' as const };
    }
    throw error;
  });
}

/** Recover a committed receipt without re-submitting or trusting browser data.
 * The unique session/tenant/user key guarantees at most one operation. */
export async function findReconciliationReceipt(
  sessionId: string,
  tenantId: string,
  userId: string
): Promise<{ operationId: string; movementCount: number } | null> {
  return scopedTransaction({ tenantId, userId }, async (client) => {
    const result = await client.query<{ id: string; movement_count: string }>(
      `select o.id, (select count(*) from public.real_consumption_movement_links l
          where l.operation_id=o.id and l.tenant_id=o.tenant_id and l.user_id=o.user_id) as movement_count
        from public.real_consumption_operations o
        where o.cooking_session_id=$1 and o.tenant_id=$2 and o.user_id=$3 and o.status='confirmed'`,
      [sessionId, tenantId, userId]
    );
    const row = result.rows[0];
    return row ? { operationId: row.id, movementCount: Number(row.movement_count) } : null;
  });
}

export async function listReconciliationInventory(
  tenantId: string,
  userId: string
): Promise<ReconciliationInventoryOption[]> {
  return scopedTransaction({ tenantId, userId }, async (client) => {
    const result = await client.query<ReconciliationInventoryOption>(
      `select id, ingredient_name, normalized_name, quantity, unit, expiration_date
         from public.recipe_inventory_items
        where tenant_id = $1 and user_id = $2
        order by expiration_date asc nulls last, created_at asc, id asc`,
      [tenantId, userId]
    );
    return result.rows;
  });
}

export async function claimPlannedMealInTransaction(
  client: DbTransactionClient,
  input: {
    tenantId: string;
    userId: string;
    mealPlanId: string;
    dayIndex: number;
    mealType: string;
  }
): Promise<
  | { status: 'claimed' }
  | { status: 'already_claimed'; mode: 'planned_legacy' | 'real_reconciliation' }
> {
  await setRlsContext(client, input.tenantId, input.userId);
  await lockInventorySourceTenant(client, input.tenantId);
  // The legacy consumption caller locks the tenant and plan first; immutable claims do
  // not need UPDATE privileges merely to be checked. Uniqueness guards inserts.
  const existing = await client.query<{ mode: string }>(
    `select mode from public.meal_consumption_claims
      where tenant_id = $1 and user_id = $2 and meal_plan_id = $3 and day_index = $4 and meal_type = $5`,
    [input.tenantId, input.userId, input.mealPlanId, input.dayIndex, input.mealType]
  );
  if (existing.rows[0])
    return {
      status: 'already_claimed',
      mode: existing.rows[0].mode as 'planned_legacy' | 'real_reconciliation',
    };
  await client.query(
    `insert into public.meal_consumption_claims
      (tenant_id, user_id, meal_plan_id, day_index, meal_type, mode)
     values ($1, $2, $3, $4, $5, 'planned_legacy')`,
    [input.tenantId, input.userId, input.mealPlanId, input.dayIndex, input.mealType]
  );
  return { status: 'claimed' };
}

import { createHash } from 'node:crypto';
import { transaction } from '@/lib/db';
import type { CookingSessionRow, RecipeInventoryItemRow } from '@/lib/db/types';
import type { DbTransactionClient } from '@/lib/db/transaction-client';
import { revalidateCookingSessionSourceInTransaction } from '@/lib/db/repositories/cookingSessionRepository';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import { formatStoredInventoryQuantity } from '@/lib/meal-planner/consumption';
import {
  canCompareUnits,
  convertQuantity,
  normalizeUnit,
  parseQuantity,
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

function quantityInUnit(value: number, from: NormalizedUnit, to: NormalizedUnit): number | null {
  if (from === to) return value;
  return convertQuantity(value, from, to);
}

function inventoryQuantity(item: RecipeInventoryItemRow) {
  const unit = normalizeUnit(item.unit);
  const parsed = parseQuantity(item.quantity ?? '');
  const value = parsed.value;
  return { value, unit: unit === 'unknown' ? parsed.unit : unit };
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
  const result = await client.query<{ id: string; request_hash: string }>(
    `select id, request_hash from public.real_consumption_operations
     where tenant_id = $1 and user_id = $2 and idempotency_key = $3`,
    [input.tenantId, input.userId, input.idempotencyKey]
  );
  const operation = result.rows[0];
  if (!operation) return null;
  if (operation.request_hash !== requestHash) return { status: 'conflict' };
  const items = await client.query<{
    original_ingredient: string;
    outcome: RealConsumptionOutcome;
    quantity_status: 'known' | 'unknown';
  }>(
    `select original_ingredient, outcome, quantity_status
       from public.real_consumption_items
      where operation_id = $1 and tenant_id = $2 and user_id = $3
      order by created_at asc, id asc`,
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
  now: Date
): Promise<
  | { row: RecipeInventoryItemRow; quantity: number; unit: NormalizedUnit; available: number }
  | RealConsumptionResult
> {
  if (!item.inventoryItemId || item.quantity === null || !item.unit || item.quantity <= 0) {
    return { status: 'invalid_items' };
  }
  const requestedUnit = normalizeUnit(item.unit);
  if (requestedUnit === 'unknown') return { status: 'incompatible_units' };
  const result = await client.query<RecipeInventoryItemRow>(
    `select * from public.recipe_inventory_items
      where id = $1 and tenant_id = $2 and user_id = $3
      for update`,
    [item.inventoryItemId, input.tenantId, input.userId]
  );
  const row = result.rows[0];
  if (!row) return { status: 'inventory_not_found' };
  const expectedName = normalizedName(item.effectiveIngredient ?? item.originalIngredient);
  if (normalizedName(row.normalized_name ?? row.ingredient_name) !== expectedName) {
    return { status: 'invalid_items' };
  }
  if (row.expiration_date && new Date(row.expiration_date).getTime() <= now.getTime()) {
    return { status: 'inventory_expired' };
  }
  const available = inventoryQuantity(row);
  if (
    available.value === null ||
    available.value <= 0 ||
    !canCompareUnits(available.unit, requestedUnit)
  ) {
    return { status: 'incompatible_units' };
  }
  const requestedInInventory = quantityInUnit(item.quantity, requestedUnit, available.unit);
  if (requestedInInventory === null) return { status: 'incompatible_units' };
  if (requestedInInventory > available.value + 0.000001)
    return { status: 'inventory_insufficient' };
  return { row, quantity: requestedInInventory, unit: available.unit, available: available.value };
}

function validateItems(
  inputs: RealConsumptionItemInput[],
  ingredients: SnapshotIngredient[]
): boolean {
  if (inputs.length !== ingredients.length) return false;
  const expected = new Map(
    ingredients.map((ingredient) => [normalizedName(ingredient.name), ingredient])
  );
  const seen = new Set<string>();
  for (const item of inputs) {
    const key = normalizedName(item.originalIngredient);
    if (!key || seen.has(key) || !expected.has(key)) return false;
    seen.add(key);
    if (!['used', 'omitted', 'unknown', 'substituted'].includes(item.outcome)) return false;
    if (item.outcome === 'used' || item.outcome === 'substituted') {
      if (
        item.quantity === null ||
        !item.unit ||
        !item.effectiveIngredient ||
        !item.inventoryItemId
      )
        return false;
    } else if (
      item.quantity !== null ||
      item.unit ||
      item.inventoryItemId ||
      item.effectiveIngredient
    ) {
      return false;
    }
    if (item.outcome === 'substituted') {
      if (!item.substituteIngredient || !item.substituteInventoryItemId) return false;
      if (
        normalizedName(item.substituteIngredient) !== normalizedName(item.effectiveIngredient ?? '')
      )
        return false;
      if (normalizedName(item.substituteIngredient) === key) return false;
      if (item.substituteInventoryItemId !== item.inventoryItemId) return false;
    } else if (item.outcome === 'used' && normalizedName(item.effectiveIngredient ?? '') !== key) {
      return false;
    } else if (item.substituteIngredient || item.substituteInventoryItemId) {
      return false;
    }
  }
  return seen.size === expected.size;
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

async function hasLegacyConsumption(
  client: DbTransactionClient,
  input: ReconcileRealConsumptionInput,
  session: CookingSessionRow
): Promise<boolean> {
  const result = await client.query<{ consumption_payload: unknown }>(
    `select consumption_payload from public.user_meal_plans
      where id = $1 and tenant_id = $2 and user_id = $3
      for update`,
    [session.meal_plan_id, input.tenantId, input.userId]
  );
  const payload = result.rows[0]?.consumption_payload;
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    `${session.day_index}:${session.meal_type}` in (payload as object)
  );
}

export async function reconcileRealConsumptionInTransaction(
  client: DbTransactionClient,
  input: ReconcileRealConsumptionInput,
  now = new Date()
): Promise<RealConsumptionResult> {
  await setRlsContext(client, input.tenantId, input.userId);
  const requestHash = hashPayload({
    sessionId: input.sessionId,
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    confirmed: input.confirmed,
    items: input.items,
  });
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
  if (!ingredients || !validateItems(input.items, ingredients)) return { status: 'invalid_items' };
  if (await hasLegacyConsumption(client, input, session))
    return { status: 'legacy_already_claimed' };

  const existingClaim = await getSlotClaim(client, input, session);
  if (existingClaim) {
    return {
      status: existingClaim.mode === 'planned_legacy' ? 'legacy_already_claimed' : 'conflict',
    };
  }

  const inventories = new Map<
    string,
    { row: RecipeInventoryItemRow; quantity: number; unit: NormalizedUnit; available: number }
  >();
  const usedInventoryIds = new Set<string>();
  for (const item of input.items) {
    if (item.outcome !== 'used' && item.outcome !== 'substituted') continue;
    if (!item.inventoryItemId || usedInventoryIds.has(item.inventoryItemId)) {
      return { status: 'invalid_items' };
    }
    const checked = await validateInventory(client, input, item, now);
    if ('status' in checked) return checked;
    inventories.set(item.inventoryItemId, checked);
    usedInventoryIds.add(item.inventoryItemId);
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
    originalIngredient: string;
    outcome: RealConsumptionOutcome;
    quantityStatus: 'known' | 'unknown';
  }> = [];
  for (const item of input.items) {
    const quantityStatus = item.quantity === null ? 'unknown' : 'known';
    const inventory = item.inventoryItemId ? (inventories.get(item.inventoryItemId) ?? null) : null;
    const storedQuantity = inventory?.quantity ?? null;
    const storedUnit = inventory?.unit ?? null;
    const itemResult = await client.query<{ id: string }>(
      `insert into public.real_consumption_items
        (operation_id, tenant_id, user_id, original_ingredient, normalized_original_ingredient,
         outcome, effective_ingredient, normalized_effective_ingredient, quantity, unit,
         quantity_status, inventory_item_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
      const nextQuantity = Number((inventory.available - inventory.quantity).toFixed(4));
      const nextStoredQuantity = formatStoredInventoryQuantity(
        nextQuantity,
        inventory.row.unit,
        inventory.unit
      );
      await client.query(
        `update public.recipe_inventory_items
            set quantity = $1, updated_at = now()
          where id = $2 and tenant_id = $3 and user_id = $4`,
        [nextStoredQuantity, inventory.row.id, input.tenantId, input.userId]
      );
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
  return transaction((client) => reconcileRealConsumptionInTransaction(client, input)).catch(
    (error: unknown) => {
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
    }
  );
}

export async function listReconciliationInventory(
  tenantId: string,
  userId: string
): Promise<ReconciliationInventoryOption[]> {
  return transaction(async (client) => {
    await setRlsContext(client, tenantId, userId);
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
  // The legacy consumption caller locks the plan first; immutable claims do
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

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import type { ShoppingListItemRow } from '@/lib/db/types';
import { findMealPlanByIdForUserAndTenant } from '@/lib/db/repositories/mealPlanRepository';
import { listInventoryItemsByTenant } from '@/lib/db/repositories/inventoryRepository';
import {
  addMealPlanShoppingItems,
  listShoppingListItems,
} from '@/lib/db/repositories/shoppingListRepository';
import { buildQuantifiedShoppingList } from '@/lib/inventory/meal-plan-projection';
import { structuredMealPlanToRequirements } from '@/lib/inventory/structured-meal-requirements';
import { ShoppingListIdSchema } from '@/lib/validation';
import {
  parseStructuredMealPlanValue,
  type StructuredMealPlan,
} from '@/lib/meal-planner/structured-plan';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';

const MAX_SELECTED_ITEMS = 100;
const MAX_NORMALIZED_NAME_LENGTH = 200;

function getActionableCandidates(
  plan: StructuredMealPlan,
  inventoryItems: Awaited<ReturnType<typeof listInventoryItemsByTenant>>
) {
  return buildQuantifiedShoppingList(structuredMealPlanToRequirements(plan), inventoryItems)
    .groups.flatMap((group) => group.items)
    .filter((item) => item.status === 'buy' || item.status === 'review');
}

function parseConfirmationBody(
  value: unknown
): { mealPlanId: string; selectedItems: string[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== 'mealPlanId' && key !== 'selectedItems')) return null;
  if (
    typeof body.mealPlanId !== 'string' ||
    !ShoppingListIdSchema.safeParse(body.mealPlanId).success
  ) return null;
  if (
    !Array.isArray(body.selectedItems) ||
    body.selectedItems.length < 1 ||
    body.selectedItems.length > MAX_SELECTED_ITEMS
  ) return null;
  if (!body.selectedItems.every((name) =>
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= MAX_NORMALIZED_NAME_LENGTH &&
    normalizeInventoryName(name) === name
  )) return null;
  return { mealPlanId: body.mealPlanId, selectedItems: body.selectedItems as string[] };
}

export async function GET(request: NextRequest) {
  let user: AuthUser;
  try {
    user = await requireUser(request);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!user.tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mealPlanId = new URL(request.url).searchParams.get('mealPlanId');
  if (!mealPlanId || !ShoppingListIdSchema.safeParse(mealPlanId).success) {
    return NextResponse.json({ error: 'Identificador de menú inválido.' }, { status: 400 });
  }

  let persistedPlan;
  try {
    persistedPlan = await findMealPlanByIdForUserAndTenant(
      mealPlanId,
      user.id,
      user.tenant.tenantId
    );
  } catch {
    return NextResponse.json({ error: 'No se pudo recuperar el menú.' }, { status: 500 });
  }

  if (!persistedPlan) {
    return NextResponse.json({ error: 'Menú no encontrado.' }, { status: 404 });
  }

  if (
    persistedPlan.period !== 'week' &&
    persistedPlan.period !== 'fortnight' &&
    persistedPlan.period !== 'month'
  ) {
    return NextResponse.json({ error: 'No se pudo recuperar el menú.' }, { status: 500 });
  }

  const parsedPlan = parseStructuredMealPlanValue(persistedPlan.calendar_payload, persistedPlan.period);
  if (!parsedPlan.success) {
    return NextResponse.json({ error: 'No se pudo recuperar el menú.' }, { status: 500 });
  }

  try {
    const [inventoryItems, shoppingItems] = await Promise.all([
      listInventoryItemsByTenant(user.tenant.tenantId),
      listShoppingListItems(user.tenant.tenantId, user.id),
    ]);
    const existingByName = new Map(
      shoppingItems
        .filter((item) => item.source === `meal-plan:${mealPlanId}`)
        .map((item) => [normalizeInventoryName(item.ingredient_name), item])
    );
    const items = getActionableCandidates(parsedPlan.plan, inventoryItems)
      .map((item) => {
        const existing = existingByName.get(item.normalizedName);
        return {
          normalizedName: item.normalizedName,
          ingredientName: item.ingredientName,
          requiredQuantity: item.requiredQuantity,
          availableQuantity: item.availableQuantity,
          quantityToBuy: item.quantityToBuy,
          unit: item.unit,
          status: item.status,
          usedInRecipes: item.usedInRecipes,
          estimatedCost: item.estimatedCost,
          alreadyPresent: Boolean(existing),
          shoppingStatus: existing?.status ?? null,
        };
      });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: 'No se pudieron calcular las sugerencias.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let user: AuthUser;
  try {
    user = await requireUser(request);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!user.tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }
  const body = parseConfirmationBody(rawBody);
  if (!body) return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });

  let persistedPlan;
  try {
    persistedPlan = await findMealPlanByIdForUserAndTenant(
      body.mealPlanId,
      user.id,
      user.tenant.tenantId
    );
  } catch {
    return NextResponse.json({ error: 'No se pudo recuperar el menú.' }, { status: 500 });
  }
  if (!persistedPlan) return NextResponse.json({ error: 'Menú no encontrado.' }, { status: 404 });
  if (
    persistedPlan.period !== 'week' &&
    persistedPlan.period !== 'fortnight' &&
    persistedPlan.period !== 'month'
  ) return NextResponse.json({ error: 'No se pudo recuperar el menú.' }, { status: 500 });

  const parsedPlan = parseStructuredMealPlanValue(persistedPlan.calendar_payload, persistedPlan.period);
  if (!parsedPlan.success) return NextResponse.json({ error: 'No se pudo recuperar el menú.' }, { status: 500 });

  try {
    const inventoryItems = await listInventoryItemsByTenant(user.tenant.tenantId);
    const candidates = getActionableCandidates(parsedPlan.plan, inventoryItems);
    const candidateByName = new Map(candidates.map((candidate) => [candidate.normalizedName, candidate]));
    const matched = new Set(body.selectedItems.filter((name) => candidateByName.has(name)));
    const ignored = body.selectedItems.filter((name) => !candidateByName.has(name));
    const selectedCandidates = candidates.filter((candidate) => matched.has(candidate.normalizedName));
    const result = selectedCandidates.length === 0
      ? { added: [], alreadyPresent: [] }
      : await addMealPlanShoppingItems({
          tenantId: user.tenant.tenantId,
          userId: user.id,
          source: `meal-plan:${body.mealPlanId}`,
          items: selectedCandidates.map((candidate) => ({
            ingredientName: candidate.ingredientName,
            quantity: typeof candidate.quantityToBuy === 'number' &&
                Number.isFinite(candidate.quantityToBuy) && candidate.unit !== 'unknown'
              ? `${Number(candidate.quantityToBuy.toFixed(3))} ${candidate.unit}`
              : null,
          })),
        });
    return NextResponse.json({
      added: result.added.map(toConfirmationItem),
      alreadyPresent: result.alreadyPresent.map(toConfirmationItem),
      ignored,
    });
  } catch {
    return NextResponse.json({ error: 'No se pudieron guardar los artículos seleccionados.' }, { status: 500 });
  }
}

function toConfirmationItem(row: ShoppingListItemRow) {
  return {
    id: row.id,
    ingredient_name: row.ingredient_name,
    quantity: row.quantity,
    status: row.status,
  };
}

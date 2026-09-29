import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import { findMealPlanByIdForUserAndTenant } from '@/lib/db/repositories/mealPlanRepository';
import { listInventoryItemsByTenant } from '@/lib/db/repositories/inventoryRepository';
import { buildQuantifiedShoppingList } from '@/lib/inventory/meal-plan-projection';
import { structuredMealPlanToRequirements } from '@/lib/inventory/structured-meal-requirements';
import { ShoppingListIdSchema } from '@/lib/validation';
import { parseStructuredMealPlanValue } from '@/lib/meal-planner/structured-plan';

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
    const inventoryItems = await listInventoryItemsByTenant(user.tenant.tenantId);
    const list = buildQuantifiedShoppingList(
      structuredMealPlanToRequirements(parsedPlan.plan),
      inventoryItems
    );
    const items = list.groups
      .flatMap((group) => group.items)
      .filter((item) => item.status === 'buy' || item.status === 'review')
      .map((item) => ({
        normalizedName: item.normalizedName,
        ingredientName: item.ingredientName,
        requiredQuantity: item.requiredQuantity,
        availableQuantity: item.availableQuantity,
        quantityToBuy: item.quantityToBuy,
        unit: item.unit,
        status: item.status,
        usedInRecipes: item.usedInRecipes,
        estimatedCost: item.estimatedCost,
      }));
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: 'No se pudieron calcular las sugerencias.' }, { status: 500 });
  }
}

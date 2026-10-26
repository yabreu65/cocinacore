import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import { listInventoryItemsByTenant } from '@/lib/db/repositories/inventoryRepository';
import { findLatestMealPlanByUserAndTenant } from '@/lib/db/repositories/mealPlanRepository';
import { serverLogger } from '@/lib/serverLogger';
import {
  buildMealPlanCoverageForecast,
  createUnknownMealPlanCoverageForecast,
} from '@/lib/meal-planner/coverage-forecast';
import { parseStructuredMealPlanValue } from '@/lib/meal-planner/structured-plan';

function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  let user: AuthUser;
  try {
    user = await requireUser(request);
  } catch {
    serverLogger.warn('meal_plan.coverage_unauthorized', { requestId });
    return unauthorizedResponse();
  }
  if (!user.tenant) {
    serverLogger.warn('meal_plan.coverage_unauthorized', { requestId });
    return unauthorizedResponse();
  }

  const rawHorizon = new URL(request.url).searchParams.get('horizonDays');
  if (rawHorizon !== '7' && rawHorizon !== '14') {
    return NextResponse.json({ error: 'El horizonte debe ser de 7 o 14 días.' }, { status: 400 });
  }
  const horizonDays = Number(rawHorizon);
  const tenantId = user.tenant.tenantId;

  let persistedPlan;
  try {
    persistedPlan = await findLatestMealPlanByUserAndTenant(user.id, tenantId);
  } catch {
    serverLogger.warn('meal_plan.coverage_plan_lookup_failed', { requestId });
    return NextResponse.json({ error: 'No se pudo recuperar el menú guardado.' }, { status: 500 });
  }
  if (!persistedPlan) {
    return NextResponse.json({
      mealPlanId: null,
      peopleCount: null,
      forecast: createUnknownMealPlanCoverageForecast(horizonDays, 'no_saved_plan'),
    });
  }
  if (persistedPlan.tenant_id !== tenantId || persistedPlan.user_id !== user.id) {
    serverLogger.warn('meal_plan.coverage_scope_mismatch', { requestId });
    return NextResponse.json({ error: 'No se encontró un menú guardado.' }, { status: 404 });
  }

  const parsedPlan = parseStructuredMealPlanValue(
    persistedPlan.calendar_payload,
    persistedPlan.period
  );
  if (!parsedPlan.success) {
    serverLogger.warn('meal_plan.coverage_invalid_plan', {
      requestId,
      mealPlanId: persistedPlan.id,
      reason: parsedPlan.reason,
    });
    return NextResponse.json({ error: 'El menú guardado no tiene un formato válido.' }, { status: 409 });
  }
  if (!parsedPlan.plan.schedule) {
    return NextResponse.json({
      mealPlanId: persistedPlan.id,
      peopleCount: persistedPlan.people_count,
      forecast: createUnknownMealPlanCoverageForecast(horizonDays, 'schedule_not_confirmed'),
    });
  }
  if (
    !parsedPlan.plan.schedule.portionConfirmation ||
    parsedPlan.plan.schedule.portionConfirmation.peopleCount !== persistedPlan.people_count
  ) {
    return NextResponse.json({
      mealPlanId: persistedPlan.id,
      peopleCount: persistedPlan.people_count,
      forecast: createUnknownMealPlanCoverageForecast(
        horizonDays,
        'portion_basis_not_confirmed',
        parsedPlan.plan.schedule.timeZone
      ),
    });
  }

  let inventoryItems;
  try {
    inventoryItems = await listInventoryItemsByTenant(tenantId);
  } catch {
    serverLogger.warn('meal_plan.coverage_inventory_lookup_failed', { requestId });
    return NextResponse.json({ error: 'No se pudo recuperar el inventario.' }, { status: 500 });
  }

  const forecast = buildMealPlanCoverageForecast({
    plan: parsedPlan.plan,
    inventoryItems: inventoryItems
      .filter((item) => item.tenant_id === tenantId)
      .map((item) => ({
        ingredient_name: item.ingredient_name,
        quantity: item.quantity,
        unit: item.unit,
      })),
    consumptionPayload: persistedPlan.consumption_payload,
    horizonDays,
    now: new Date(),
  });

  return NextResponse.json({
    mealPlanId: persistedPlan.id,
    peopleCount: persistedPlan.people_count,
    forecast,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import { listInventoryItemsByTenant } from '@/lib/db/repositories/inventoryRepository';
import { findMealPlanByIdForUserAndTenant } from '@/lib/db/repositories/mealPlanRepository';
import {
  findCulinaryProfileByUserId,
  findCulinaryProfileTermsByUserId,
} from '@/lib/db/repositories/culinaryProfileRepository';
import { serverLogger } from '@/lib/serverLogger';
import { containsRestrictedIngredientName } from '@/lib/recipes/structured-ingredients';
import {
  buildAdaptiveMealPlanProposal,
  structuredMealPlanFingerprint,
} from '@/lib/meal-planner/adaptive-planning';
import { buildPersistedMealPlanProfileContext } from '@/lib/meal-planner/profile-context';
import { parseStructuredMealPlanValue } from '@/lib/meal-planner/structured-plan';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

async function readMealPlanId(request: NextRequest): Promise<string | null> {
  try {
    const body = (await request.json()) as { mealPlanId?: unknown };
    return typeof body.mealPlanId === 'string' && body.mealPlanId.trim().length <= 100
      ? body.mealPlanId.trim()
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  let user: AuthUser;
  try {
    user = await requireUser(request);
  } catch {
    return unauthorized();
  }
  if (!user.tenant) return unauthorized();

  const mealPlanId = await readMealPlanId(request);
  if (!mealPlanId) {
    return NextResponse.json({ error: 'El menú requerido no es válido.' }, { status: 400 });
  }

  let persistedPlan;
  try {
    persistedPlan = await findMealPlanByIdForUserAndTenant(
      mealPlanId,
      user.id,
      user.tenant.tenantId
    );
  } catch {
    serverLogger.warn('meal_plan.adaptive_lookup_failed', { requestId });
    return NextResponse.json({ error: 'No se pudo recuperar el menú.' }, { status: 500 });
  }
  if (!persistedPlan)
    return NextResponse.json({ error: 'No se encontró el menú.' }, { status: 404 });

  const parsedPlan = parseStructuredMealPlanValue(
    persistedPlan.calendar_payload,
    persistedPlan.period
  );
  if (!parsedPlan.success) {
    return NextResponse.json(
      { error: 'El menú guardado no tiene un formato válido.' },
      { status: 409 }
    );
  }

  try {
    const [inventoryItems, profileRow, profileTerms] = await Promise.all([
      listInventoryItemsByTenant(user.tenant.tenantId),
      findCulinaryProfileByUserId(user.id),
      findCulinaryProfileTermsByUserId(user.id),
    ]);
    const profile = buildPersistedMealPlanProfileContext(
      profileRow,
      profileTerms,
      user.id,
      user.tenant.tenantId
    );
    const hardRestrictions = [...(profile?.allergies ?? []), ...(profile?.avoid ?? [])];
    const storedIngredientNames = parsedPlan.plan.days.flatMap((day) =>
      day.meals.flatMap((meal) => meal.ingredients.map((ingredient) => ingredient.name))
    );
    if (containsRestrictedIngredientName(storedIngredientNames, hardRestrictions)) {
      return NextResponse.json(
        {
          error: 'El menú ya no cumple las restricciones persistidas. Generá un menú nuevo.',
          code: 'MEAL_PLAN_RESTRICTIONS_CHANGED',
        },
        { status: 409 }
      );
    }
    const proposal = buildAdaptiveMealPlanProposal({
      plan: parsedPlan.plan,
      inventoryItems: inventoryItems.filter((item) => item.tenant_id === user.tenant!.tenantId),
      profile,
      consumptionPayload: persistedPlan.consumption_payload,
      now: new Date(),
    });
    return NextResponse.json({
      mealPlanId: persistedPlan.id,
      expectedUpdatedAt: persistedPlan.updated_at,
      sourceFingerprint: structuredMealPlanFingerprint(parsedPlan.plan),
      proposal,
    });
  } catch {
    serverLogger.warn('meal_plan.adaptive_failed', { requestId });
    return NextResponse.json(
      { error: 'No se pudo preparar una propuesta segura.' },
      { status: 500 }
    );
  }
}

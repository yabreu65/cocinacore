import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import {
  findMealPlanByIdForUserAndTenant,
  replaceMealPlanForAdaptiveProposal,
} from '@/lib/db/repositories/mealPlanRepository';
import { serverLogger } from '@/lib/serverLogger';
import {
  findCulinaryProfileByUserId,
  findCulinaryProfileTermsByUserId,
} from '@/lib/db/repositories/culinaryProfileRepository';
import { containsRestrictedIngredientName } from '@/lib/recipes/structured-ingredients';
import { buildPersistedMealPlanProfileContext } from '@/lib/meal-planner/profile-context';
import {
  structuredMealPlanFingerprint,
  validateAdaptivePlanReplacement,
} from '@/lib/meal-planner/adaptive-planning';
import {
  parseStructuredMealPlanValue,
  renderStructuredMealPlan,
} from '@/lib/meal-planner/structured-plan';
import { ShoppingListIdSchema } from '@/lib/validation';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

type ConfirmationBody = {
  mealPlanId?: unknown;
  expectedUpdatedAt?: unknown;
  sourceFingerprint?: unknown;
  proposedPlan?: unknown;
};

async function readBody(request: NextRequest): Promise<ConfirmationBody | null> {
  try {
    const body = (await request.json()) as ConfirmationBody;
    return body && typeof body === 'object' ? body : null;
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

  const body = await readBody(request);
  if (
    !body ||
    typeof body.mealPlanId !== 'string' ||
    !ShoppingListIdSchema.safeParse(body.mealPlanId).success ||
    typeof body.expectedUpdatedAt !== 'string' ||
    typeof body.sourceFingerprint !== 'string' ||
    !body.proposedPlan
  ) {
    return NextResponse.json(
      { error: 'La confirmación de propuesta no es válida.' },
      { status: 400 }
    );
  }

  const current = await findMealPlanByIdForUserAndTenant(
    body.mealPlanId,
    user.id,
    user.tenant.tenantId
  );
  if (!current) return NextResponse.json({ error: 'No se encontró el menú.' }, { status: 404 });

  const sourceParsed = parseStructuredMealPlanValue(current.calendar_payload, current.period);
  const proposedParsed = parseStructuredMealPlanValue(body.proposedPlan, current.period);
  if (!sourceParsed.success || !proposedParsed.success) {
    return NextResponse.json(
      { error: 'La propuesta no tiene un formato válido.' },
      { status: 400 }
    );
  }
  if (
    current.updated_at !== body.expectedUpdatedAt ||
    structuredMealPlanFingerprint(sourceParsed.plan) !== body.sourceFingerprint
  ) {
    return NextResponse.json(
      { error: 'La propuesta quedó desactualizada. Prepará una nueva propuesta.' },
      { status: 409 }
    );
  }

  const safe = validateAdaptivePlanReplacement(
    sourceParsed.plan,
    proposedParsed.plan,
    current.consumption_payload
  );
  if (!safe.valid) {
    return NextResponse.json({ error: 'La propuesta no es segura para guardar.' }, { status: 400 });
  }

  const [profileRow, profileTerms] = await Promise.all([
    findCulinaryProfileByUserId(user.id),
    findCulinaryProfileTermsByUserId(user.id),
  ]);
  const profile = buildPersistedMealPlanProfileContext(
    profileRow,
    profileTerms,
    user.id,
    user.tenant.tenantId
  );
  const proposedIngredientNames = proposedParsed.plan.days.flatMap((day) =>
    day.meals.flatMap((meal) => meal.ingredients.map((ingredient) => ingredient.name))
  );
  if (
    containsRestrictedIngredientName(proposedIngredientNames, [
      ...(profile?.allergies ?? []),
      ...(profile?.avoid ?? []),
    ])
  ) {
    return NextResponse.json(
      { error: 'Las restricciones cambiaron. Prepará una nueva propuesta.' },
      { status: 409 }
    );
  }

  const updated = await replaceMealPlanForAdaptiveProposal({
    mealPlanId: current.id,
    userId: user.id,
    tenantId: user.tenant.tenantId,
    expectedUpdatedAt: body.expectedUpdatedAt,
    expectedCalendarPayload: current.calendar_payload,
    structuredPlan: proposedParsed.plan,
  });
  if (!updated) {
    serverLogger.warn('meal_plan.adaptive_conflict', {
      requestId,
      mealPlanId: current.id,
    });
    return NextResponse.json(
      { error: 'El menú cambió mientras confirmabas. Prepará una nueva propuesta.' },
      { status: 409 }
    );
  }

  return NextResponse.json({
    id: updated.id,
    updatedAt: updated.updated_at,
    plan: proposedParsed.plan,
    content: renderStructuredMealPlan(proposedParsed.plan),
  });
}

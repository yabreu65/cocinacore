import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import {
  attachRecipeToMealPlanSlot,
  type AttachRecipeToMealPlanSlotResult,
} from '@/lib/db/repositories/mealPlanRepository';
import { validateRequest } from '@/lib/validation';
import type { StructuredMealType } from '@/lib/meal-planner/structured-plan';
import { serverLogger } from '@/lib/serverLogger';

const SelectionRequestSchema = z
  .object({
    mealPlanId: z.string().uuid(),
    dayIndex: z.number().int().min(1).max(30),
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    recipeId: z.string().uuid(),
    versionId: z.string().uuid(),
    expectedUpdatedAt: z.string().min(1).max(100),
    expectedCalendarPayload: z.record(z.string(), z.unknown()),
    confirmed: z.literal(true),
  })
  .strict();

function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function resultResponse(
  result: AttachRecipeToMealPlanSlotResult,
  input: z.infer<typeof SelectionRequestSchema>
) {
  switch (result.status) {
    case 'applied':
    case 'already_applied':
      return NextResponse.json({
        status: result.status,
        mealPlanId: input.mealPlanId,
        dayIndex: input.dayIndex,
        mealType: input.mealType,
        recipeRef: { recipeId: input.recipeId, versionId: input.versionId },
      });
    case 'not_found':
    case 'recipe_not_found':
    case 'version_not_found':
      return NextResponse.json({ error: 'No se encontró el recurso solicitado.' }, { status: 404 });
    case 'schedule_not_confirmed':
      return NextResponse.json(
        { error: 'La agenda y las porciones deben estar confirmadas.' },
        { status: 409 }
      );
    case 'slot_not_found':
      return NextResponse.json({ error: 'No se encontró el slot solicitado.' }, { status: 404 });
    case 'invalid_plan':
      return NextResponse.json(
        { error: 'El menú guardado no tiene un formato válido.' },
        { status: 409 }
      );
    case 'conflict':
      return NextResponse.json(
        {
          error: 'El menú cambió o el slot ya tiene otra receta.',
          code: 'MEAL_PLAN_SELECTION_CONFLICT',
        },
        { status: 409 }
      );
  }
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  let user: AuthUser;
  try {
    user = await requireUser(request);
  } catch {
    serverLogger.warn('meal_plan.recipe_selection_unauthorized', { requestId });
    return unauthorizedResponse();
  }
  if (!user.tenant) {
    serverLogger.warn('meal_plan.recipe_selection_tenant_missing', { requestId });
    return unauthorizedResponse();
  }

  const validation = await validateRequest(request, SelectionRequestSchema);
  if (!validation.success) {
    return NextResponse.json(validation.error.body, { status: validation.error.status });
  }

  const input = validation.data;
  let result: AttachRecipeToMealPlanSlotResult;
  try {
    result = await attachRecipeToMealPlanSlot({
      ...input,
      mealType: input.mealType as StructuredMealType,
      userId: user.id,
      tenantId: user.tenant.tenantId,
    });
  } catch {
    serverLogger.warn('meal_plan.recipe_selection_failed', {
      requestId,
      mealPlanId: input.mealPlanId,
    });
    return NextResponse.json({ error: 'No se pudo guardar la selección.' }, { status: 500 });
  }
  return resultResponse(result, input);
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import {
  createCookingSession,
  type CreateCookingSessionInput,
} from '@/lib/db/repositories/cookingSessionRepository';
import type { CookingSessionRow } from '@/lib/db/types';
import { validateRequest } from '@/lib/validation';
import type { StructuredMealType } from '@/lib/meal-planner/structured-plan';
import { serverLogger } from '@/lib/serverLogger';

const CookingSessionCreateSchema = z
  .object({
    mealPlanId: z.string().uuid(),
    dayIndex: z.number().int().min(1).max(30),
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    recipeId: z.string().uuid(),
    versionId: z.string().uuid(),
    expectedUpdatedAt: z.string().min(1).max(100),
    expectedCalendarPayload: z
      .record(z.string(), z.unknown())
      .refine((value) => JSON.stringify(value).length <= 250_000, 'Payload too large.'),
    idempotencyKey: z.string().trim().min(1).max(200),
    confirmed: z.literal(true),
  })
  .strict();

function publicSession(session: CookingSessionRow) {
  return {
    id: session.id,
    mealPlanId: session.meal_plan_id,
    dayIndex: session.day_index,
    mealType: session.meal_type,
    recipeId: session.recipe_id,
    versionId: session.recipe_version_id,
    status: session.status,
    currentStep: session.current_step,
    totalSteps: session.total_steps,
    instructionSnapshot: session.instruction_snapshot,
    version: session.version,
    startedAt: session.started_at,
    updatedAt: session.updated_at,
    completedAt: session.completed_at,
    cancelledAt: session.cancelled_at,
  };
}

function resultResponse(result: Awaited<ReturnType<typeof createCookingSession>>) {
  if (result.status === 'applied' || result.status === 'already_applied') {
    return NextResponse.json(
      { status: result.status, session: publicSession(result.session) },
      { status: result.status === 'applied' ? 201 : 200 }
    );
  }
  if (result.status === 'not_found')
    return NextResponse.json({ error: 'No se encontró el origen solicitado.' }, { status: 404 });
  if (result.status === 'invalid_plan')
    return NextResponse.json(
      { error: 'El menú no está listo para iniciar la sesión.' },
      { status: 409 }
    );
  return NextResponse.json(
    { error: 'El origen cambió o la sesión ya existe.', code: 'COOKING_SESSION_CONFLICT' },
    { status: 409 }
  );
}

async function authenticatedUser(request: NextRequest): Promise<AuthUser | NextResponse> {
  try {
    const user = await requireUser(request);
    return user.tenant ? user : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const loadedUser = await authenticatedUser(request);
  if (loadedUser instanceof NextResponse) return loadedUser;
  const validation = await validateRequest(request, CookingSessionCreateSchema);
  if (!validation.success)
    return NextResponse.json(validation.error.body, { status: validation.error.status });
  const input = validation.data;
  try {
    const result = await createCookingSession({
      ...input,
      mealType: input.mealType as StructuredMealType,
      userId: loadedUser.id,
      tenantId: loadedUser.tenant!.tenantId,
    } as CreateCookingSessionInput);
    return resultResponse(result);
  } catch {
    serverLogger.warn('cooking_session.create_failed', { requestId });
    return NextResponse.json({ error: 'No se pudo iniciar la sesión.' }, { status: 500 });
  }
}

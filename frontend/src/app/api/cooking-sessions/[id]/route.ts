import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import {
  getCookingSession,
  transitionCookingSession,
} from '@/lib/db/repositories/cookingSessionRepository';
import { validateRequest } from '@/lib/validation';
import { serverLogger } from '@/lib/serverLogger';

const TransitionSchema = z
  .object({
    action: z.enum(['pause', 'resume', 'advance', 'back', 'complete', 'cancel']),
    expectedVersion: z.number().int().min(1),
    idempotencyKey: z.string().trim().min(1).max(200),
    confirmed: z.literal(true),
  })
  .strict();

function publicSession(session: Awaited<ReturnType<typeof getCookingSession>>) {
  if (!session) return null;
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

async function authenticated(request: NextRequest) {
  try {
    const user = await requireUser(request);
    return user.tenant ? user : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await authenticated(request);
  if (!user?.tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success)
    return NextResponse.json({ error: 'Identificador inválido.' }, { status: 400 });
  try {
    const session = await getCookingSession(id, user.tenant.tenantId, user.id);
    if (!session) return NextResponse.json({ error: 'Sesión no encontrada.' }, { status: 404 });
    return NextResponse.json({ session: publicSession(session) });
  } catch {
    return NextResponse.json({ error: 'No se pudo recuperar la sesión.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const user = await authenticated(request);
  if (!user?.tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success)
    return NextResponse.json({ error: 'Identificador inválido.' }, { status: 400 });
  const validation = await validateRequest(request, TransitionSchema);
  if (!validation.success)
    return NextResponse.json(validation.error.body, { status: validation.error.status });
  try {
    const result = await transitionCookingSession({
      ...validation.data,
      sessionId: id,
      userId: user.id,
      tenantId: user.tenant.tenantId,
    });
    if (result.status === 'applied' || result.status === 'already_applied') {
      return NextResponse.json({ status: result.status, session: publicSession(result.session) });
    }
    if (result.status === 'not_found')
      return NextResponse.json({ error: 'Sesión no encontrada.' }, { status: 404 });
    if (result.status === 'invalid_transition' || result.status === 'step_boundary') {
      return NextResponse.json(
        { error: 'Transición no válida para el estado actual.' },
        { status: 409 }
      );
    }
    if (result.status === 'restrictions_changed')
      return NextResponse.json({ error: 'Las restricciones cambiaron o la receta requiere revisión. No continúes sin revisarla.', code: 'COOKING_RESTRICTIONS_REVIEW_REQUIRED' }, { status: 409 });
    if (result.status === 'source_conflict')
      return NextResponse.json(
        { error: 'El origen de la sesión cambió.', code: 'COOKING_SESSION_SOURCE_CONFLICT' },
        { status: 409 }
      );
    return NextResponse.json(
      { error: 'La sesión cambió; recargá e intentá de nuevo.', code: 'COOKING_SESSION_CONFLICT' },
      { status: 409 }
    );
  } catch {
    serverLogger.warn('cooking_session.transition_failed', { requestId });
    return NextResponse.json({ error: 'No se pudo actualizar la sesión.' }, { status: 500 });
  }
}

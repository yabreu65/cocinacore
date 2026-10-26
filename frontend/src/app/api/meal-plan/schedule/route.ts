import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import {
  findMealPlanByIdForUserAndTenant,
  updateMealPlanScheduleForUserAndTenant,
} from '@/lib/db/repositories/mealPlanRepository';
import { serverLogger } from '@/lib/serverLogger';
import { validateRequest } from '@/lib/validation';
import {
  getLocalDateInTimeZone,
  parseStructuredMealPlanSchedule,
  parseStructuredMealPlanValue,
} from '@/lib/meal-planner/structured-plan';

const ScheduleRequestSchema = z
  .object({
    mealPlanId: z.string().trim().min(1).max(100),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timeZone: z.string().trim().min(1).max(100),
    confirmed: z.literal(true),
    portionBasisConfirmed: z.literal(true),
  })
  .strict();

function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  let user: AuthUser;
  try {
    user = await requireUser(request);
  } catch {
    serverLogger.warn('meal_plan.schedule_unauthorized', { requestId });
    return unauthorizedResponse();
  }
  if (!user.tenant) {
    serverLogger.warn('meal_plan.schedule_unauthorized', { requestId });
    return unauthorizedResponse();
  }

  const validation = await validateRequest(request, ScheduleRequestSchema);
  if (!validation.success) {
    return NextResponse.json(validation.error.body, { status: validation.error.status });
  }

  const { mealPlanId, startDate, timeZone } = validation.data;
  const now = new Date();
  const schedule = parseStructuredMealPlanSchedule({
    startDate,
    timeZone,
    confirmedAt: now.toISOString(),
  });
  const today = schedule ? getLocalDateInTimeZone(now, schedule.timeZone) : null;
  if (!schedule || !today || schedule.startDate < today) {
    return NextResponse.json(
      { error: 'Elegí una fecha válida, hoy o futura, y confirmá la agenda.' },
      { status: 400 }
    );
  }

  let persistedPlan;
  try {
    persistedPlan = await findMealPlanByIdForUserAndTenant(
      mealPlanId,
      user.id,
      user.tenant.tenantId
    );
  } catch {
    serverLogger.warn('meal_plan.schedule_lookup_failed', { requestId });
    return NextResponse.json({ error: 'No se pudo recuperar el menú guardado.' }, { status: 500 });
  }
  if (
    !persistedPlan ||
    persistedPlan.tenant_id !== user.tenant.tenantId ||
    persistedPlan.user_id !== user.id
  ) {
    return NextResponse.json({ error: 'No se encontró un menú guardado.' }, { status: 404 });
  }

  const parsedPlan = parseStructuredMealPlanValue(
    persistedPlan.calendar_payload,
    persistedPlan.period
  );
  if (!parsedPlan.success) {
    serverLogger.warn('meal_plan.schedule_invalid_plan', {
      requestId,
      mealPlanId,
      reason: parsedPlan.reason,
    });
    return NextResponse.json(
      { error: 'El menú guardado no tiene un formato válido.' },
      { status: 409 }
    );
  }

  const confirmedSchedule = parseStructuredMealPlanSchedule({
    ...schedule,
    portionConfirmation: {
      peopleCount: persistedPlan.people_count,
      confirmedAt: now.toISOString(),
    },
  });
  if (!confirmedSchedule) {
    return NextResponse.json({ error: 'La agenda no tiene un formato válido.' }, { status: 400 });
  }

  const scheduledPlan = parseStructuredMealPlanValue(
    { ...parsedPlan.plan, schedule: confirmedSchedule },
    persistedPlan.period
  );
  if (!scheduledPlan.success || !scheduledPlan.plan.schedule) {
    return NextResponse.json({ error: 'La agenda no tiene un formato válido.' }, { status: 400 });
  }

  let updatedPlan;
  try {
    updatedPlan = await updateMealPlanScheduleForUserAndTenant({
      mealPlanId,
      userId: user.id,
      tenantId: user.tenant.tenantId,
      schedule: scheduledPlan.plan.schedule,
    });
  } catch {
    serverLogger.warn('meal_plan.schedule_update_failed', { requestId, mealPlanId });
    return NextResponse.json({ error: 'No se pudo guardar la agenda.' }, { status: 500 });
  }
  if (!updatedPlan) {
    return NextResponse.json({ error: 'No se encontró un menú guardado.' }, { status: 404 });
  }

  const confirmedPlan = parseStructuredMealPlanValue(
    updatedPlan.calendar_payload,
    updatedPlan.period
  );
  if (!confirmedPlan.success || !confirmedPlan.plan.schedule?.portionConfirmation) {
    serverLogger.warn('meal_plan.schedule_update_invalid_result', { requestId, mealPlanId });
    return NextResponse.json({ error: 'No se pudo validar la agenda guardada.' }, { status: 500 });
  }

  return NextResponse.json({
    mealPlanId: updatedPlan.id,
    schedule: confirmedPlan.plan.schedule,
  });
}

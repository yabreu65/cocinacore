import { NextRequest, NextResponse } from 'next/server';
import { serverLogger } from '@/lib/serverLogger';
import { hydrateMealPlanWarmup, type WarmupMealPlanInput } from '@/lib/meal-planner/recipe-warmup';
import { isWarmupQueueEnabled, runMealPlanWarmupJob } from '@/lib/queue/meal-plan-warmup';
import { validateRequest, MealPlanWarmupSchema, type MealPlanWarmupBody } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  // 1. Zod validation
  const validation = await validateRequest(request, MealPlanWarmupSchema);
  if (!validation.success) {
    return Response.json(validation.error.body, { status: validation.error.status });
  }

  const body: MealPlanWarmupBody = validation.data;

  // 2. Rate limit
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rateLimit = await checkRateLimit('meal-plan/warmup', ip);
  if (!rateLimit.success) {
    return Response.json(
      { error: 'Rate limit exceeded', retryAfter: rateLimit.resetAt },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.resetAt),
          'X-RateLimit-Limit': String(rateLimit.limit),
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(rateLimit.resetAt),
        },
      }
    );
  }

  // Calendar and targetDays are validated as non-empty arrays by Zod;
  // cast to unknown[] then rely on WarmupMealPlanInput's runtime handling.
  const calendar = (body.calendar ?? []) as unknown[];
  const targetDays = (body.targetDays ?? []) as unknown[];
  const raw = body as Record<string, unknown>;
  const inventory = Array.isArray(raw.inventory) ? (raw.inventory as unknown[]) : [];

  if (calendar.length === 0 || targetDays.length === 0) {
    return NextResponse.json(
      { error: 'Warmup inválido: faltan datos del calendario o días objetivo.' },
      { status: 400 }
    );
  }

  try {
    const normalizedInput = {
      ...body,
      origin: new URL(request.url).origin,
      calendar,
      targetDays,
      inventory,
    } as WarmupMealPlanInput;

    const result = isWarmupQueueEnabled()
      ? await runMealPlanWarmupJob(normalizedInput)
      : await hydrateMealPlanWarmup(normalizedInput);

    if (!result) {
      return NextResponse.json(
        { error: 'No se pudo iniciar el warmup inteligente.' },
        { status: 500 }
      );
    }

    serverLogger.info('meal_plan_warmup.success', {
      requestId,
      durationMs: Date.now() - startedAt,
      targetDays: targetDays.length,
      warmedSlots: result.warmedSlots,
      failed: result.failed,
    });

    return NextResponse.json(result);
  } catch (error) {
    serverLogger.error('meal_plan_warmup.failed', {
      requestId,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Warmup error desconocido',
    });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'No se pudo completar el warmup.',
      },
      { status: 500 }
    );
  }
}

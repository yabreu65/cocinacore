import { NextRequest, NextResponse } from 'next/server';
import { serverLogger } from '@/lib/serverLogger';
import { hydrateMealPlanWarmup, type WarmupMealPlanInput } from '@/lib/meal-planner/recipe-warmup';
import { isWarmupQueueEnabled, runMealPlanWarmupJob } from '@/lib/queue/meal-plan-warmup';
import { validateRequest, MealPlanWarmupSchema, type MealPlanWarmupBody } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rate-limit';
import { getRetryAfterSeconds, getTrustedClientIdentity } from '@/lib/rate-limit-identity';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  let user: AuthUser;
  try {
    user = await requireUser(request);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!user.tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 1. Zod validation
  const validation = await validateRequest(request, MealPlanWarmupSchema);
  if (!validation.success) {
    return Response.json(validation.error.body, { status: validation.error.status });
  }

  const body: MealPlanWarmupBody = validation.data;

  // 2. Rate limit
  const rateLimit = await checkRateLimit(
    'meal-plan/warmup',
    user.id || getTrustedClientIdentity(request),
    user.id,
    { requireSharedStore: true }
  );
  if (!rateLimit.success) {
    const retryAfter = getRetryAfterSeconds(rateLimit.resetAt);
    const storageUnavailable = rateLimit.storage === 'unavailable';
    return Response.json(
      {
        error: storageUnavailable
          ? 'El warmup no está disponible temporalmente.'
          : 'Rate limit exceeded',
        retryAfter,
      },
      {
        status: storageUnavailable ? 503 : 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(rateLimit.limit),
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(rateLimit.resetAt),
        },
      }
    );
  }

  const targetDays = body.targetDays;

  try {
    const requestUrl = new URL(request.url);
    const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    const origin = configuredOrigin
      ? new URL(configuredOrigin).origin
      : ['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname)
        ? requestUrl.origin
        : null;
    if (!origin) {
      return NextResponse.json(
        { error: 'El warmup no está configurado para este origen.' },
        { status: 503 }
      );
    }
    const normalizedInput: WarmupMealPlanInput = {
      ...body,
      origin,
      actorUserId: user.id,
      actorTenantId: user.tenant.tenantId,
      warmupRequestId: crypto.randomUUID(),
    };

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
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return NextResponse.json({ error: 'No se pudo completar el warmup.' }, { status: 500 });
  }
}

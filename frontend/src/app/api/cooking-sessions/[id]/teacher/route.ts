import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getGeminiApiKey } from '@/lib/ai/gemini-config';
import { loadCookingTeacherContext } from '@/lib/cooking-teacher-context';
import {
  CookingTeacherQuestionSchema,
  createCookingTeacherProvider,
  toCookingTeacherKnowledgeReference,
  type CookingTeacherResponse,
} from '@/lib/cooking-teacher';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import { checkRateLimit } from '@/lib/rate-limit';
import { retrieveServerRagContext } from '@/lib/recipes/server-rag-context';
import { serverLogger } from '@/lib/serverLogger';
import { getRetryAfterSeconds } from '@/lib/rate-limit-identity';
import {
  startCookingTeacherBudget,
  CookingTeacherBudgetExceededError,
  assertCookingTeacherBudget,
} from '@/lib/cooking-teacher-budget';

const TeacherRequestSchema = z
  .object({
    question: CookingTeacherQuestionSchema,
  })
  .strict();

const uuidSchema = z.string().uuid();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const budget = startCookingTeacherBudget(request.signal);
  try {
    let user: AuthUser;
    try {
      user = await requireUser(request, 'Unauthorized', {
        signal: budget.controller.signal,
        deadlineAt: budget.deadlineAt,
      });
    } catch (error) {
      if (budget.controller.signal.aborted || budget.deadlineAt <= Date.now()) throw error;
      if (error instanceof Error && error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      throw error;
    }
    assertCookingTeacherBudget(budget.deadlineAt, budget.controller.signal);
    if (!user.tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await context.params;
    assertCookingTeacherBudget(budget.deadlineAt, budget.controller.signal);
    if (!uuidSchema.safeParse(id).success) {
      return NextResponse.json({ error: 'Identificador inválido.' }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
    }
    assertCookingTeacherBudget(budget.deadlineAt, budget.controller.signal);
    const parsed = TeacherRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'La pregunta no cumple el contrato del profesor.' },
        { status: 400 }
      );
    }

    const userRateLimit = await checkRateLimit('cooking-teacher-user', user.id, undefined, {
      requireSharedStore: true,
      signal: budget.controller.signal,
      deadlineAt: budget.deadlineAt,
    });
    assertCookingTeacherBudget(budget.deadlineAt, budget.controller.signal);
    const tenantRateLimit = userRateLimit.success
      ? await checkRateLimit('cooking-teacher-tenant', user.tenant.tenantId, undefined, {
          requireSharedStore: true,
          signal: budget.controller.signal,
          deadlineAt: budget.deadlineAt,
        })
      : userRateLimit;
    assertCookingTeacherBudget(budget.deadlineAt, budget.controller.signal);
    const rateLimit = userRateLimit.success ? tenantRateLimit : userRateLimit;
    if (!rateLimit.success) {
      const retryAfter = getRetryAfterSeconds(rateLimit.resetAt);
      const storageUnavailable = rateLimit.storage === 'unavailable';
      return NextResponse.json(
        {
          error: storageUnavailable
            ? 'El profesor no está disponible temporalmente.'
            : 'Límite de consultas alcanzado.',
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

    const teacherContext = await loadCookingTeacherContext(id, user.tenant.tenantId, user.id, {
      signal: budget.controller.signal,
      deadlineAt: budget.deadlineAt,
    });
    if (!teacherContext)
      return NextResponse.json({ error: 'Sesión no encontrada.' }, { status: 404 });
    if (teacherContext.restrictions.status === 'blocked') {
      return NextResponse.json({
        response: {
          kind: 'safe_refusal',
          answer:
            'No puedo confirmar la seguridad de esta preparación porque las reglas deterministas detectaron una restricción aplicable. Revisá la receta antes de continuar.',
          evidence: 'unknown',
          citations: [],
          limitations: teacherContext.restrictions.reasons,
          sessionMutation: 'none',
        } satisfies CookingTeacherResponse,
      });
    }

    const apiKey = getGeminiApiKey();
    const provider = createCookingTeacherProvider();
    if (!apiKey || !provider) {
      return NextResponse.json(
        { error: 'El profesor no está disponible temporalmente.' },
        { status: 503 }
      );
    }

    const rag = await retrieveServerRagContext({
      apiKey,
      tenantId: user.tenant.tenantId,
      userId: user.id,
      ingredients: teacherContext.ingredients.map((ingredient) => ingredient.name),
      recipeName: teacherContext.recipe.title,
      mealType: teacherContext.session.mealType,
      restrictions: {
        allergies: teacherContext.restrictions.allergies,
        dietaryRules: teacherContext.restrictions.avoids,
      },
      signal: budget.controller.signal,
      deadlineAt: budget.deadlineAt,
    });
    const authorizedCitations = rag.citations
      .map(toCookingTeacherKnowledgeReference)
      .filter((citation): citation is NonNullable<typeof citation> => citation !== null);
    const response = await provider.answer({
      context: {
        ...teacherContext,
        knowledgeReferences: authorizedCitations,
      },
      question: parsed.data.question,
      ragContext: rag.context,
      citations: authorizedCitations,
      signal: budget.controller.signal,
      deadlineAt: budget.deadlineAt,
    });
    if (response.kind === 'provider_unavailable') {
      return NextResponse.json(
        { error: 'El profesor no está disponible temporalmente.' },
        { status: 503 }
      );
    }
    return NextResponse.json({ response });
  } catch (error) {
    serverLogger.warn('cooking_teacher.request_failed', {
      requestId,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    const timedOut =
      error instanceof CookingTeacherBudgetExceededError ||
      budget.controller.signal.aborted ||
      budget.deadlineAt <= Date.now();
    return NextResponse.json(
      { error: 'El profesor no está disponible temporalmente.' },
      { status: timedOut ? 504 : 503 }
    );
  } finally {
    budget.dispose();
  }
}

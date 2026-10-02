import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import {
  consumePlannedMeal,
  getMealPlanConsumptions,
  MealPlanConsumptionError,
} from '@/lib/db/repositories/mealPlanConsumptionRepository';
import { ShoppingListIdSchema } from '@/lib/validation';
import type { StructuredMealType } from '@/lib/meal-planner/structured-plan';

const MEAL_TYPES: StructuredMealType[] = ['breakfast', 'lunch', 'dinner'];

function parseBody(value: unknown): {
  mealPlanId: string;
  dayIndex: number;
  mealType: StructuredMealType;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['mealPlanId', 'dayIndex', 'mealType'].includes(key))) return null;
  if (typeof body.mealPlanId !== 'string' || !ShoppingListIdSchema.safeParse(body.mealPlanId).success) return null;
  if (typeof body.dayIndex !== 'number' || !Number.isInteger(body.dayIndex) || body.dayIndex < 1 || body.dayIndex > 30) return null;
  if (typeof body.mealType !== 'string' || !MEAL_TYPES.includes(body.mealType as StructuredMealType)) return null;
  return body as { mealPlanId: string; dayIndex: number; mealType: StructuredMealType };
}

async function authenticatedUser(request: NextRequest): Promise<AuthUser | null> {
  try {
    const user = await requireUser(request);
    return user.tenant ? user : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const user = await authenticatedUser(request);
  if (!user?.tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const mealPlanId = new URL(request.url).searchParams.get('mealPlanId');
  if (!mealPlanId || !ShoppingListIdSchema.safeParse(mealPlanId).success) {
    return NextResponse.json({ error: 'Identificador de menú inválido.' }, { status: 400 });
  }

  try {
    const consumptions = await getMealPlanConsumptions(mealPlanId, user.id, user.tenant.tenantId);
    if (!consumptions) return NextResponse.json({ error: 'Menú no encontrado.' }, { status: 404 });
    return NextResponse.json({ consumptions });
  } catch {
    return NextResponse.json({ error: 'No se pudo recuperar el consumo del menú.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await authenticatedUser(request);
  if (!user?.tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rawBody: unknown = await request.json().catch(() => null);
  const body = parseBody(rawBody);
  if (!body) return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });

  try {
    const result = await consumePlannedMeal({
      ...body,
      tenantId: user.tenant.tenantId,
      userId: user.id,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MealPlanConsumptionError) {
      if (error.code === 'not_found') {
        return NextResponse.json({ error: 'Menú no encontrado.' }, { status: 404 });
      }
      if (error.code === 'invalid_meal') {
        return NextResponse.json({ error: 'Comida inválida para este menú.' }, { status: 400 });
      }
    }
    return NextResponse.json({ error: 'No se pudo registrar la comida cocinada.' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import type { ShoppingListItemRow } from '@/lib/db/types';
import { findMealPlanByIdForUserAndTenant } from '@/lib/db/repositories/mealPlanRepository';
import { listInventoryItemsByTenant } from '@/lib/db/repositories/inventoryRepository';
import {
  addMealPlanShoppingItems,
  listShoppingListItems,
} from '@/lib/db/repositories/shoppingListRepository';
import { ShoppingListIdSchema } from '@/lib/validation';
import {
  parseStructuredMealPlanValue,
  type StructuredMealPlan,
} from '@/lib/meal-planner/structured-plan';
import {
  buildPredictiveShoppingProposal,
  type PredictiveShoppingProposal,
} from '@/lib/meal-planner/predictive-shopping';

const MAX_SELECTED_ITEMS = 100;
const MAX_SOURCE_ROWS = 500;
const MAX_FINGERPRINT_LENGTH = 128;

function parseHorizon(value: string | null): 7 | 14 | null {
  if (value === null || value === '7') return 7;
  if (value === '14') return 14;
  return null;
}

function parseConfirmationBody(value: unknown): {
  mealPlanId: string;
  horizonDays: 7 | 14;
  selectedItems: string[];
  expectedUpdatedAt: string;
  expectedFingerprint: string;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const expectedUpdatedAt = body.expectedUpdatedAt;
  const expectedFingerprint = body.expectedFingerprint;
  const horizonDays = body.horizonDays;
  if (
    Object.keys(body).some(
      (key) =>
        ![
          'mealPlanId',
          'horizonDays',
          'selectedItems',
          'expectedUpdatedAt',
          'expectedFingerprint',
        ].includes(key)
    )
  )
    return null;
  if (
    typeof body.mealPlanId !== 'string' ||
    !ShoppingListIdSchema.safeParse(body.mealPlanId).success ||
    (horizonDays !== 7 && horizonDays !== 14) ||
    typeof expectedUpdatedAt !== 'string' ||
    expectedUpdatedAt.length < 1 ||
    expectedUpdatedAt.length > 100 ||
    typeof expectedFingerprint !== 'string' ||
    expectedFingerprint.length < 1 ||
    expectedFingerprint.length > MAX_FINGERPRINT_LENGTH ||
    !/^[a-f0-9]+$/i.test(expectedFingerprint)
  )
    return null;
  if (
    !Array.isArray(body.selectedItems) ||
    body.selectedItems.length < 1 ||
    body.selectedItems.length > MAX_SELECTED_ITEMS ||
    !body.selectedItems.every(
      (name) => typeof name === 'string' && name.length > 0 && name.length <= 200
    )
  )
    return null;
  return {
    mealPlanId: body.mealPlanId,
    horizonDays,
    selectedItems: Array.from(new Set(body.selectedItems as string[])),
    expectedUpdatedAt,
    expectedFingerprint,
  };
}

function isSourceBounded<T>(rows: T[]): boolean {
  return rows.length <= MAX_SOURCE_ROWS;
}

async function loadProposalInputs(
  tenantId: string,
  userId: string,
  plan: StructuredMealPlan,
  consumptionPayload: unknown,
  horizonDays: 7 | 14,
  now: Date
) {
  const [inventoryItems, shoppingItems] = await Promise.all([
    listInventoryItemsByTenant(tenantId, MAX_SOURCE_ROWS + 1),
    listShoppingListItems(tenantId, userId, {}, MAX_SOURCE_ROWS + 1),
  ]);
  if (!isSourceBounded(inventoryItems) || !isSourceBounded(shoppingItems)) {
    return { truncated: true as const };
  }
  return {
    truncated: false as const,
    proposal: buildPredictiveShoppingProposal({
      plan,
      inventoryItems,
      shoppingItems,
      consumptionPayload,
      horizonDays,
      now,
    }),
  };
}

function quantityForShopping(item: PredictiveShoppingProposal['items'][number]): string | null {
  if (item.quantityToBuy === null || item.unit === 'unknown') return null;
  const rounded = Number(item.quantityToBuy.toFixed(4));
  return Number.isFinite(rounded) && rounded > 0 ? `${rounded} ${item.unit}` : null;
}

function toConfirmationItem(row: ShoppingListItemRow) {
  return {
    id: row.id,
    ingredient_name: row.ingredient_name,
    quantity: row.quantity,
    status: row.status,
  };
}

function unknownSourceResponse() {
  return NextResponse.json(
    { error: 'La propuesta excede el límite seguro de datos consultables.' },
    { status: 409 }
  );
}

export async function GET(request: NextRequest) {
  let user: AuthUser;
  try {
    user = await requireUser(request);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!user.tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const searchParams = new URL(request.url).searchParams;
  const mealPlanId = searchParams.get('mealPlanId');
  const horizonDays = parseHorizon(searchParams.get('horizon'));
  if (!mealPlanId || !ShoppingListIdSchema.safeParse(mealPlanId).success || horizonDays === null) {
    return NextResponse.json({ error: 'Identificador u horizonte inválido.' }, { status: 400 });
  }

  let persistedPlan;
  try {
    persistedPlan = await findMealPlanByIdForUserAndTenant(
      mealPlanId,
      user.id,
      user.tenant.tenantId
    );
  } catch {
    return NextResponse.json({ error: 'No se pudo recuperar el menú.' }, { status: 500 });
  }
  if (!persistedPlan) return NextResponse.json({ error: 'Menú no encontrado.' }, { status: 404 });

  const parsedPlan = parseStructuredMealPlanValue(
    persistedPlan.calendar_payload,
    persistedPlan.period
  );
  if (!parsedPlan.success) {
    return NextResponse.json({ error: 'No se pudo recuperar el menú.' }, { status: 500 });
  }

  try {
    const loaded = await loadProposalInputs(
      user.tenant.tenantId,
      user.id,
      parsedPlan.plan,
      persistedPlan.consumption_payload,
      horizonDays,
      new Date()
    );
    if (loaded.truncated) return unknownSourceResponse();
    return NextResponse.json({
      mealPlanId: persistedPlan.id,
      expectedUpdatedAt: persistedPlan.updated_at,
      ...loaded.proposal,
    });
  } catch {
    return NextResponse.json(
      { error: 'No se pudieron calcular las sugerencias.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let user: AuthUser;
  try {
    user = await requireUser(request);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!user.tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }
  const body = parseConfirmationBody(rawBody);
  if (!body) return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });

  let persistedPlan;
  try {
    persistedPlan = await findMealPlanByIdForUserAndTenant(
      body.mealPlanId,
      user.id,
      user.tenant.tenantId
    );
  } catch {
    return NextResponse.json({ error: 'No se pudo recuperar el menú.' }, { status: 500 });
  }
  if (!persistedPlan) return NextResponse.json({ error: 'Menú no encontrado.' }, { status: 404 });

  const parsedPlan = parseStructuredMealPlanValue(
    persistedPlan.calendar_payload,
    persistedPlan.period
  );
  if (!parsedPlan.success) {
    return NextResponse.json({ error: 'No se pudo recuperar el menú.' }, { status: 500 });
  }

  try {
    const loaded = await loadProposalInputs(
      user.tenant.tenantId,
      user.id,
      parsedPlan.plan,
      persistedPlan.consumption_payload,
      body.horizonDays,
      new Date()
    );
    if (loaded.truncated) return unknownSourceResponse();
    const proposal = loaded.proposal;
    if (
      proposal.status !== 'ready' ||
      persistedPlan.updated_at !== body.expectedUpdatedAt ||
      proposal.sourceFingerprint !== body.expectedFingerprint
    ) {
      return NextResponse.json(
        { error: 'La propuesta está desactualizada. Prepará una nueva propuesta.' },
        { status: 409 }
      );
    }

    const selected = new Set(body.selectedItems);
    const selectedCandidates = proposal.items.filter(
      (item) => selected.has(item.normalizedName) && item.status === 'buy'
    );
    const ignored = body.selectedItems.filter(
      (name) => !selectedCandidates.some((item) => item.normalizedName === name)
    );
    const result =
      selectedCandidates.length === 0
        ? { added: [], alreadyPresent: [] }
        : await addMealPlanShoppingItems({
            tenantId: user.tenant.tenantId,
            userId: user.id,
            source: `meal-plan:${body.mealPlanId}`,
            dedupeScope: 'user',
            items: selectedCandidates.map((item) => ({
              ingredientName: item.ingredientName,
              quantity: quantityForShopping(item),
            })),
          });
    return NextResponse.json({
      added: result.added.map(toConfirmationItem),
      alreadyPresent: result.alreadyPresent.map(toConfirmationItem),
      ignored,
    });
  } catch {
    return NextResponse.json(
      { error: 'No se pudieron guardar los artículos seleccionados.' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import type { ShoppingListItemRow } from '@/lib/db/types';
import { withShoppingProposalSource } from '@/lib/db/repositories/shoppingProposalRepository';
import { addMealPlanShoppingItemsInTransaction } from '@/lib/db/repositories/shoppingListRepository';
import { equalPostgresTimestamps } from '@/lib/db/postgres-timestamp';
import { ShoppingListIdSchema } from '@/lib/validation';
import type { PredictiveShoppingProposal } from '@/lib/meal-planner/predictive-shopping';

const MAX_SELECTED_ITEMS = 100;

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
    !equalPostgresTimestamps(expectedUpdatedAt, expectedUpdatedAt) ||
    typeof expectedFingerprint !== 'string' ||
    expectedFingerprint.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(expectedFingerprint)
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

  try {
    return await withShoppingProposalSource(
      { tenantId: user.tenant.tenantId, userId: user.id },
      mealPlanId,
      horizonDays,
      (_client, source) => {
        if (source.status === 'not_found')
          return NextResponse.json({ error: 'Menú no encontrado.' }, { status: 404 });
        if (source.status === 'invalid_plan')
          return NextResponse.json({ error: 'No se pudo recuperar el menú.' }, { status: 500 });
        if (source.status === 'truncated') return unknownSourceResponse();
        return NextResponse.json({
          mealPlanId: source.plan.id,
          expectedUpdatedAt: source.plan.updated_at,
          ...source.proposal,
        });
      }
    );
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

  try {
    const scope = { tenantId: user.tenant.tenantId, userId: user.id };
    return await withShoppingProposalSource(
      scope,
      body.mealPlanId,
      body.horizonDays,
      async (client, source) => {
        if (source.status === 'not_found')
          return NextResponse.json({ error: 'Menú no encontrado.' }, { status: 404 });
        if (source.status === 'invalid_plan')
          return NextResponse.json({ error: 'No se pudo recuperar el menú.' }, { status: 500 });
        if (source.status === 'truncated') return unknownSourceResponse();
        const proposal = source.proposal;
        if (
          proposal.status !== 'ready' ||
          !equalPostgresTimestamps(source.plan.updated_at, body.expectedUpdatedAt) ||
          (proposal.sourceFingerprint !== body.expectedFingerprint &&
            source.legacyFingerprint !== body.expectedFingerprint)
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
            : await addMealPlanShoppingItemsInTransaction(client, {
                ...scope,
                source: `meal-plan:${source.plan.id}`,
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
      }
    );
  } catch {
    return NextResponse.json(
      { error: 'No se pudieron guardar los artículos seleccionados.' },
      { status: 500 }
    );
  }
}

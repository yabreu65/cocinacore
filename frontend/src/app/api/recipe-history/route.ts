import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import {
  listRecipeHistoryByTenant,
  deleteRecipeHistory,
  toggleRecipeSaved,
  updateRecipeFeedback,
} from '@/lib/db/repositories/recipeRepository';
import type { RecipeAiHistoryRow } from '@/lib/db/types';

type PublicRecipeHistoryItem = Pick<
  RecipeAiHistoryRow,
  'id' | 'recipe_title' | 'recipe_payload' | 'user_feedback' | 'created_at' | 'is_saved'
>;

function toPublicRecipeHistoryItem(row: RecipeAiHistoryRow): PublicRecipeHistoryItem {
  return {
    id: row.id,
    recipe_title: row.recipe_title,
    recipe_payload: row.recipe_payload,
    user_feedback: row.user_feedback,
    created_at: row.created_at,
    is_saved: row.is_saved,
  };
}

export async function GET(request: NextRequest) {
  const user = await requireUser();
  const tenant = user.tenant;
  if (!tenant) throw new Error('Tenant context required');
  const saved = request.nextUrl.searchParams.get('saved');
  if (saved !== null && saved !== 'true' && saved !== 'false') {
    return NextResponse.json({ error: 'Invalid saved filter' }, { status: 400 });
  }

  const items = await listRecipeHistoryByTenant(
    tenant.tenantId,
    {
      userId: user.id,
      ...(saved === 'true' ? { onlySaved: true } : {}),
    },
    { tenantId: tenant.tenantId, userId: user.id }
  );
  return NextResponse.json({ items: items.map(toPublicRecipeHistoryItem) });
}

export async function DELETE(request: NextRequest) {
  const user = await requireUser();
  const tenant = user.tenant;
  if (!tenant) throw new Error('Tenant context required');
  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'ID is required' }, { status: 400 });
  }

  try {
    const result = await deleteRecipeHistory(id, tenant.tenantId, user.id);
    if (result === 'linked') {
      return NextResponse.json({
        error: 'Esta propuesta está vinculada a una receta guardada. Conservamos el historial para mantener su procedencia.',
        code: 'RECIPE_HISTORY_LINKED',
      }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'No se pudo eliminar la propuesta del historial.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = await requireUser();
  const tenant = user.tenant;
  if (!tenant) throw new Error('Tenant context required');
  const id = request.nextUrl.searchParams.get('id');
  const feedback = request.nextUrl.searchParams.get('feedback');
  const saved = request.nextUrl.searchParams.get('saved');
  const hasFeedbackIntent = feedback !== null;
  const hasSavedIntent = saved !== null;

  if (!id || hasFeedbackIntent === hasSavedIntent) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  if (hasFeedbackIntent && feedback !== 'accepted' && feedback !== 'discarded') {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  if (hasSavedIntent && saved !== 'true' && saved !== 'false') {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  try {
    const updated =
      feedback !== null
        ? await updateRecipeFeedback(id, tenant.tenantId, user.id, feedback)
        : await toggleRecipeSaved(id, tenant.tenantId, user.id, saved === 'true');

    if (!updated) {
      return NextResponse.json({ error: 'Recipe history item not found' }, { status: 404 });
    }

    return NextResponse.json({ item: toPublicRecipeHistoryItem(updated) });
  } catch {
    return NextResponse.json({ error: 'Unable to update recipe history' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireTenant, requireUser } from '@/lib/auth/server';
import {
  listRecipeHistoryByTenant,
  deleteRecipeHistory,
  updateRecipeFeedback,
} from '@/lib/db/repositories/recipeRepository';

export async function GET() {
  const tenant = await requireTenant();
  const user = await requireUser();
  const items = await listRecipeHistoryByTenant(tenant.tenantId, { userId: user.id });
  return NextResponse.json({ items });
}

export async function DELETE(request: NextRequest) {
  const tenant = await requireTenant();
  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'ID is required' }, { status: 400 });
  }

  await deleteRecipeHistory(id, tenant.tenantId);
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest) {
  const tenant = await requireTenant();
  const id = request.nextUrl.searchParams.get('id');
  const feedback = request.nextUrl.searchParams.get('feedback');

  if (!id || (feedback !== 'accepted' && feedback !== 'discarded')) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  const updated = await updateRecipeFeedback(id, tenant.tenantId, feedback);
  return NextResponse.json({ item: updated });
}

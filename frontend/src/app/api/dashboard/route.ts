import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/server';
import { listInventoryItemsByTenant } from '@/lib/db/repositories/inventoryRepository';
import { listRecipeHistoryByTenant } from '@/lib/db/repositories/recipeRepository';
import { findCulinaryProfileByUserId } from '@/lib/db/repositories/culinaryProfileRepository';
import { findTenantById } from '@/lib/db/repositories/tenantRepository';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = user.tenant?.tenantId ?? null;
  const tenant = tenantId ? await findTenantById(tenantId) : null;

  const inventory = tenantId
    ? await listInventoryItemsByTenant(tenantId).then((items) =>
        items.slice(0, 10).map((item) => ({
          id: item.id,
          name: item.ingredient_name,
          quantity: item.quantity,
        }))
      )
    : [];

  const recentRecipes = tenantId
    ? await listRecipeHistoryByTenant(tenantId, { userId: user.id }).then((items) =>
        items.slice(0, 5).map((item) => ({
          id: item.id,
          title: item.recipe_title ?? 'Receta generada',
          createdAt: item.created_at,
          feedback: item.user_feedback,
        }))
      )
    : [];

  const profile = await findCulinaryProfileByUserId(user.id);

  return NextResponse.json({
    userId: user.id,
    fullName: user.fullName ?? '',
    tenantId,
    tenantType: tenant?.tenant_type ?? 'home',
    trialEndsAt: tenant?.trial_ends_at ?? null,
    inventory,
    recentRecipes,
    pdfCount: 0,
    latestPdfs: [],
    tenantBooks: [],
    culinaryProfile: {
      level: profile?.level ?? null,
      identity: [],
      preferred: [],
      avoid: [],
      goals: [],
    },
    activity: ['Dashboard cargado correctamente'],
  });
}

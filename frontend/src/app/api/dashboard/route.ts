import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/server';
import { listInventoryItemsByTenant } from '@/lib/db/repositories/inventoryRepository';
import {
  listPersistentRecipes,
  listRecipeHistoryByTenant,
} from '@/lib/db/repositories/recipeRepository';
import { findCulinaryProfileByUserId } from '@/lib/db/repositories/culinaryProfileRepository';
import { findTenantById } from '@/lib/db/repositories/tenantRepository';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = user.tenant?.tenantId ?? null;
  const tenant = tenantId
    ? await findTenantById(tenantId, undefined, undefined, { tenantId, userId: user.id })
    : null;

  const inventory = tenantId
    ? await listInventoryItemsByTenant(
        tenantId,
        undefined,
        undefined,
        {},
        {
          tenantId,
          userId: user.id,
        }
      ).then((items) =>
        items.slice(0, 10).map((item) => ({
          id: item.id,
          name: item.ingredient_name,
          quantity: item.quantity,
        }))
      )
    : [];

  const recentRecipes = tenantId
    ? await listRecipeHistoryByTenant(
        tenantId,
        { userId: user.id },
        { tenantId, userId: user.id }
      ).then((items) =>
        items.slice(0, 5).map((item) => ({
          id: item.id,
          title: item.recipe_title ?? 'Receta generada',
          createdAt: item.created_at,
          feedback: item.user_feedback,
        }))
      )
    : [];

  // A generated suggestion is not a saved recipe. The first-recipe milestone
  // must rely on the persistent, tenant-scoped recetario instead of AI history.
  const hasSavedRecipes = tenantId
    ? (await listPersistentRecipes({ tenantId, userId: user.id }, { limit: 1 })).length > 0
    : false;

  const profile = tenantId ? await findCulinaryProfileByUserId(user.id, tenantId) : null;

  return NextResponse.json({
    userId: user.id,
    fullName: user.fullName ?? '',
    onboardingCompleted: user.onboardingCompleted,
    tenantId,
    tenantType: tenant?.tenant_type ?? 'home',
    trialEndsAt: tenant?.trial_ends_at ?? null,
    inventory,
    recentRecipes,
    hasSavedRecipes,
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

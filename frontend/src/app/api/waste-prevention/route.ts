import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import {
  listWastePreventionInventoryByTenant,
  MAX_WASTE_PREVENTION_INVENTORY_LIMIT,
} from '@/lib/db/repositories/inventoryRepository';
import { listPersistentRecipes } from '@/lib/db/repositories/recipeRepository';
import {
  findCulinaryProfileByUserId,
  MAX_WASTE_PREVENTION_PROFILE_TERMS,
  listWastePreventionCulinaryProfileTermsByUserId,
} from '@/lib/db/repositories/culinaryProfileRepository';
import { serverLogger } from '@/lib/serverLogger';
import { buildWastePreventionReport } from '@/lib/waste-prevention';

const DEFAULT_TIME_ZONE = 'UTC';
const DEFAULT_DUE_SOON_DAYS = 5;

function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  let user: AuthUser;
  try {
    user = await requireUser(request);
  } catch {
    serverLogger.warn('waste_prevention.unauthorized', { requestId });
    return unauthorizedResponse();
  }
  const tenantId = user.tenant?.tenantId;
  if (!tenantId) {
    serverLogger.warn('waste_prevention.tenant_missing', { requestId });
    return unauthorizedResponse();
  }

  const params = new URL(request.url).searchParams;
  const timeZone = params.get('timeZone')?.trim() || DEFAULT_TIME_ZONE;
  if (!validTimeZone(timeZone)) {
    return NextResponse.json({ error: 'Invalid time zone' }, { status: 400 });
  }
  const rawDueSoonDays = params.get('dueSoonDays');
  const dueSoonDays = rawDueSoonDays === null ? DEFAULT_DUE_SOON_DAYS : Number(rawDueSoonDays);
  if (!Number.isInteger(dueSoonDays) || dueSoonDays < 1 || dueSoonDays > 14) {
    return NextResponse.json(
      { error: 'dueSoonDays must be an integer between 1 and 14' },
      { status: 400 }
    );
  }

  try {
    const [inventory, recipes, profile, terms] = await Promise.all([
      listWastePreventionInventoryByTenant(tenantId),
      listPersistentRecipes(
        { tenantId, userId: user.id },
        { archived: 'active', limit: 100, offset: 0, includeSentinel: true }
      ),
      findCulinaryProfileByUserId(user.id),
      listWastePreventionCulinaryProfileTermsByUserId(user.id),
    ]);
    if (inventory.length > MAX_WASTE_PREVENTION_INVENTORY_LIMIT || recipes.length > 100) {
      serverLogger.warn('waste_prevention.projection_truncated', { requestId });
      return NextResponse.json({ error: 'Unable to load waste prevention data' }, { status: 409 });
    }
    if (terms.length > MAX_WASTE_PREVENTION_PROFILE_TERMS) {
      serverLogger.warn('waste_prevention.profile_terms_truncated', { requestId });
      return NextResponse.json({ error: 'Unable to load waste prevention data' }, { status: 409 });
    }
    const profileScopeValid =
      !profile || (profile.user_id === user.id && profile.tenant_id === tenantId);
    if (!profileScopeValid) {
      serverLogger.warn('waste_prevention.profile_scope_mismatch', { requestId });
      return NextResponse.json({ error: 'Unable to load waste prevention data' }, { status: 409 });
    }
    const report = buildWastePreventionReport({
      now: new Date(),
      timeZone,
      windowDays: dueSoonDays,
      culinaryProfileConfigured: Boolean(profile),
      inventoryItems: inventory
        .filter((item) => item.tenant_id === tenantId)
        .map((item) => ({
          id: item.id,
          ingredient_name: item.ingredient_name,
          quantity: item.quantity,
          unit: item.unit,
          expiration_date: item.expiration_date,
        })),
      recipes: recipes
        .filter((recipe) => recipe.tenant_id === tenantId && recipe.user_id === user.id)
        .map((recipe) => ({
          id: recipe.id,
          title: recipe.current_version.title,
          ingredients: recipe.current_version.ingredients,
          archived_at: recipe.archived_at,
        })),
      allergies: profile?.allergies ?? [],
      hardAvoid: terms
        .filter((term) => term.preference_type === 'avoid')
        .map((term) => term.term_label),
      dislikedIngredients: profile?.disliked_ingredients ?? [],
    });

    return NextResponse.json({
      report,
      profileConfigured: Boolean(profile),
    });
  } catch {
    serverLogger.warn('waste_prevention.load_failed', { requestId });
    return NextResponse.json({ error: 'Unable to load waste prevention data' }, { status: 500 });
  }
}

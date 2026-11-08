import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import {
  listInventoryItemsByTenant,
  MAX_WASTE_PREVENTION_INVENTORY_LIMIT,
} from '@/lib/db/repositories/inventoryRepository';
import { findPersistentRecipeDetail } from '@/lib/db/repositories/recipeRepository';
import {
  findCulinaryProfileByUserId,
  listWastePreventionCulinaryProfileTermsByUserId,
  MAX_WASTE_PREVENTION_PROFILE_TERMS,
} from '@/lib/db/repositories/culinaryProfileRepository';
import { findMealPlanByIdForUserAndTenant } from '@/lib/db/repositories/mealPlanRepository';
import {
  parseStructuredMealPlanValue,
  type StructuredMealType,
} from '@/lib/meal-planner/structured-plan';
import {
  buildCookingIntentPreview,
  type CookingIntentSource,
  type CookingIntentMealSlot,
} from '@/lib/cooking-intent-preview';
import { PersistentRecipeIdSchema } from '@/lib/validation';
import { serverLogger } from '@/lib/serverLogger';

const DEFAULT_TIME_ZONE = 'UTC';
const MEAL_TYPES: readonly StructuredMealType[] = ['breakfast', 'lunch', 'dinner'];

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

function invalidRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

async function loadUser(request: NextRequest): Promise<AuthUser | NextResponse> {
  try {
    return await requireUser(request);
  } catch {
    return unauthorizedResponse();
  }
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const loadedUser = await loadUser(request);
  if (loadedUser instanceof NextResponse) {
    serverLogger.warn('cooking_intent_preview.unauthorized', { requestId });
    return loadedUser;
  }
  if (!loadedUser.tenant) {
    serverLogger.warn('cooking_intent_preview.tenant_missing', { requestId });
    return unauthorizedResponse();
  }

  const params = new URL(request.url).searchParams;
  const rawSource = params.get('source');
  const source: CookingIntentSource | null =
    rawSource === 'recipe'
      ? 'saved_recipe'
      : rawSource === 'meal_slot'
        ? 'confirmed_meal_slot'
        : null;
  if (!source) return invalidRequest('source must be recipe or meal_slot');

  const rawPortions = params.get('portions');
  const requestedPortions = rawPortions === null ? null : Number(rawPortions);
  if (
    rawPortions !== null &&
    (typeof requestedPortions !== 'number' ||
      !Number.isInteger(requestedPortions) ||
      requestedPortions < 1 ||
      requestedPortions > 100)
  ) {
    return invalidRequest('portions must be an integer between 1 and 100');
  }

  const requestedTimeZone = params.get('timeZone')?.trim() || null;
  if (requestedTimeZone && !validTimeZone(requestedTimeZone)) {
    return invalidRequest('Invalid time zone');
  }

  const tenantId = loadedUser.tenant.tenantId;
  let recipe: Awaited<ReturnType<typeof findPersistentRecipeDetail>> | undefined;
  let mealSlot: CookingIntentMealSlot | undefined;
  let timeZone = requestedTimeZone ?? DEFAULT_TIME_ZONE;

  try {
    if (source === 'saved_recipe') {
      const recipeId = params.get('recipeId') ?? '';
      if (!PersistentRecipeIdSchema.safeParse(recipeId).success) {
        return invalidRequest('Invalid recipe id');
      }
      recipe = await findPersistentRecipeDetail(recipeId, {
        tenantId,
        userId: loadedUser.id,
      });
      if (!recipe || recipe.archived_at) {
        return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
      }
    } else {
      const mealPlanId = params.get('mealPlanId') ?? '';
      const dayIndex = Number(params.get('dayIndex'));
      const mealType = params.get('mealType');
      if (!PersistentRecipeIdSchema.safeParse(mealPlanId).success) {
        return invalidRequest('Invalid meal plan id');
      }
      if (!Number.isInteger(dayIndex) || dayIndex < 1 || dayIndex > 30) {
        return invalidRequest('dayIndex must be an integer between 1 and 30');
      }
      if (!mealType || !MEAL_TYPES.includes(mealType as StructuredMealType)) {
        return invalidRequest('mealType is invalid');
      }
      const persistedPlan = await findMealPlanByIdForUserAndTenant(
        mealPlanId,
        loadedUser.id,
        tenantId
      );
      if (!persistedPlan) {
        return NextResponse.json({ error: 'Meal plan not found' }, { status: 404 });
      }
      const parsedPlan = parseStructuredMealPlanValue(
        persistedPlan.calendar_payload,
        persistedPlan.period
      );
      if (!parsedPlan.success || !parsedPlan.plan.schedule) {
        return NextResponse.json({ error: 'Meal plan schedule is not confirmed' }, { status: 409 });
      }
      if (
        !parsedPlan.plan.schedule.portionConfirmation ||
        parsedPlan.plan.schedule.portionConfirmation.peopleCount !== persistedPlan.people_count
      ) {
        return NextResponse.json(
          { error: 'Meal plan portions are not confirmed' },
          { status: 409 }
        );
      }
      const day = parsedPlan.plan.days.find((candidate) => candidate.dayIndex === dayIndex);
      const meal = day?.meals.find((candidate) => candidate.mealType === mealType);
      if (!meal) return NextResponse.json({ error: 'Meal slot not found' }, { status: 404 });
      timeZone = requestedTimeZone ?? parsedPlan.plan.schedule.timeZone;
      mealSlot = {
        mealPlan: persistedPlan,
        meal,
        dayIndex,
        timeZone,
      };
    }

    const [inventory, profile, terms] = await Promise.all([
      listInventoryItemsByTenant(
        tenantId,
        MAX_WASTE_PREVENTION_INVENTORY_LIMIT + 1,
        undefined,
        {},
        {
          tenantId,
          userId: loadedUser.id,
        }
      ),
      findCulinaryProfileByUserId(loadedUser.id, tenantId),
      listWastePreventionCulinaryProfileTermsByUserId(loadedUser.id, tenantId),
    ]);
    if (inventory.length > MAX_WASTE_PREVENTION_INVENTORY_LIMIT) {
      return NextResponse.json({ error: 'Unable to load bounded preview data' }, { status: 409 });
    }
    if (terms.length > MAX_WASTE_PREVENTION_PROFILE_TERMS) {
      return NextResponse.json({ error: 'Unable to load bounded preview data' }, { status: 409 });
    }
    if (profile && (profile.user_id !== loadedUser.id || profile.tenant_id !== tenantId)) {
      return NextResponse.json({ error: 'Unable to load preview data' }, { status: 409 });
    }
    if (terms.some((term) => term.user_id !== loadedUser.id)) {
      return NextResponse.json({ error: 'Unable to load preview data' }, { status: 409 });
    }

    const preview = buildCookingIntentPreview({
      source,
      recipe: recipe as Exclude<typeof recipe, null>,
      mealSlot,
      inventoryItems: inventory.filter((item) => item.tenant_id === tenantId),
      allergies: profile?.allergies ?? [],
      hardAvoid: terms
        .filter((term) => term.preference_type === 'avoid')
        .map((term) => term.term_label),
      profileConfigured: Boolean(profile),
      now: new Date(),
      timeZone,
      requestedPortions,
    });

    return NextResponse.json({ preview });
  } catch {
    serverLogger.warn('cooking_intent_preview.load_failed', { requestId, source });
    return NextResponse.json({ error: 'Unable to load cooking preview' }, { status: 500 });
  }
}

import { listInventoryItemsByTenant } from '@/lib/db/repositories/inventoryRepository';
import {
  findCulinaryProfileByUserId,
  findCulinaryProfileTermsByUserId,
} from '@/lib/db/repositories/culinaryProfileRepository';
import { buildMealPlanInventoryContext } from '@/lib/meal-planner/inventory-context';
import {
  buildPersistedMealPlanProfileContext,
  formatPersistedMealPlanProfileContext,
  type PersistedMealPlanProfileContext,
} from '@/lib/meal-planner/profile-context';

const RECIPE_INVENTORY_MAX_LINES = 30;
const RECIPE_INVENTORY_MAX_CHARS = 6000;
const RECIPE_INVENTORY_NAMES_MAX_ITEMS = 12;

export const EMPTY_PERSISTED_INVENTORY_MARKER = 'Sin inventario persistido para este hogar.';

export interface PersistedRecipeContext {
  inventoryLines: string[];
  inventoryContext: string;
  inventoryNames: string[];
  profile: PersistedMealPlanProfileContext | null;
  profileContext: string;
}

function boundInventoryLines(lines: readonly string[]): string[] {
  const bounded: string[] = [];
  let totalChars = 0;

  for (const line of lines) {
    if (bounded.length >= RECIPE_INVENTORY_MAX_LINES) break;

    const nextLength = totalChars + (bounded.length > 0 ? 1 : 0) + line.length;
    if (nextLength > RECIPE_INVENTORY_MAX_CHARS) break;

    bounded.push(line);
    totalChars = nextLength;
  }

  return bounded;
}

function inventoryNameFromLine(line: string): string | null {
  const match = /^- (.+?): /.exec(line);
  return match?.[1] ?? null;
}

export async function loadPersistedRecipeContext(
  userId: string,
  tenantId: string
): Promise<PersistedRecipeContext> {
  const [items, profile, terms] = await Promise.all([
    listInventoryItemsByTenant(tenantId),
    findCulinaryProfileByUserId(userId),
    findCulinaryProfileTermsByUserId(userId),
  ]);

  const inventoryLines = boundInventoryLines(buildMealPlanInventoryContext(items, tenantId));
  const persistedProfile = buildPersistedMealPlanProfileContext(profile, terms, userId, tenantId);

  return {
    inventoryLines,
    inventoryContext: inventoryLines.join('\n') || EMPTY_PERSISTED_INVENTORY_MARKER,
    inventoryNames: inventoryLines
      .map(inventoryNameFromLine)
      .filter((name): name is string => Boolean(name))
      .slice(0, RECIPE_INVENTORY_NAMES_MAX_ITEMS),
    profile: persistedProfile,
    profileContext: formatPersistedMealPlanProfileContext(persistedProfile),
  };
}

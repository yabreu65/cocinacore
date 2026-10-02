import type { RecipeInventoryItemRow } from '@/lib/db/types';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';

export const MEAL_PLAN_INVENTORY_CONTEXT_MAX_ITEMS = 120;

const MEAL_PLAN_INVENTORY_CONTEXT_MAX_FIELD_LENGTH = 200;

function normalizePromptField(value: string | null): string | null {
  if (!value) return null;

  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, MEAL_PLAN_INVENTORY_CONTEXT_MAX_FIELD_LENGTH) : null;
}

export function buildMealPlanInventoryContext(
  items: RecipeInventoryItemRow[],
  tenantId: string
): string[] {
  const lines: string[] = [];

  for (const item of items) {
    if (item.tenant_id !== tenantId) continue;

    const name = normalizeInventoryName(item.ingredient_name).slice(
      0,
      MEAL_PLAN_INVENTORY_CONTEXT_MAX_FIELD_LENGTH
    );
    if (!name) continue;

    const quantity = normalizePromptField(item.quantity);
    const unit = normalizePromptField(item.unit);
    const quantityLabel = quantity ?? 'cantidad no especificada';

    lines.push(`- ${name}: ${quantityLabel}${unit ? ` ${unit}` : ''}`);
    if (lines.length === MEAL_PLAN_INVENTORY_CONTEXT_MAX_ITEMS) break;
  }

  return lines;
}

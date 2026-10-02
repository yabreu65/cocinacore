import { describe, expect, it } from 'vitest';
import type { RecipeInventoryItemRow } from '@/lib/db/types';
import {
  buildMealPlanInventoryContext,
  MEAL_PLAN_INVENTORY_CONTEXT_MAX_ITEMS,
} from './inventory-context';

function inventoryItem(overrides: Partial<RecipeInventoryItemRow> = {}): RecipeInventoryItemRow {
  return {
    id: 'item-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    ingredient_name: 'Arroz',
    quantity: null,
    unit: null,
    category: null,
    expiration_date: null,
    estimated_unit_price: null,
    purchase_location: null,
    low_stock_threshold: null,
    normalized_name: null,
    notes: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildMealPlanInventoryContext', () => {
  it('returns no lines for empty inventory', () => {
    expect(buildMealPlanInventoryContext([], 'tenant-1')).toEqual([]);
  });

  it('includes available quantity and unit, and marks missing quantity explicitly', () => {
    const lines = buildMealPlanInventoryContext(
      [
        inventoryItem({ ingredient_name: '  Arroz   Integral ', quantity: ' 2 ', unit: ' kg ' }),
        inventoryItem({ id: 'item-2', ingredient_name: 'Lentejas', unit: 'taza' }),
      ],
      'tenant-1'
    );

    expect(lines).toEqual([
      '- arroz integral: 2 kg',
      '- lentejas: cantidad no especificada taza',
    ]);
  });

  it('keeps only exact authenticated-tenant rows in repository order', () => {
    const lines = buildMealPlanInventoryContext(
      [
        inventoryItem({ id: 'first', ingredient_name: 'Tomate' }),
        inventoryItem({ id: 'other', tenant_id: 'tenant-2', ingredient_name: 'No incluir' }),
        inventoryItem({ id: 'blank', ingredient_name: '   ' }),
        inventoryItem({ id: 'second', ingredient_name: 'Cebolla' }),
      ],
      'tenant-1'
    );

    expect(lines).toEqual([
      '- tomate: cantidad no especificada',
      '- cebolla: cantidad no especificada',
    ]);
  });

  it('bounds the number of items and every displayed field deterministically', () => {
    const oversizedName = `  ${'N'.repeat(250)}  `;
    const oversizedQuantity = `  ${'2'.repeat(250)}  `;
    const oversizedUnit = `  ${'U'.repeat(250)}  `;
    const items = Array.from({ length: MEAL_PLAN_INVENTORY_CONTEXT_MAX_ITEMS + 1 }, (_, index) =>
      inventoryItem({
        id: `item-${index}`,
        ingredient_name: index === 0 ? oversizedName : `Ingrediente ${index}`,
        quantity: index === 0 ? oversizedQuantity : null,
        unit: index === 0 ? oversizedUnit : null,
      })
    );

    const lines = buildMealPlanInventoryContext(items, 'tenant-1');

    expect(lines).toHaveLength(MEAL_PLAN_INVENTORY_CONTEXT_MAX_ITEMS);
    expect(lines[0]).toBe(`- ${'n'.repeat(200)}: ${'2'.repeat(200)} ${'U'.repeat(200)}`);
    expect(lines.at(-1)).toBe('- ingrediente 119: cantidad no especificada');
  });
});

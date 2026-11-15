import { describe, expect, it } from 'vitest';
import type { RecipeInventoryItemRow, ShoppingListItemRow } from '@/lib/db/types';
import {
  buildPredictiveShoppingProposal,
  createPredictiveShoppingFingerprint,
  createLegacyUtcShoppingFingerprint,
} from './predictive-shopping';
import type { StructuredMealPlan } from './structured-plan';

const now = new Date('2026-10-27T15:00:00.000Z');

function plan(overrides: Partial<StructuredMealPlan> = {}): StructuredMealPlan {
  return {
    period: 'fortnight',
    dayCount: 14,
    schedule: {
      startDate: '2026-10-27',
      timeZone: 'America/Caracas',
      confirmedAt: '2026-10-27T12:00:00.000Z',
      portionConfirmation: {
        peopleCount: 2,
        confirmedAt: '2026-10-27T12:00:00.000Z',
      },
    },
    days: Array.from({ length: 14 }, (_, index) => ({
      dayIndex: index + 1,
      label: `Día ${index + 1}`,
      meals: [
        {
          mealType: 'breakfast',
          title: index === 0 ? 'Arroz de hoy' : `Desayuno ${index + 1}`,
          description: null,
          prepMinutes: 20,
          ingredients:
            index < 2
              ? [{ name: 'Arroz', quantity: index === 0 ? 1.5 : 0.5, unit: 'kg' }]
              : [{ name: `Ingrediente ${index + 1}`, quantity: 1, unit: 'unidad' }],
        },
        {
          mealType: 'lunch',
          title: `Almuerzo ${index + 1}`,
          description: null,
          prepMinutes: 20,
          ingredients: [{ name: 'Pollo', quantity: 1, unit: 'kg' }],
        },
        {
          mealType: 'dinner',
          title: `Cena ${index + 1}`,
          description: null,
          prepMinutes: 20,
          ingredients: [{ name: 'Sal', quantity: null, unit: null }],
        },
      ],
    })),
    ...overrides,
  };
}

function inventory(
  name: string,
  quantity: string | null,
  unit: string | null,
  overrides: Partial<RecipeInventoryItemRow> = {}
): RecipeInventoryItemRow {
  return {
    id: `inventory-${name}-${overrides.id ?? '1'}`,
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    ingredient_name: name,
    quantity,
    unit,
    category: null,
    expiration_date: '2026-11-20',
    estimated_unit_price: null,
    purchase_location: null,
    low_stock_threshold: null,
    normalized_name: null,
    notes: null,
    created_at: '2026-10-27T00:00:00.000Z',
    updated_at: '2026-10-27T00:00:00.000Z',
    ...overrides,
  };
}

function shopping(
  name: string,
  status: ShoppingListItemRow['status'],
  overrides: Partial<ShoppingListItemRow> = {}
): ShoppingListItemRow {
  return {
    id: `shopping-${name}`,
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    source: 'manual',
    premium_recipe_id: null,
    ingredient_name: name,
    quantity: '1 kg',
    status,
    transfer_inventory_item_id: null,
    transferred_at: null,
    created_at: '2026-10-27T00:00:00.000Z',
    updated_at: '2026-10-27T00:00:00.000Z',
    ...overrides,
  };
}

function build(overrides: Partial<Parameters<typeof buildPredictiveShoppingProposal>[0]> = {}) {
  return buildPredictiveShoppingProposal({
    plan: plan(),
    inventoryItems: [
      inventory('Arroz', '500', 'g', { estimated_unit_price: 2 }),
      inventory('Pollo', '1 kg', null, { estimated_unit_price: 8 }),
    ],
    shoppingItems: [],
    consumptionPayload: {},
    horizonDays: 7,
    now,
    ...overrides,
  });
}

describe('predictive shopping', () => {
  it('consolidates repeated needs and computes a precise seven-day shortage', () => {
    const proposal = build();
    const rice = proposal.items.find((item) => item.normalizedName === 'arroz');
    expect(proposal.status).toBe('ready');
    expect(rice).toMatchObject({
      requiredQuantity: 2,
      availableQuantity: 0.5,
      quantityToBuy: 1.5,
      unit: 'kg',
      status: 'buy',
      estimatedCost: 3,
    });
    expect(rice?.usedInRecipes).toHaveLength(2);
  });

  it('supports the fourteen-day horizon without using meals outside it', () => {
    const proposal = build({ horizonDays: 14 });
    const rice = proposal.items.find((item) => item.normalizedName === 'arroz');
    expect(rice?.requiredQuantity).toBe(2);
    expect(proposal.scheduledMealCount).toBe(42);
  });

  it('excludes confirmed consumption from the required quantity', () => {
    const proposal = build({
      inventoryItems: [inventory('Arroz', '0', 'kg')],
      consumptionPayload: {
        '1:breakfast': {
          consumedAt: '2026-10-27T14:00:00.000Z',
          dayIndex: 1,
          mealType: 'breakfast',
          mealTitle: 'Arroz de hoy',
          decrements: [],
          skipped: [],
        },
      },
    });
    expect(proposal.items.find((item) => item.normalizedName === 'arroz')?.requiredQuantity).toBe(
      0.5
    );
  });

  it('preserves unknown for mixed known and unknown quantities', () => {
    const changed = plan();
    changed.days[1]!.meals[0]!.ingredients = [{ name: 'Arroz', quantity: null, unit: null }];
    const proposal = build({ plan: changed });
    expect(proposal.items.find((item) => item.normalizedName === 'arroz')).toMatchObject({
      status: 'review',
      requiredQuantity: null,
      quantityToBuy: null,
      estimatedCost: null,
    });
  });

  it('keeps incompatible units unknown instead of inventing a conversion', () => {
    const changed = plan();
    changed.days[1]!.meals[0]!.ingredients = [{ name: 'Arroz', quantity: 2, unit: 'unidad' }];
    const proposal = build({ plan: changed });
    expect(proposal.items.find((item) => item.normalizedName === 'arroz')?.status).toBe('review');
  });

  it('excludes expired lots and does not count pending or purchased rows as inventory', () => {
    const proposal = build({
      inventoryItems: [inventory('Arroz', '1 kg', 'kg', { expiration_date: '2026-10-26' })],
      shoppingItems: [shopping('Arroz', 'pending'), shopping('Pollo', 'purchased')],
    });
    expect(proposal.items.find((item) => item.normalizedName === 'arroz')).toMatchObject({
      status: 'review',
      availableQuantity: null,
      alreadyPresent: true,
      shoppingStatus: 'pending',
    });
    expect(proposal.items.find((item) => item.normalizedName === 'pollo')?.alreadyPresent).toBe(
      true
    );
  });

  it('marks transferred purchases without subtracting them a second time', () => {
    const proposal = build({
      shoppingItems: [
        shopping('Arroz', 'purchased', {
          transfer_inventory_item_id: 'inventory-transfer',
          transferred_at: '2026-10-27T10:00:00.000Z',
        }),
      ],
    });
    const rice = proposal.items.find((item) => item.normalizedName === 'arroz');
    expect(rice?.transferCompleted).toBe(true);
    expect(rice?.availableQuantity).toBe(0.5);
  });

  it('does not treat an existing row from another source as a new purchase', () => {
    const proposal = build({
      shoppingItems: [shopping('Arroz', 'pending', { source: 'manual' })],
    });
    expect(proposal.items.find((item) => item.normalizedName === 'arroz')).toMatchObject({
      alreadyPresent: true,
      existingShoppingSources: ['manual'],
    });
  });

  it('returns partial cost evidence rather than presenting it as a complete total', () => {
    const proposal = build({
      inventoryItems: [
        inventory('Arroz', '500', 'g', { estimated_unit_price: 2 }),
        inventory('Pollo', '1 kg', null),
      ],
    });
    expect(proposal.cost).toMatchObject({ status: 'partial', estimatedTotal: 3 });
  });

  it('fails closed when schedule or portions are not confirmed', () => {
    expect(build({ plan: plan({ schedule: undefined }) })).toMatchObject({
      status: 'unknown',
      reason: 'schedule_not_confirmed',
      items: [],
    });
    expect(
      build({
        plan: plan({
          schedule: {
            ...plan().schedule!,
            portionConfirmation: undefined,
          },
        }),
      })
    ).toMatchObject({ status: 'unknown', reason: 'portion_basis_not_confirmed', items: [] });
  });

  it('changes the fingerprint when inventory or plan evidence changes', () => {
    const input = {
      plan: plan(),
      inventoryItems: [inventory('Arroz', '500', 'g')],
      shoppingItems: [],
      consumptionPayload: {},
      horizonDays: 7 as const,
      now,
    };
    const original = createPredictiveShoppingFingerprint(input);
    const changed = createPredictiveShoppingFingerprint({
      ...input,
      inventoryItems: [inventory('Arroz', '750', 'g')],
    });
    expect(original).not.toBe(changed);
  });
  it('reconstructs only the full legacy UTC fingerprint without losing microseconds', () => {
    const input = {
      plan: plan(),
      consumptionPayload: {},
      horizonDays: 7 as const,
      now,
      inventoryItems: [
        inventory('Arroz', '500', 'g', {
          expiration_date: '2026-11-20 00:00:00+00',
          updated_at: '2026-10-27 12:00:00.123456+00',
        }),
      ],
      shoppingItems: [
        shopping('Sal', 'purchased', {
          updated_at: '2026-10-27 12:00:00.1234+00',
          transferred_at: '2026-10-27 12:00:00+00',
        }),
      ],
    };
    const legacy = createPredictiveShoppingFingerprint(input);
    const canonical = {
      ...input,
      inventoryItems: [
        {
          ...input.inventoryItems[0],
          expiration_date: '2026-11-20T00:00:00.000Z',
          updated_at: '2026-10-27T12:00:00.123456Z',
        },
      ],
      shoppingItems: [
        {
          ...input.shoppingItems[0],
          updated_at: '2026-10-27T12:00:00.123400Z',
          transferred_at: '2026-10-27T12:00:00.000Z',
        },
      ],
    };
    expect(createPredictiveShoppingFingerprint(canonical)).not.toBe(legacy);
    expect(createLegacyUtcShoppingFingerprint(canonical)).toBe(legacy);
    expect(
      createLegacyUtcShoppingFingerprint({
        ...canonical,
        inventoryItems: [
          { ...canonical.inventoryItems[0], updated_at: '2026-10-27T12:00:00.123457Z' },
        ],
      })
    ).not.toBe(legacy);
    expect(
      createLegacyUtcShoppingFingerprint({
        ...canonical,
        inventoryItems: [{ ...canonical.inventoryItems[0], expiration_date: '2026-11-20' }],
      })
    ).toBeNull();
  });
});

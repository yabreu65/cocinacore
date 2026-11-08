import { describe, expect, it } from 'vitest';
import type {
  RecipeInventoryItemRow,
  UserCulinaryProfileRow,
  UserRecipeVersionRow,
} from '@/lib/db/types';
import type { UserCulinaryProfileTermWithLabel } from '@/lib/db/repositories/culinaryProfileRepository';
import {
  buildCookingTeacherContext,
  type CookingTeacherContextSource,
} from './cooking-teacher-context';

function version(overrides: Partial<UserRecipeVersionRow> = {}): UserRecipeVersionRow {
  return {
    id: 'version-1',
    recipe_id: 'recipe-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    version_number: 2,
    title: 'Arroz de verduras',
    instructions: 'Sofreír y cocinar.',
    servings: 4,
    ingredients: [
      { name: 'arroz', quantity: '200', unit: 'g' },
      { name: 'agua', quantity: null, unit: null },
    ],
    source_recipe_history_id: null,
    created_at: '2026-10-30T12:00:00.000Z',
    ...overrides,
  };
}

function source(overrides: Partial<CookingTeacherContextSource> = {}): CookingTeacherContextSource {
  return {
    session: {
      id: 'session-1',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      status: 'active',
      current_step: 1,
      total_steps: 1,
      meal_type: 'lunch',
      day_index: 1,
      recipe_id: 'recipe-1',
      recipe_version_id: 'version-1',
      instruction_snapshot: {
        steps: [{ index: 1, title: 'Sofrito', instruction: 'Calentá la sartén y sofríe.' }],
      },
    },
    recipeVersion: version(),
    profile: {
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      level: 'beginner',
      available_time_minutes: 30,
      disliked_ingredients: [],
      allergies: [],
      household_members: [],
      created_at: '2026-10-30T12:00:00.000Z',
      updated_at: '2026-10-30T12:00:00.000Z',
    },
    profileTerms: [],
    inventory: [
      {
        id: 'inventory-1',
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        ingredient_name: 'Arroz',
        quantity: '500',
        unit: 'g',
        category: 'Granos',
        expiration_date: null,
        estimated_unit_price: null,
        purchase_location: null,
        low_stock_threshold: null,
        normalized_name: 'arroz',
        notes: null,
        created_at: '2026-10-30T12:00:00.000Z',
        updated_at: '2026-10-30T12:00:00.000Z',
      } satisfies RecipeInventoryItemRow,
    ],
    ...overrides,
  };
}

describe('buildCookingTeacherContext', () => {
  it('keeps operational progress separate from derived pedagogical stages', () => {
    const context = buildCookingTeacherContext(source());

    expect(context.authorization).toEqual({ verified: true, tenantScoped: true, writes: 'none' });
    expect(context.operationalStep.index).toBe(1);
    expect(context.pedagogicalBoundary).toEqual({
      derivedStagesAllowed: true,
      doNotAdvanceOperationalProgress: true,
      source: 'operational_step',
    });
  });

  it('preserves unknown quantities instead of inferring them', () => {
    const context = buildCookingTeacherContext(source());

    expect(context.ingredients[0]?.quantityStatus).toBe('known');
    expect(context.ingredients[1]?.quantityStatus).toBe('unknown');
    expect(context.ingredients[1]?.inventory.status).toBe('unknown');
  });

  it('uses inventory created by another user in the same tenant', () => {
    const item = source().inventory[0];
    const shared = buildCookingTeacherContext(
      source({ inventory: [{ ...item, user_id: 'user-2' }] })
    );
    expect(shared.ingredients[0]?.inventory).toEqual(
      buildCookingTeacherContext(source()).ingredients[0]?.inventory
    );
  });

  it('does not label an inventory row available when its quantity is unknown', () => {
    const item = source().inventory[0];
    const context = buildCookingTeacherContext(
      source({ inventory: [{ ...item, quantity: null, unit: null }] })
    );

    expect(context.ingredients[0]?.inventory.status).toBe('unknown');
  });

  it('blocks deterministic allergy matches without asking the provider', () => {
    const profile = source().profile as UserCulinaryProfileRow;
    const context = buildCookingTeacherContext(
      source({ profile: { ...profile, allergies: ['arroz'] } })
    );

    expect(context.restrictions.status).toBe('blocked');
    expect(context.restrictions.reasons[0]).toContain('alergia');
  });

  it('blocks deterministic avoid matches before the provider', () => {
    const profile = source().profile as UserCulinaryProfileRow;
    const context = buildCookingTeacherContext(
      source({ profile: { ...profile, disliked_ingredients: ['arroz'] } })
    );

    expect(context.restrictions.status).toBe('blocked');
    expect(context.restrictions.reasons[0]).toContain('evitar');
  });

  it('combines persisted avoid terms without treating them as allergies', () => {
    const persistedAvoid: UserCulinaryProfileTermWithLabel = {
      user_id: 'user-1',
      term_id: 'term-arroz',
      preference_type: 'avoid',
      weight: 1,
      created_at: '2026-10-30T12:00:00.000Z',
      term_label: 'arroz',
    };
    const context = buildCookingTeacherContext(
      source({ profileTerms: [persistedAvoid, persistedAvoid] })
    );

    expect(context.restrictions.status).toBe('blocked');
    expect(context.restrictions.allergies).toEqual([]);
    expect(context.restrictions.avoids).toEqual(['arroz']);
  });

  it('marks the restriction state unknown when no profile is available', () => {
    const context = buildCookingTeacherContext(source({ profile: null }));

    expect(context.restrictions.status).toBe('unknown');
    expect(context.limitations).toContain(
      'No hay un perfil culinario verificado para esta sesión.'
    );
  });

  it('does not expose source tenant or user identifiers in the model context', () => {
    const context = buildCookingTeacherContext(source());
    const serialized = JSON.stringify(context);

    expect(serialized).not.toContain('tenant-1');
    expect(serialized).not.toContain('user-1');
  });
});

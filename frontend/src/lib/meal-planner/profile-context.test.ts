import { describe, expect, it } from 'vitest';
import type { UserCulinaryProfileRow } from '@/lib/db/types';
import type { UserCulinaryProfileTermWithLabel } from '@/lib/db/repositories/culinaryProfileRepository';
import {
  buildPersistedMealPlanProfileContext,
  formatPersistedMealPlanProfileContext,
} from './profile-context';

function profile(overrides: Partial<UserCulinaryProfileRow> = {}): UserCulinaryProfileRow {
  return {
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    level: 'Intermedio',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function term(
  preference_type: UserCulinaryProfileTermWithLabel['preference_type'],
  term_label: string,
  overrides: Partial<UserCulinaryProfileTermWithLabel> = {}
): UserCulinaryProfileTermWithLabel {
  return {
    user_id: 'user-1',
    term_id: `${preference_type}-${term_label}`,
    preference_type,
    term_label,
    weight: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('persisted meal planner profile context', () => {
  it('formats persisted level and mapped culinary terms', () => {
    const context = buildPersistedMealPlanProfileContext(
      profile(),
      [
        term('identity', 'Cocina mediterránea'),
        term('prefer', 'Legumbres'),
        term('avoid', 'Maní'),
        term('goal', 'Comidas rápidas'),
      ],
      'user-1',
      'tenant-1'
    );

    expect(formatPersistedMealPlanProfileContext(context)).toBe(
      'Identidad/contexto: Cocina mediterránea\n' +
        'Preferencias: Legumbres\n' +
        'Evitar: Maní\n' +
        'Objetivos: Comidas rápidas\n' +
        'Nivel: Intermedio'
    );
  });

  it('normalizes, bounds, de-duplicates, and preserves database term order', () => {
    const longLabel = `  ${'a'.repeat(101)}  `;
    const preferredTerms = Array.from({ length: 13 }, (_, index) =>
      term('prefer', `  Preferencia   ${index}  `)
    );
    const context = buildPersistedMealPlanProfileContext(
      profile({ level: `  ${'n'.repeat(51)}  ` }),
      [
        term('identity', longLabel),
        term('identity', 'Mismo valor'),
        term('identity', '  Mismo   valor '),
        ...preferredTerms,
      ],
      'user-1',
      'tenant-1'
    );

    expect(context).toEqual({
      identity: ['a'.repeat(100), 'Mismo valor'],
      preferred: Array.from({ length: 12 }, (_, index) => `Preferencia ${index}`),
      avoid: [],
      goals: [],
      level: 'n'.repeat(50),
    });
  });

  it('masks profile data unless both authenticated user and tenant exactly match', () => {
    const terms = [term('avoid', 'Dato privado')];

    expect(
      formatPersistedMealPlanProfileContext(
        buildPersistedMealPlanProfileContext(profile({ user_id: 'user-2' }), terms, 'user-1', 'tenant-1')
      )
    ).toBe('Sin perfil culinario configurado.');
    expect(
      formatPersistedMealPlanProfileContext(
        buildPersistedMealPlanProfileContext(profile({ tenant_id: 'tenant-2' }), terms, 'user-1', 'tenant-1')
      )
    ).toBe('Sin perfil culinario configurado.');
  });

  it('excludes terms from another user and emits the exact missing-profile marker', () => {
    const context = buildPersistedMealPlanProfileContext(
      profile({ level: null }),
      [term('goal', 'Aparece primero'), term('goal', 'No pertenece', { user_id: 'user-2' })],
      'user-1',
      'tenant-1'
    );

    expect(formatPersistedMealPlanProfileContext(context)).toBe('Objetivos: Aparece primero');
    expect(
      formatPersistedMealPlanProfileContext(
        buildPersistedMealPlanProfileContext(null, [], 'user-1', 'tenant-1')
      )
    ).toBe('Sin perfil culinario configurado.');
  });
});

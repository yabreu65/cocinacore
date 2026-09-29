import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeInventoryItemRow, UserCulinaryProfileRow } from '@/lib/db/types';
import type { UserCulinaryProfileTermWithLabel } from '@/lib/db/repositories/culinaryProfileRepository';

const listInventoryItemsByTenantMock = vi.fn();
const findCulinaryProfileByUserIdMock = vi.fn();
const findCulinaryProfileTermsByUserIdMock = vi.fn();

vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  listInventoryItemsByTenant: listInventoryItemsByTenantMock,
}));
vi.mock('@/lib/db/repositories/culinaryProfileRepository', () => ({
  findCulinaryProfileByUserId: findCulinaryProfileByUserIdMock,
  findCulinaryProfileTermsByUserId: findCulinaryProfileTermsByUserIdMock,
}));

const { loadPersistedRecipeContext } = await import('./persisted-context');

function inventory(overrides: Partial<RecipeInventoryItemRow> = {}): RecipeInventoryItemRow {
  return {
    id: 'item-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    ingredient_name: 'Tomate',
    quantity: '2',
    unit: 'kg',
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

describe('loadPersistedRecipeContext', () => {
  beforeEach(() => {
    listInventoryItemsByTenantMock.mockReset();
    findCulinaryProfileByUserIdMock.mockReset();
    findCulinaryProfileTermsByUserIdMock.mockReset();
    listInventoryItemsByTenantMock.mockResolvedValue([]);
    findCulinaryProfileByUserIdMock.mockResolvedValue(null);
    findCulinaryProfileTermsByUserIdMock.mockResolvedValue([]);
  });

  it('loads only exact tenant inventory and preserves quantity, unit, and retrieval names', async () => {
    listInventoryItemsByTenantMock.mockResolvedValue([
      inventory(),
      inventory({ id: 'other-tenant', tenant_id: 'tenant-2', ingredient_name: 'Dato ajeno' }),
      inventory({ id: 'unknown', ingredient_name: 'Lentejas', quantity: null, unit: null }),
    ]);

    const context = await loadPersistedRecipeContext('user-1', 'tenant-1');

    expect(listInventoryItemsByTenantMock).toHaveBeenCalledWith('tenant-1');
    expect(context.inventoryLines).toEqual([
      '- tomate: 2 kg',
      '- lentejas: cantidad no especificada',
    ]);
    expect(context.inventoryNames).toEqual(['tomate', 'lentejas']);
    expect(context.inventoryContext).not.toContain('Dato ajeno');
  });

  it('bounds inventory context to 30 lines and 12 retrieval names', async () => {
    listInventoryItemsByTenantMock.mockResolvedValue(
      Array.from({ length: 35 }, (_, index) =>
        inventory({ id: `item-${index}`, ingredient_name: `Ingrediente ${index}` })
      )
    );

    const context = await loadPersistedRecipeContext('user-1', 'tenant-1');

    expect(context.inventoryLines).toHaveLength(30);
    expect(context.inventoryNames).toHaveLength(12);
    expect(context.inventoryContext.length).toBeLessThanOrEqual(6000);
  });

  it('accepts profile data only when both user and tenant match, and excludes other-user terms', async () => {
    findCulinaryProfileByUserIdMock.mockResolvedValue(profile());
    findCulinaryProfileTermsByUserIdMock.mockResolvedValue([
      term('identity', 'Mediterránea'),
      term('prefer', 'Legumbres'),
      term('avoid', 'Maní'),
      term('goal', 'Rápido'),
      term('avoid', 'Dato de otro usuario', { user_id: 'user-2' }),
    ]);

    const context = await loadPersistedRecipeContext('user-1', 'tenant-1');

    expect(findCulinaryProfileByUserIdMock).toHaveBeenCalledWith('user-1');
    expect(findCulinaryProfileTermsByUserIdMock).toHaveBeenCalledWith('user-1');
    expect(context.profile).toEqual({
      identity: ['Mediterránea'],
      preferred: ['Legumbres'],
      avoid: ['Maní'],
      goals: ['Rápido'],
      level: 'Intermedio',
    });
    expect(context.profileContext).not.toContain('Dato de otro usuario');
  });

  it('returns neutral markers when inventory or an exact user/tenant profile is missing', async () => {
    findCulinaryProfileByUserIdMock.mockResolvedValue(profile({ tenant_id: 'tenant-2' }));

    const context = await loadPersistedRecipeContext('user-1', 'tenant-1');

    expect(context.inventoryLines).toEqual([]);
    expect(context.inventoryNames).toEqual([]);
    expect(context.inventoryContext).toBe('Sin inventario persistido para este hogar.');
    expect(context.profile).toBeNull();
    expect(context.profileContext).toBe('Sin perfil culinario configurado.');

    findCulinaryProfileByUserIdMock.mockResolvedValue(profile({ user_id: 'user-2' }));
    const otherUserContext = await loadPersistedRecipeContext('user-1', 'tenant-1');
    expect(otherUserContext.profile).toBeNull();
    expect(otherUserContext.profileContext).toBe('Sin perfil culinario configurado.');
  });
});

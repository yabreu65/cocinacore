import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { RecipeInventoryItemRow, UserCulinaryProfileRow } from '@/lib/db/types';
import type { UserCulinaryProfileTermWithLabel } from '@/lib/db/repositories/culinaryProfileRepository';

const requireUserMock = vi.fn();
const listInventoryItemsByTenantMock = vi.fn();
const findCulinaryProfileByUserIdMock = vi.fn();
const findCulinaryProfileTermsByUserIdMock = vi.fn();
const checkRateLimitMock = vi.fn();
const fetchMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  listInventoryItemsByTenant: listInventoryItemsByTenantMock,
}));

vi.mock('@/lib/db/repositories/culinaryProfileRepository', () => ({
  findCulinaryProfileByUserId: findCulinaryProfileByUserIdMock,
  findCulinaryProfileTermsByUserId: findCulinaryProfileTermsByUserIdMock,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: checkRateLimitMock,
}));

vi.mock('@/lib/ai/gemini-config', () => ({
  getGeminiApiKey: () => 'gemini-test-key',
  getGeminiModel: () => 'gemini-test-model',
}));

vi.mock('@/lib/serverLogger', () => ({
  serverLogger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const { POST } = await import('./route');

function inventoryItem(overrides: Partial<RecipeInventoryItemRow> = {}): RecipeInventoryItemRow {
  return {
    id: 'item-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    ingredient_name: 'Arroz real',
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

function profileTerm(
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

function request(body: unknown): Request {
  return new Request('https://app.example.test/api/meal-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify(body),
  });
}

function geminiPrompt(): string {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  const payload = JSON.parse(init.body as string) as {
    contents: Array<{ parts: Array<{ text: string }> }>;
  };
  return payload.contents[0].parts[0].text;
}

describe('POST /api/meal-plan', () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    listInventoryItemsByTenantMock.mockReset();
    findCulinaryProfileByUserIdMock.mockReset();
    findCulinaryProfileTermsByUserIdMock.mockReset();
    checkRateLimitMock.mockReset();
    fetchMock.mockReset();

    requireUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.test',
      fullName: null,
      tenant: {
        tenantId: 'tenant-1',
        role: 'owner',
        tenantType: 'home',
        onboardingCompleted: true,
      },
      termsAcceptedAt: null,
      termsVersion: null,
      onboardingCompleted: true,
    });
    listInventoryItemsByTenantMock.mockResolvedValue([inventoryItem()]);
    findCulinaryProfileByUserIdMock.mockResolvedValue(null);
    findCulinaryProfileTermsByUserIdMock.mockResolvedValue([]);
    checkRateLimitMock.mockResolvedValue({ success: true, limit: 10, remaining: 9, resetAt: 1 });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Plan generado' }] } }] }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  it('loads authenticated inventory and persisted profile, ignoring browser-controlled values', async () => {
    findCulinaryProfileByUserIdMock.mockResolvedValue(profile());
    findCulinaryProfileTermsByUserIdMock.mockResolvedValue([
      profileTerm('identity', 'Cocina andina'),
      profileTerm('prefer', 'Legumbres'),
      profileTerm('avoid', 'Maní'),
      profileTerm('goal', 'Comidas rápidas'),
    ]);

    const response = await POST(
      request({
        mode: 'inventory_to_menu',
        inventory: ['ingrediente-controlado-por-el-navegador'],
        culinaryProfile: {
          preferred: ['perfil-controlado-por-el-navegador'],
          avoid: ['dato-no-confiable'],
          goals: ['meta-no-confiable'],
          level: 'Nivel no confiable',
        },
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(requireUserMock).toHaveBeenCalledTimes(1);
    expect(listInventoryItemsByTenantMock).toHaveBeenCalledWith('tenant-1');
    expect(findCulinaryProfileByUserIdMock).toHaveBeenCalledWith('user-1');
    expect(findCulinaryProfileTermsByUserIdMock).toHaveBeenCalledWith('user-1');
    expect(geminiPrompt()).toContain(
      'Inventario real disponible del hogar (base de datos, tenant autenticado):\n- arroz real: 2 kg'
    );
    expect(geminiPrompt()).toContain(
      'Perfil culinario persistido del usuario autenticado:\n' +
        'Identidad/contexto: Cocina andina\n' +
        'Preferencias: Legumbres\n' +
        'Evitar: Maní\n' +
        'Objetivos: Comidas rápidas\n' +
        'Nivel: Intermedio'
    );
    expect(geminiPrompt()).not.toContain('controlado-por-el-navegador');
    expect(geminiPrompt()).not.toContain('dato-no-confiable');
    expect(geminiPrompt()).not.toContain('meta-no-confiable');
    expect(geminiPrompt()).not.toContain('Nivel no confiable');
    expect(geminiPrompt().indexOf('Inventario real disponible')).toBeLessThan(
      geminiPrompt().indexOf('Perfil culinario persistido')
    );
  });

  it('excludes another user profile and terms while allowing a missing profile to generate normally', async () => {
    findCulinaryProfileByUserIdMock.mockResolvedValue(profile({ user_id: 'user-2' }));
    findCulinaryProfileTermsByUserIdMock.mockResolvedValue([
      profileTerm('avoid', 'Término de otro usuario', { user_id: 'user-2' }),
    ]);

    const response = await POST(request({ mode: 'balanced_ai' }) as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(geminiPrompt()).toContain(
      'Perfil culinario persistido del usuario autenticado:\nSin perfil culinario configurado.'
    );
    expect(geminiPrompt()).not.toContain('Término de otro usuario');
  });

  it('adds the empty persisted inventory marker to non-inventory modes before proposing purchases', async () => {
    listInventoryItemsByTenantMock.mockResolvedValue([]);

    const response = await POST(
      request({ mode: 'balanced_ai', inventory: ['ingrediente-controlado-por-el-navegador'] }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(listInventoryItemsByTenantMock).toHaveBeenCalledWith('tenant-1');
    expect(geminiPrompt()).toContain(
      'Inventario real disponible del hogar (base de datos, tenant autenticado):\nSin inventario persistido para este hogar.'
    );
    expect(geminiPrompt()).toContain('Sin perfil culinario configurado.');
    expect(geminiPrompt()).not.toContain('ingrediente-controlado-por-el-navegador');
  });

  it('returns a safe unauthorized response without loading persisted context or calling Gemini', async () => {
    requireUserMock.mockRejectedValue(new Error('Unauthorized'));

    const response = await POST(request({ mode: 'inventory_to_menu' }) as unknown as NextRequest);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(listInventoryItemsByTenantMock).not.toHaveBeenCalled();
    expect(findCulinaryProfileByUserIdMock).not.toHaveBeenCalled();
    expect(findCulinaryProfileTermsByUserIdMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a safe unauthorized response when the authenticated user lacks tenant context', async () => {
    requireUserMock.mockResolvedValue({ id: 'user-1', tenant: null });

    const response = await POST(request({ mode: 'inventory_to_menu' }) as unknown as NextRequest);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(listInventoryItemsByTenantMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

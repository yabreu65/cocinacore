import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { RecipeInventoryItemRow } from '@/lib/db/types';

const requireTenantMock = vi.fn();
const listInventoryItemsByTenantMock = vi.fn();
const checkRateLimitMock = vi.fn();
const fetchMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireTenant: requireTenantMock,
}));

vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  listInventoryItemsByTenant: listInventoryItemsByTenantMock,
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
    requireTenantMock.mockReset();
    listInventoryItemsByTenantMock.mockReset();
    checkRateLimitMock.mockReset();
    fetchMock.mockReset();

    requireTenantMock.mockResolvedValue({
      tenantId: 'tenant-1',
      role: 'owner',
      tenantType: 'home',
      onboardingCompleted: true,
    });
    listInventoryItemsByTenantMock.mockResolvedValue([inventoryItem()]);
    checkRateLimitMock.mockResolvedValue({ success: true, limit: 10, remaining: 9, resetAt: 1 });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Plan generado' }] } }] }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  it('loads authenticated tenant inventory and ignores browser inventory before calling Gemini', async () => {
    const response = await POST(
      request({
        mode: 'inventory_to_menu',
        inventory: ['ingrediente-controlado-por-el-navegador'],
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(requireTenantMock).toHaveBeenCalledTimes(1);
    expect(listInventoryItemsByTenantMock).toHaveBeenCalledWith('tenant-1');
    expect(geminiPrompt()).toContain(
      'Inventario real disponible del hogar (base de datos, tenant autenticado):\n- arroz real: 2 kg'
    );
    expect(geminiPrompt()).not.toContain('ingrediente-controlado-por-el-navegador');
  });

  it('adds the empty persisted inventory marker to non-inventory modes before proposing purchases', async () => {
    listInventoryItemsByTenantMock.mockResolvedValue([]);

    const response = await POST(
      request({
        mode: 'balanced_ai',
        inventory: ['ingrediente-controlado-por-el-navegador'],
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(listInventoryItemsByTenantMock).toHaveBeenCalledWith('tenant-1');
    expect(geminiPrompt()).toContain(
      'Inventario real disponible del hogar (base de datos, tenant autenticado):\nSin inventario persistido para este hogar.'
    );
    expect(geminiPrompt()).not.toContain('ingrediente-controlado-por-el-navegador');
  });

  it('returns a safe unauthorized response without loading inventory or calling Gemini', async () => {
    requireTenantMock.mockRejectedValue(new Error('Tenant context required'));

    const response = await POST(request({ mode: 'inventory_to_menu' }) as unknown as NextRequest);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(listInventoryItemsByTenantMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

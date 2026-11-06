import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getCookingSession: vi.fn(),
  listReconciliationInventory: vi.fn(),
  reconcileRealConsumption: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/db/repositories/cookingSessionRepository', () => ({
  getCookingSession: mocks.getCookingSession,
}));
vi.mock('@/lib/db/repositories/realConsumptionRepository', () => ({
  listReconciliationInventory: mocks.listReconciliationInventory,
  reconcileRealConsumption: mocks.reconcileRealConsumption,
}));

import { GET, POST } from './route';

const sessionId = '00000000-0000-4000-8000-000000000010';
const user = { id: 'user-1', tenant: { tenantId: 'tenant-1', role: 'owner' } };

function request(body: unknown) {
  return new NextRequest(
    `https://app.example.test/api/cooking-sessions/${sessionId}/reconciliation`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    expectedVersion: 3,
    idempotencyKey: 'reconcile-1',
    confirmed: true,
    items: [
      {
        originalIngredient: 'Arroz',
        outcome: 'unknown',
        effectiveIngredient: null,
        quantity: null,
        unit: null,
        inventoryItemId: null,
        substituteIngredient: null,
        substituteInventoryItemId: null,
      },
    ],
    ...overrides,
  };
}

describe('POST /api/cooking-sessions/[id]/reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(user);
    mocks.reconcileRealConsumption.mockResolvedValue({
      status: 'applied',
      operationId: 'operation-1',
      items: [{ originalIngredient: 'Arroz', outcome: 'unknown', quantityStatus: 'unknown' }],
      movementIds: [],
    });
  });

  it('requires authentication and explicit confirmation', async () => {
    mocks.requireUser.mockRejectedValue(new Error('unauthorized'));
    expect(
      (await POST(request(validBody()), { params: Promise.resolve({ id: sessionId }) })).status
    ).toBe(401);
    mocks.requireUser.mockResolvedValue(user);
    expect(
      (
        await POST(request(validBody({ confirmed: false })), {
          params: Promise.resolve({ id: sessionId }),
        })
      ).status
    ).toBe(400);
    expect(mocks.reconcileRealConsumption).not.toHaveBeenCalled();
  });

  it('uses the authenticated tenant and user instead of request data', async () => {
    const response = await POST(request(validBody()), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(response.status).toBe(201);
    expect(mocks.reconcileRealConsumption).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        sessionId,
        confirmed: true,
      })
    );
  });

  it('maps an already claimed slot without exposing private details', async () => {
    mocks.reconcileRealConsumption.mockResolvedValue({ status: 'legacy_already_claimed' });
    const response = await POST(request(validBody()), {
      params: Promise.resolve({ id: sessionId }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'El slot ya fue registrado por el consumo planificado.',
      code: 'MEAL_SLOT_CLAIMED',
    });
  });
});

describe('GET /api/cooking-sessions/[id]/reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(user);
    mocks.getCookingSession.mockResolvedValue({ id: sessionId });
    mocks.listReconciliationInventory.mockResolvedValue([
      {
        id: 'inventory-1',
        ingredient_name: 'Arroz',
        normalized_name: 'arroz',
        quantity: '1',
        unit: 'kg',
        expiration_date: '2026-11-01T00:00:00.000Z',
        tenant_id: 'tenant-1',
        user_id: 'user-1',
      },
    ]);
  });

  it('returns only the safe inventory selector fields', async () => {
    const response = await GET(
      new NextRequest(`https://app.example.test/api/cooking-sessions/${sessionId}/reconciliation`),
      { params: Promise.resolve({ id: sessionId }) }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      inventory: [
        {
          id: 'inventory-1',
          ingredientName: 'Arroz',
          normalizedName: 'arroz',
          quantity: '1',
          unit: 'kg',
          expirationDate: '2026-11-01T00:00:00.000Z',
        },
      ],
    });
    expect(mocks.listReconciliationInventory).toHaveBeenCalledWith('tenant-1', 'user-1');
  });
});

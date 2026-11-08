import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { UserMealPlanRow } from '@/lib/db/types';

const mockRequireUser = vi.fn();
const mockFindMealPlan = vi.fn();
const mockListInventory = vi.fn();
const mockFindProfile = vi.fn();
const mockFindTerms = vi.fn();

vi.mock('@/lib/auth/server', () => ({ requireUser: mockRequireUser }));
vi.mock('@/lib/db/repositories/mealPlanRepository', () => ({
  findMealPlanByIdForUserAndTenant: mockFindMealPlan,
}));
vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  listInventoryItemsByTenant: mockListInventory,
}));
vi.mock('@/lib/db/repositories/culinaryProfileRepository', () => ({
  findCulinaryProfileByUserId: mockFindProfile,
  findCulinaryProfileTermsByUserId: mockFindTerms,
}));
vi.mock('@/lib/meal-planner/adaptive-planning', () => ({
  buildAdaptiveMealPlanProposal: vi.fn(() => ({
    plan: { period: 'week', dayCount: 7, days: [] },
    changes: [],
    lockedSlotKeys: [],
    evidence: [],
    confidence: 'unknown',
    metrics: {},
    limitations: [],
  })),
  structuredMealPlanFingerprint: vi.fn(() => 'source-fingerprint'),
}));
vi.mock('@/lib/serverLogger', () => ({ serverLogger: { warn: vi.fn() } }));

const { POST } = await import('./route');

const user = {
  id: 'user-1',
  email: 'user@example.test',
  fullName: null,
  tenant: { tenantId: 'tenant-1', role: 'owner', tenantType: 'home', onboardingCompleted: true },
  termsAcceptedAt: null,
  termsVersion: null,
  onboardingCompleted: true,
};

const planId = '00000000-0000-4000-8000-000000000001';

function planRow(): UserMealPlanRow {
  return {
    id: planId,
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    people_count: 2,
    period: 'week',
    mode: 'balanced_ai',
    base_cuisine: 'Latinoamericana',
    fusion_cuisines: [],
    fusion_intensity: 'media',
    goal: null,
    restrictions: [],
    inventory_snapshot: {},
    calendar_payload: {
      period: 'week',
      dayCount: 7,
      days: Array.from({ length: 7 }, (_, index) => ({
        dayIndex: index + 1,
        meals: ['breakfast', 'lunch', 'dinner'].map((mealType) => ({
          mealType,
          title: `${mealType}-${index + 1}`,
          prepMinutes: 20,
          description: null,
          ingredients: [{ name: 'Arroz', quantity: 100, unit: 'g' }],
        })),
      })),
    },
    consumption_payload: {},
    ai_content: null,
    created_at: '2026-10-27T00:00:00.000Z',
    updated_at: '2026-10-27T00:00:00.000Z',
  };
}

function request(body: unknown): Request {
  return new Request('https://app.example.test/api/meal-plan/adaptive-proposal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/meal-plan/adaptive-proposal', () => {
  beforeEach(() => {
    mockRequireUser.mockReset().mockResolvedValue(user);
    mockFindMealPlan.mockReset().mockResolvedValue(planRow());
    mockListInventory.mockReset().mockResolvedValue([]);
    mockFindProfile.mockReset().mockResolvedValue(null);
    mockFindTerms.mockReset().mockResolvedValue([]);
  });

  it('requires an authenticated tenant and never reads or writes without one', async () => {
    mockRequireUser.mockResolvedValue({ ...user, tenant: null });
    const response = await POST(request({ mealPlanId: planId }) as unknown as NextRequest);

    expect(response.status).toBe(401);
    expect(mockFindMealPlan).not.toHaveBeenCalled();
    expect(mockListInventory).not.toHaveBeenCalled();
  });

  it('scopes the proposal to the authenticated plan and performs no persistence', async () => {
    const response = await POST(request({ mealPlanId: planId }) as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(mockFindMealPlan).toHaveBeenCalledWith(planId, 'user-1', 'tenant-1');
    expect(mockRequireUser).toHaveBeenCalledOnce();
    expect(mockListInventory).toHaveBeenCalledWith(
      'tenant-1',
      undefined,
      undefined,
      {},
      { tenantId: 'tenant-1', userId: 'user-1' }
    );
    expect(await response.json()).toMatchObject({
      mealPlanId: planId,
      expectedUpdatedAt: '2026-10-27T00:00:00.000Z',
      sourceFingerprint: 'source-fingerprint',
    });
  });

  it('rejects a malformed request before looking up plan data', async () => {
    const response = await POST(request({}) as unknown as NextRequest);

    expect(response.status).toBe(400);
    expect(mockFindMealPlan).not.toHaveBeenCalled();
  });

  it('rejects a malformed plan id before reaching the database', async () => {
    const response = await POST(request({ mealPlanId: 'not-a-uuid' }) as unknown as NextRequest);

    expect(response.status).toBe(400);
    expect(mockFindMealPlan).not.toHaveBeenCalled();
  });
});

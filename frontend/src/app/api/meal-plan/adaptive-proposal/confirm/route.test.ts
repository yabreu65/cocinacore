import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { UserMealPlanRow } from '@/lib/db/types';

const mockRequireUser = vi.fn();
const mockFindMealPlan = vi.fn();
const mockReplaceMealPlan = vi.fn();
const mockFingerprint = vi.fn();
const mockValidateReplacement = vi.fn();

vi.mock('@/lib/auth/server', () => ({ requireUser: mockRequireUser }));
vi.mock('@/lib/db/repositories/mealPlanRepository', () => ({
  findMealPlanByIdForUserAndTenant: mockFindMealPlan,
  replaceMealPlanForAdaptiveProposal: mockReplaceMealPlan,
}));
vi.mock('@/lib/meal-planner/adaptive-planning', () => ({
  structuredMealPlanFingerprint: mockFingerprint,
  validateAdaptivePlanReplacement: mockValidateReplacement,
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

function planPayload() {
  return {
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
  };
}

function row(): UserMealPlanRow {
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
    calendar_payload: planPayload(),
    consumption_payload: {},
    ai_content: null,
    created_at: '2026-10-27T00:00:00.000Z',
    updated_at: '2026-10-27T00:00:00.000Z',
  };
}

function request(body: unknown): Request {
  return new Request('https://app.example.test/api/meal-plan/adaptive-proposal/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/meal-plan/adaptive-proposal/confirm', () => {
  beforeEach(() => {
    mockRequireUser.mockReset().mockResolvedValue(user);
    mockFindMealPlan.mockReset().mockResolvedValue(row());
    mockReplaceMealPlan
      .mockReset()
      .mockResolvedValue({ ...row(), updated_at: '2026-10-27T00:01:00.000Z' });
    mockFingerprint.mockReset().mockReturnValue('source-fingerprint');
    mockValidateReplacement.mockReset().mockReturnValue({ valid: true });
  });

  it('rejects a stale proposal before persistence', async () => {
    const current = row();
    current.updated_at = '2026-10-27T00:02:00.000Z';
    mockFindMealPlan.mockResolvedValue(current);
    const response = await POST(
      request({
        mealPlanId: planId,
        expectedUpdatedAt: '2026-10-27T00:00:00.000Z',
        sourceFingerprint: 'source-fingerprint',
        proposedPlan: planPayload(),
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(409);
    expect(mockReplaceMealPlan).not.toHaveBeenCalled();
  });

  it('persists only after explicit confirmation and passes the authenticated scope', async () => {
    const response = await POST(
      request({
        mealPlanId: planId,
        expectedUpdatedAt: '2026-10-27T00:00:00.000Z',
        sourceFingerprint: 'source-fingerprint',
        proposedPlan: planPayload(),
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(mockReplaceMealPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        mealPlanId: planId,
        userId: 'user-1',
        tenantId: 'tenant-1',
        expectedUpdatedAt: '2026-10-27T00:00:00.000Z',
      })
    );
  });

  it('accepts equivalent legacy and canonical timestamp revisions without changing the DB parser', async () => {
    mockFindMealPlan.mockResolvedValue({ ...row(), updated_at: '2026-10-27 00:00:00.123456+00' });
    const response = await POST(
      request({
        mealPlanId: planId,
        expectedUpdatedAt: '2026-10-26T19:00:00.123456-05:00',
        sourceFingerprint: 'source-fingerprint',
        proposedPlan: planPayload(),
      }) as unknown as NextRequest
    );
    expect(response.status).toBe(200);
    expect(mockReplaceMealPlan).toHaveBeenCalledOnce();
  });

  it('rejects a one-microsecond revision change before persistence', async () => {
    mockFindMealPlan.mockResolvedValue({ ...row(), updated_at: '2026-10-27 00:00:00.123456+00' });
    const response = await POST(
      request({
        mealPlanId: planId,
        expectedUpdatedAt: '2026-10-27T00:00:00.123455Z',
        sourceFingerprint: 'source-fingerprint',
        proposedPlan: planPayload(),
      }) as unknown as NextRequest
    );
    expect(response.status).toBe(409);
    expect(mockReplaceMealPlan).not.toHaveBeenCalled();
  });

  it('returns conflict when the transactional restriction check rejects the proposal', async () => {
    mockReplaceMealPlan.mockResolvedValue(null);
    const response = await POST(
      request({
        mealPlanId: planId,
        expectedUpdatedAt: row().updated_at,
        sourceFingerprint: 'source-fingerprint',
        proposedPlan: planPayload(),
      }) as unknown as NextRequest
    );
    expect(response.status).toBe(409);
  });

  it('rejects a malformed plan id before any persistence lookup', async () => {
    const response = await POST(
      request({
        mealPlanId: 'not-a-uuid',
        expectedUpdatedAt: '2026-10-27T00:00:00.000Z',
        sourceFingerprint: 'source-fingerprint',
        proposedPlan: planPayload(),
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(400);
    expect(mockFindMealPlan).not.toHaveBeenCalled();
    expect(mockReplaceMealPlan).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), createCookingSession: vi.fn(), findCookingSessionForSlot: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/db/repositories/cookingSessionRepository', () => ({
  createCookingSession: mocks.createCookingSession,
  findCookingSessionForSlot: mocks.findCookingSessionForSlot,
}));

import { GET, POST } from './route';

const planId = '00000000-0000-4000-8000-000000000010';
const recipeId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000002';
const user = { id: 'user-1', tenant: { tenantId: 'tenant-1', role: 'owner' } };

function request(body: unknown) {
  return new NextRequest('https://app.example.test/api/cooking-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    mealPlanId: planId,
    dayIndex: 1,
    mealType: 'lunch',
    recipeId,
    versionId,
    expectedUpdatedAt: '2026-10-28T12:00:00.000Z',
    expectedCalendarPayload: { period: 'week', days: [] },
    idempotencyKey: 'start-1',
    confirmed: true,
    ...overrides,
  };
}

describe('POST /api/cooking-sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(user);
    mocks.createCookingSession.mockResolvedValue({
      status: 'applied',
      session: {
        id: 'session-1',
        meal_plan_id: planId,
        day_index: 1,
        meal_type: 'lunch',
        recipe_id: recipeId,
        recipe_version_id: versionId,
        status: 'active',
        current_step: 1,
        total_steps: 1,
        instruction_snapshot: { servings: 2, ingredients: [], steps: [] },
        version: 1,
        started_at: '',
        updated_at: '',
        completed_at: null,
        cancelled_at: null,
      },
      event: null,
    });
  });

  it('rejects anonymous or unconfirmed starts', async () => {
    mocks.requireUser.mockRejectedValue(new Error('unauthorized'));
    expect((await POST(request(validBody()))).status).toBe(401);
    mocks.requireUser.mockResolvedValue(user);
    expect((await POST(request(validBody({ confirmed: false })))).status).toBe(400);
    expect(mocks.createCookingSession).not.toHaveBeenCalled();
  });

  it('passes server-derived tenant and user scope', async () => {
    const response = await POST(request(validBody()));
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { session: { id: string } };
    expect(payload.session.id).toBe('session-1');
    expect(mocks.createCookingSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', tenantId: 'tenant-1', confirmed: true })
    );
  });

  it('maps stale sources and conflicts without private details', async () => {
    mocks.createCookingSession.mockResolvedValue({ status: 'source_conflict' });
    const response = await POST(request(validBody()));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'El origen cambió o la sesión ya existe.',
      code: 'COOKING_SESSION_CONFLICT',
    });
  });
  it('looks up the complete slot identity with server-owned scope', async () => {
    const query = new URLSearchParams({ mealPlanId: planId, recipeId, versionId, dayIndex: '2', mealType: 'dinner' });
    mocks.findCookingSessionForSlot.mockResolvedValue(null);
    const get = () => GET(new NextRequest('https://app.example.test/api/cooking-sessions?' + query));
    expect(await (await get()).json()).toEqual({ session: null });
    expect(mocks.findCookingSessionForSlot).toHaveBeenCalledWith({
      mealPlanId: planId, recipeId, versionId, dayIndex: 2, mealType: 'dinner', tenantId: 'tenant-1', userId: 'user-1',
    });
    query.set('tenantId', 'foreign');
    expect((await get()).status).toBe(400);
    mocks.requireUser.mockRejectedValue(new Error('unauthorized'));
    expect((await get()).status).toBe(401);
  });

});

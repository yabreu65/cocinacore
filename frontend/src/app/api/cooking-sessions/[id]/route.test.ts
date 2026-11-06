import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getCookingSession: vi.fn(),
  transitionCookingSession: vi.fn(),
}));
vi.mock('@/lib/auth/server', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/db/repositories/cookingSessionRepository', () => ({
  getCookingSession: mocks.getCookingSession,
  transitionCookingSession: mocks.transitionCookingSession,
}));

import { GET, PATCH } from './route';

const sessionId = '00000000-0000-4000-8000-000000000099';
const session = {
  id: sessionId,
  meal_plan_id: 'plan-1',
  day_index: 1,
  meal_type: 'lunch',
  recipe_id: 'recipe-1',
  recipe_version_id: 'version-1',
  status: 'active',
  current_step: 1,
  total_steps: 1,
  instruction_snapshot: { steps: [] },
  version: 1,
  started_at: '',
  updated_at: '',
  completed_at: null,
  cancelled_at: null,
};
const user = { id: 'user-1', tenant: { tenantId: 'tenant-1', role: 'owner' } };

function request(body?: unknown, method = 'PATCH') {
  return new NextRequest(`https://app.example.test/api/cooking-sessions/${sessionId}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

const context = { params: Promise.resolve({ id: sessionId }) };

describe('/api/cooking-sessions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(user);
    mocks.getCookingSession.mockResolvedValue(session);
    mocks.transitionCookingSession.mockResolvedValue({ status: 'applied', session, event: null });
  });

  it('reads only the authenticated owner scope', async () => {
    const response = await GET(request(undefined, 'GET'), context);
    expect(response.status).toBe(200);
    expect(mocks.getCookingSession).toHaveBeenCalledWith(sessionId, 'tenant-1', 'user-1');
  });

  it('requires an explicit valid transition command', async () => {
    const invalid = await PATCH(
      request({ action: 'complete', expectedVersion: 0, idempotencyKey: 'x', confirmed: false }),
      context
    );
    expect(invalid.status).toBe(400);
    expect(mocks.transitionCookingSession).not.toHaveBeenCalled();
    const valid = await PATCH(
      request({ action: 'pause', expectedVersion: 1, idempotencyKey: 'pause-1', confirmed: true }),
      context
    );
    expect(valid.status).toBe(200);
    expect(mocks.transitionCookingSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, tenantId: 'tenant-1', userId: 'user-1' })
    );
  });

  it('maps optimistic and source conflicts', async () => {
    mocks.transitionCookingSession.mockResolvedValue({ status: 'source_conflict' });
    const response = await PATCH(
      request({ action: 'pause', expectedVersion: 1, idempotencyKey: 'pause-2', confirmed: true }),
      context
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'El origen de la sesión cambió.',
      code: 'COOKING_SESSION_SOURCE_CONFLICT',
    });
  });
});

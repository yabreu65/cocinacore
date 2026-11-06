import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUserByIdForAuth: vi.fn(),
  findTenantById: vi.fn(),
  redisConnect: vi.fn(),
  redisEval: vi.fn(),
  redisOn: vi.fn(),
  redisDisconnect: vi.fn(),
}));

vi.mock('@/lib/db/repositories/userRepository', () => ({
  findUserByIdForAuth: mocks.findUserByIdForAuth,
}));
vi.mock('@/lib/db/repositories/tenantRepository', () => ({
  findTenantById: mocks.findTenantById,
  findTenantByIdForAuth: mocks.findTenantById,
}));
vi.mock('ioredis', () => ({
  default: class MockRedis {
    connect = mocks.redisConnect;
    eval = mocks.redisEval;
    on = mocks.redisOn;
    disconnect = mocks.redisDisconnect;
  },
}));

import {
  createMealPlanWarmupCapability,
  resolveMealPlanWarmupCapability,
} from './internal-capability';

const userRow = {
  id: 'user-1',
  email: 'user@example.com',
  full_name: 'User',
  password_hash: 'hash',
  tenant_id: 'tenant-1',
  role: 'owner' as const,
  onboarding_completed: true,
  terms_accepted_at: null,
  terms_version: null,
};

const context = {
  method: 'POST' as const,
  path: '/api/recipe-generate' as const,
  operation: 'recipe-generate' as const,
  jobId: 'warmup-job-1',
  bodyHash: 'body-hash-1',
};

describe('meal-plan warmup capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = 'test-secret';
    process.env.REDIS_URL = 'redis://test';
    mocks.findUserByIdForAuth.mockResolvedValue(userRow);
    mocks.findTenantById.mockResolvedValue({ id: 'tenant-1', tenant_type: 'home' });
    mocks.redisConnect.mockResolvedValue(undefined);
    mocks.redisEval.mockResolvedValue(1);
    delete (globalThis as Record<string, unknown>).__cocinacoreCapabilityRedis;
    delete (globalThis as Record<string, unknown>).__cocinacoreCapabilityRedisPromise;
    delete (globalThis as Record<string, unknown>).__cocinacoreCapabilityRedisUnavailableUntil;
  });

  it('binds the internal capability to the user and tenant', async () => {
    const capability = createMealPlanWarmupCapability('user-1', 'tenant-1', context);
    const user = await resolveMealPlanWarmupCapability(capability, context);

    expect(user?.user.id).toBe('user-1');
    expect(mocks.findUserByIdForAuth).toHaveBeenCalledWith('user-1');
    expect(user?.user.tenant?.tenantId).toBe('tenant-1');
    expect(mocks.redisEval).toHaveBeenCalledTimes(1);
    expect(mocks.redisEval.mock.calls[0]?.[3]).toEqual(expect.any(Number));
    expect(mocks.redisEval.mock.calls[0]?.[0]).toContain('ARGV[1]');
  });

  it('rejects tampering, context mismatch, and tenant mismatch', async () => {
    const capability = createMealPlanWarmupCapability('user-1', 'tenant-1', context);
    const [encoded, signature] = capability.split('.');
    const tampered = `${encoded}.${signature.slice(0, -1)}${signature.endsWith('a') ? 'b' : 'a'}`;
    expect(await resolveMealPlanWarmupCapability(tampered, context)).toBeNull();
    expect(
      await resolveMealPlanWarmupCapability(capability, { ...context, bodyHash: 'changed' })
    ).toBeNull();

    mocks.findUserByIdForAuth.mockResolvedValueOnce({ ...userRow, tenant_id: 'tenant-2' });
    expect(await resolveMealPlanWarmupCapability(capability, context)).toBeNull();
  });

  it('rejects sequential and concurrent replay atomically', async () => {
    const capability = createMealPlanWarmupCapability('user-1', 'tenant-1', context);
    mocks.redisEval.mockResolvedValueOnce(1).mockResolvedValue(0);

    const first = await resolveMealPlanWarmupCapability(capability, context);
    const replay = await resolveMealPlanWarmupCapability(capability, context);
    expect(first?.user.id).toBe('user-1');
    expect(replay).toBeNull();

    const concurrentCapability = createMealPlanWarmupCapability('user-1', 'tenant-1', {
      ...context,
      jobId: 'warmup-job-2',
    });
    mocks.redisEval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const concurrent = await Promise.all([
      resolveMealPlanWarmupCapability(concurrentCapability, { ...context, jobId: 'warmup-job-2' }),
      resolveMealPlanWarmupCapability(concurrentCapability, { ...context, jobId: 'warmup-job-2' }),
    ]);
    expect(concurrent.filter(Boolean)).toHaveLength(1);
  });

  it('rejects a capability that expires while user lookup is in flight', async () => {
    const capability = createMealPlanWarmupCapability('user-1', 'tenant-1', context);
    mocks.findUserByIdForAuth.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(userRow), 10))
    );
    mocks.redisEval.mockResolvedValueOnce(0);

    expect(await resolveMealPlanWarmupCapability(capability, context)).toBeNull();
    expect(mocks.redisEval).toHaveBeenCalledTimes(1);
  });

  it('fails closed when shared replay storage is unavailable', async () => {
    mocks.redisConnect.mockRejectedValueOnce(new Error('redis unavailable'));
    const capability = createMealPlanWarmupCapability('user-1', 'tenant-1', context);

    expect(await resolveMealPlanWarmupCapability(capability, context)).toBeNull();
  });

  it('recovers after a transient replay-storage failure', async () => {
    vi.useFakeTimers();
    mocks.redisConnect.mockRejectedValueOnce(new Error('transient Redis failure'));
    mocks.redisConnect.mockResolvedValueOnce(undefined);
    const capability = createMealPlanWarmupCapability('user-1', 'tenant-1', context);

    expect(await resolveMealPlanWarmupCapability(capability, context)).toBeNull();

    vi.advanceTimersByTime(1_001);
    mocks.redisEval.mockResolvedValueOnce(1);
    const recovered = await resolveMealPlanWarmupCapability(capability, context);

    expect(recovered?.user.id).toBe('user-1');
    expect(mocks.redisConnect).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

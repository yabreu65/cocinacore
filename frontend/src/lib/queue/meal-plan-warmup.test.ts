import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Redis from 'ioredis';
import {
  releaseWarmupSlot,
  renewWarmupSlot,
  reserveWarmupSlot,
  runMealPlanWarmupJob,
  waitForWarmupJobResult,
  WARMUP_MAX_WAITING_JOBS,
} from './meal-plan-warmup';
import type { WarmupMealPlanInput, WarmupMealPlanResult } from '@/lib/meal-planner/recipe-warmup';

const runRedisAdmissionTests = process.env.RUN_WARMUP_QUEUE_ADMISSION_REDIS_TEST === '1';
const describeRedisAdmission = describe.skipIf(!runRedisAdmissionTests);

describeRedisAdmission('warmup queue atomic admission', () => {
  const namespace = `bull:m6-admission-test:${crypto.randomUUID()}`;
  const queue = {
    toKey(type: string): string {
      return `${namespace}:${type}`;
    },
  };
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6381/15', {
    lazyConnect: true,
  });

  beforeAll(async () => {
    await redis.connect();
  });

  beforeEach(async () => {
    await redis.del(queue.toKey('warmup-admission'), queue.toKey('wait'), queue.toKey('paused'));
  });

  afterAll(async () => {
    await redis.del(queue.toKey('warmup-admission'), queue.toKey('wait'), queue.toKey('paused'));
    await redis.quit();
  });

  it('admits a job when capacity exists and releases the reservation', async () => {
    const reservationId = `job-available:${crypto.randomUUID()}`;

    await expect(reserveWarmupSlot(queue, reservationId)).resolves.toBe(true);
    await releaseWarmupSlot(queue, reservationId);
    await expect(reserveWarmupSlot(queue, `job-next:${crypto.randomUUID()}`)).resolves.toBe(true);
  });

  it('rejects admission at the effective waiting limit', async () => {
    await redis.rpush(
      queue.toKey('wait'),
      ...Array.from({ length: WARMUP_MAX_WAITING_JOBS }, () => 'job')
    );

    await expect(reserveWarmupSlot(queue, `job-full:${crypto.randomUUID()}`)).resolves.toBe(false);
  });

  it('allows exactly one producer to reserve the last slot concurrently', async () => {
    await redis.rpush(
      queue.toKey('wait'),
      ...Array.from({ length: WARMUP_MAX_WAITING_JOBS - 1 }, () => 'job')
    );

    const reservationIds = [
      `job-race-a:${crypto.randomUUID()}`,
      `job-race-b:${crypto.randomUUID()}`,
    ];
    const results = await Promise.all(
      reservationIds.map((reservationId) => reserveWarmupSlot(queue, reservationId))
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    for (const [index, admitted] of results.entries()) {
      if (admitted) await releaseWarmupSlot(queue, reservationIds[index]);
    }
  });

  it('does not count duplicate reservations twice', async () => {
    const reservationId = `job-duplicate:${crypto.randomUUID()}`;

    await expect(reserveWarmupSlot(queue, reservationId)).resolves.toBe(true);
    await expect(reserveWarmupSlot(queue, reservationId)).resolves.toBe(true);
    await expect(redis.zcard(queue.toKey('warmup-admission'))).resolves.toBe(1);
    await releaseWarmupSlot(queue, reservationId);
  });

  it('recovers an abandoned expired reservation without allowing a stale slot', async () => {
    const abandoned = `job-abandoned:${crypto.randomUUID()}`;
    const next = `job-after-expiry:${crypto.randomUUID()}`;
    const reservationKey = queue.toKey('warmup-admission');

    await expect(reserveWarmupSlot(queue, abandoned)).resolves.toBe(true);
    await redis.zadd(reservationKey, Date.now() - 1, abandoned);

    await expect(reserveWarmupSlot(queue, next)).resolves.toBe(true);
    await releaseWarmupSlot(queue, next);
  });

  it('renews a live reservation while queue admission is still in progress', async () => {
    const reservationId = `job-renew:${crypto.randomUUID()}`;

    await expect(reserveWarmupSlot(queue, reservationId)).resolves.toBe(true);
    await expect(renewWarmupSlot(queue, reservationId)).resolves.toBe(true);
    await releaseWarmupSlot(queue, reservationId);
    await expect(renewWarmupSlot(queue, reservationId)).resolves.toBe(false);
  });
});

describe('warmup job lease handling', () => {
  it('stops waiting and removes the job when the lease is lost', async () => {
    let markLeaseLost!: () => void;
    let leaseLost = false;
    const leaseLostSignal = new Promise<never>((_, reject) => {
      markLeaseLost = () => {
        leaseLost = true;
        reject(new Error('Warmup admission lease lost'));
      };
    });
    const waitUntilFinished = vi.fn(
      () =>
        new Promise<WarmupMealPlanResult>((resolve) =>
          setTimeout(() => resolve({ calendar: [], failed: 0, warmedSlots: 1 }), 25)
        )
    );
    const removeJob = vi.fn(async () => undefined);

    setTimeout(markLeaseLost, 0);
    await expect(
      waitForWarmupJobResult(waitUntilFinished, leaseLostSignal, () => leaseLost, removeJob)
    ).resolves.toBeNull();

    expect(removeJob).toHaveBeenCalledTimes(1);
    expect(waitUntilFinished).toHaveBeenCalledTimes(1);
  });
});

const runRedisReadinessTest = process.env.RUN_WARMUP_QUEUE_REDIS_READINESS_TEST === '1';
const describeRedisReadiness = describe.skipIf(!runRedisReadinessTest);

describeRedisReadiness('warmup queue Redis readiness', () => {
  it('fails closed within the readiness budget when Redis is unavailable', async () => {
    const startedAt = Date.now();
    await expect(runMealPlanWarmupJob({} as WarmupMealPlanInput)).resolves.toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });
});

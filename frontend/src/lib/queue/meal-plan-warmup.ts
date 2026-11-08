import IORedis from 'ioredis';
import { Queue, QueueEvents, Worker } from 'bullmq';
import {
  hydrateMealPlanWarmup,
  type WarmupMealPlanInput,
  type WarmupMealPlanResult,
} from '@/lib/meal-planner/recipe-warmup';

// BullMQ queue names cannot contain ':'. The prefix remains configurable by BullMQ.
const WARMUP_QUEUE_NAME = 'cocinacore-meal-plan-warmup';
const WARMUP_MAX_ATTEMPTS = 1;
export const WARMUP_MAX_WAITING_JOBS = 10;
const WARMUP_ADMISSION_RESERVATION_TTL_MS = 30_000;
const WARMUP_ADMISSION_RENEWAL_INTERVAL_MS = Math.floor(WARMUP_ADMISSION_RESERVATION_TTL_MS / 3);
const WARMUP_REDIS_READY_TIMEOUT_MS = 1_500;
const WARMUP_REDIS_COMMAND_TIMEOUT_MS = 1_000;

const RESERVE_WARMUP_SLOT_LUA = `
local reservations = KEYS[1]
local waitKey = KEYS[2]
local pausedKey = KEYS[3]
local now = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local maximum = tonumber(ARGV[3])
local reservationId = ARGV[4]

redis.call('ZREMRANGEBYSCORE', reservations, '-inf', now)

local existing = redis.call('ZSCORE', reservations, reservationId)
local reservationCount = redis.call('ZCARD', reservations)
if existing then
  return { 1, reservationCount }
end

local function listCount(key)
  local count = redis.call('LLEN', key)
  local marker = redis.call('LINDEX', key, -1)
  if marker and string.sub(marker, 1, 2) == '0:' then
    if count > 1 then
      redis.call('RPOP', key)
      return count - 1
    end
    return 0
  end
  return count
end

local waitingCount = listCount(waitKey) + listCount(pausedKey)
if waitingCount + reservationCount >= maximum then
  return { 0, waitingCount + reservationCount }
end

redis.call('ZADD', reservations, now + ttl, reservationId)
redis.call('PEXPIRE', reservations, ttl + 1000)
return { 1, waitingCount + reservationCount + 1 }
`;

const RELEASE_WARMUP_SLOT_LUA = `
local removed = redis.call('ZREM', KEYS[1], ARGV[1])
if redis.call('ZCARD', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1])
end
return removed
`;

const RENEW_WARMUP_SLOT_LUA = `
local reservations = KEYS[1]
local reservationId = ARGV[1]
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
if redis.call('ZSCORE', reservations, reservationId) == false then
  return 0
end
redis.call('ZADD', reservations, now + ttl, reservationId)
redis.call('PEXPIRE', reservations, ttl + 1000)
return 1
`;

type GlobalWarmupQueue = typeof globalThis & {
  __cocinacoreWarmupRedis?: IORedis;
  __cocinacoreWarmupBlockingRedis?: IORedis;
  __cocinacoreWarmupAdmissionRedis?: IORedis;
  __cocinacoreWarmupAdmissionRedisPromise?: Promise<IORedis | null>;
  __cocinacoreWarmupAdmissionRedisUnavailableUntil?: number;
  __cocinacoreWarmupQueue?: Queue;
  __cocinacoreWarmupQueueEvents?: QueueEvents;
  __cocinacoreWarmupWorker?: Worker;
};

function getGlobalWarmupQueue(): GlobalWarmupQueue {
  return globalThis as GlobalWarmupQueue;
}

function getRedisUrl(): string | null {
  return process.env.REDIS_URL?.trim() || null;
}

function ensureRedisConnection(): IORedis | null {
  const redisUrl = getRedisUrl();
  if (!redisUrl) return null;

  const globalQueue = getGlobalWarmupQueue();
  if (!globalQueue.__cocinacoreWarmupRedis) {
    globalQueue.__cocinacoreWarmupRedis = new IORedis(redisUrl, {
      maxRetriesPerRequest: 0,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: WARMUP_REDIS_COMMAND_TIMEOUT_MS,
      commandTimeout: WARMUP_REDIS_COMMAND_TIMEOUT_MS,
      retryStrategy: () => null,
    });
    globalQueue.__cocinacoreWarmupRedis.on('error', () => undefined);
  }
  return globalQueue.__cocinacoreWarmupRedis;
}

function ensureBlockingRedisConnection(): IORedis | null {
  const redisUrl = getRedisUrl();
  if (!redisUrl) return null;

  const globalQueue = getGlobalWarmupQueue();
  if (!globalQueue.__cocinacoreWarmupBlockingRedis) {
    globalQueue.__cocinacoreWarmupBlockingRedis = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: WARMUP_REDIS_COMMAND_TIMEOUT_MS,
      commandTimeout: WARMUP_REDIS_COMMAND_TIMEOUT_MS,
      retryStrategy: () => null,
    });
    globalQueue.__cocinacoreWarmupBlockingRedis.on('error', () => undefined);
  }
  return globalQueue.__cocinacoreWarmupBlockingRedis;
}

async function ensureAdmissionRedis(): Promise<IORedis | null> {
  const globalQueue = getGlobalWarmupQueue();
  const unavailableUntil = globalQueue.__cocinacoreWarmupAdmissionRedisUnavailableUntil ?? 0;
  if (unavailableUntil > Date.now()) return null;
  delete globalQueue.__cocinacoreWarmupAdmissionRedisUnavailableUntil;
  if (globalQueue.__cocinacoreWarmupAdmissionRedis) {
    return globalQueue.__cocinacoreWarmupAdmissionRedis;
  }
  if (globalQueue.__cocinacoreWarmupAdmissionRedisPromise) {
    return globalQueue.__cocinacoreWarmupAdmissionRedisPromise;
  }

  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    globalQueue.__cocinacoreWarmupAdmissionRedisUnavailableUntil = Date.now() + 1_000;
    return null;
  }

  globalQueue.__cocinacoreWarmupAdmissionRedisPromise = (async () => {
    const client = new IORedis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 1_000,
      commandTimeout: 1_000,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    client.on('error', () => undefined);
    try {
      if (!(await waitUntilWarmupRedisReady(client))) {
        client.disconnect();
        globalQueue.__cocinacoreWarmupAdmissionRedisUnavailableUntil = Date.now() + 1_000;
        return null;
      }
      globalQueue.__cocinacoreWarmupAdmissionRedis = client;
      return client;
    } catch {
      client.disconnect();
      globalQueue.__cocinacoreWarmupAdmissionRedisUnavailableUntil = Date.now() + 1_000;
      return null;
    } finally {
      globalQueue.__cocinacoreWarmupAdmissionRedisPromise = undefined;
    }
  })();

  return globalQueue.__cocinacoreWarmupAdmissionRedisPromise;
}

function resetAdmissionRedis(): void {
  const globalQueue = getGlobalWarmupQueue();
  try {
    globalQueue.__cocinacoreWarmupAdmissionRedis?.disconnect();
  } catch {
    // The stale client is discarded below.
  }
  delete globalQueue.__cocinacoreWarmupAdmissionRedis;
  delete globalQueue.__cocinacoreWarmupAdmissionRedisPromise;
  globalQueue.__cocinacoreWarmupAdmissionRedisUnavailableUntil = Date.now() + 1_000;
}

type WarmupQueueKeys = Pick<Queue, 'toKey'>;

function warmupReservationKey(queue: WarmupQueueKeys): string {
  return queue.toKey('warmup-admission');
}

export async function reserveWarmupSlot(
  queue: WarmupQueueKeys,
  reservationId: string
): Promise<boolean> {
  const client = await ensureAdmissionRedis();
  if (!client) return false;

  try {
    const result = (await client.eval(
      RESERVE_WARMUP_SLOT_LUA,
      3,
      warmupReservationKey(queue),
      queue.toKey('wait'),
      queue.toKey('paused'),
      Date.now(),
      WARMUP_ADMISSION_RESERVATION_TTL_MS,
      WARMUP_MAX_WAITING_JOBS,
      reservationId
    )) as unknown;
    return Array.isArray(result) && result[0] === 1;
  } catch {
    resetAdmissionRedis();
    return false;
  }
}

export async function releaseWarmupSlot(
  queue: WarmupQueueKeys,
  reservationId: string
): Promise<void> {
  const client = await ensureAdmissionRedis();
  if (!client) return;

  try {
    await client.eval(RELEASE_WARMUP_SLOT_LUA, 1, warmupReservationKey(queue), reservationId);
  } catch {
    // The lease expires automatically; never turn a completed job into an error.
  }
}

export async function renewWarmupSlot(
  queue: WarmupQueueKeys,
  reservationId: string
): Promise<boolean> {
  const client = await ensureAdmissionRedis();
  if (!client) return false;

  try {
    const result = await client.eval(
      RENEW_WARMUP_SLOT_LUA,
      1,
      warmupReservationKey(queue),
      reservationId,
      Date.now(),
      WARMUP_ADMISSION_RESERVATION_TTL_MS
    );
    return result === 1;
  } catch {
    resetAdmissionRedis();
    return false;
  }
}

function ensureWarmupQueue(): Queue | null {
  const connection = ensureRedisConnection();
  if (!connection) return null;

  const globalQueue = getGlobalWarmupQueue();
  if (!globalQueue.__cocinacoreWarmupQueue) {
    globalQueue.__cocinacoreWarmupQueue = new Queue(WARMUP_QUEUE_NAME, {
      connection: connection as never,
      defaultJobOptions: {
        attempts: WARMUP_MAX_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: 1500,
        },
        removeOnComplete: 25,
        removeOnFail: 25,
      },
    });
    globalQueue.__cocinacoreWarmupQueue.on('error', () => undefined);
  }
  return globalQueue.__cocinacoreWarmupQueue;
}

function ensureWarmupQueueEvents(): QueueEvents | null {
  const connection = ensureBlockingRedisConnection();
  if (!connection) return null;

  const globalQueue = getGlobalWarmupQueue();
  if (!globalQueue.__cocinacoreWarmupQueueEvents) {
    globalQueue.__cocinacoreWarmupQueueEvents = new QueueEvents(WARMUP_QUEUE_NAME, {
      connection: connection as never,
    });
    globalQueue.__cocinacoreWarmupQueueEvents.on('error', () => undefined);
  }
  return globalQueue.__cocinacoreWarmupQueueEvents;
}

function ensureWarmupWorker(): Worker | null {
  const connection = ensureBlockingRedisConnection();
  if (!connection) return null;

  const globalQueue = getGlobalWarmupQueue();
  if (!globalQueue.__cocinacoreWarmupWorker) {
    globalQueue.__cocinacoreWarmupWorker = new Worker(
      WARMUP_QUEUE_NAME,
      async (job) => hydrateMealPlanWarmup(job.data as WarmupMealPlanInput),
      { connection: connection as never }
    );
    globalQueue.__cocinacoreWarmupWorker.on('error', () => undefined);
  }
  return globalQueue.__cocinacoreWarmupWorker;
}

export function isWarmupQueueEnabled(): boolean {
  return Boolean(getRedisUrl());
}

type WarmupReadyResource = {
  waitUntilReady: () => Promise<unknown>;
  disconnect: () => void | Promise<void>;
};

async function waitUntilWarmupResourceReady(resource: WarmupReadyResource): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      resource.waitUntilReady(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Warmup Redis readiness timeout')),
          WARMUP_REDIS_READY_TIMEOUT_MS
        );
      }),
    ]);
    return true;
  } catch {
    try {
      await resource.disconnect();
    } catch {
      // The resource is already unusable; the request still fails closed.
    }
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitUntilWarmupRedisReady(client: IORedis): Promise<boolean> {
  if ((client.status as string) === 'ready') return true;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const connectPromise = client
    .connect()
    .then(() => (client.status as string) === 'ready')
    .catch(() => false);
  try {
    const ready = await Promise.race([
      connectPromise,
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), WARMUP_REDIS_READY_TIMEOUT_MS);
      }),
    ]);
    if (!ready) client.disconnect();
    return ready;
  } catch {
    try {
      client.disconnect();
    } catch {
      // The failed connection is discarded by the caller.
    }
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function waitForWarmupJobResult(
  waitUntilFinished: () => Promise<WarmupMealPlanResult>,
  leaseLostSignal: Promise<never>,
  isLeaseLost: () => boolean,
  removeJob: () => Promise<unknown>
): Promise<WarmupMealPlanResult | null> {
  try {
    return await Promise.race([waitUntilFinished(), leaseLostSignal]);
  } catch (error) {
    if (!isLeaseLost()) throw error;
    await removeJob().catch(() => undefined);
    return null;
  }
}

function resetWarmupInfrastructure(): void {
  const globalQueue = getGlobalWarmupQueue();
  for (const resource of [
    globalQueue.__cocinacoreWarmupQueue,
    globalQueue.__cocinacoreWarmupQueueEvents,
    globalQueue.__cocinacoreWarmupWorker,
  ]) {
    try {
      resource?.disconnect();
    } catch {
      // The next request creates a fresh resource after a failed readiness check.
    }
  }
  try {
    globalQueue.__cocinacoreWarmupRedis?.disconnect();
    globalQueue.__cocinacoreWarmupBlockingRedis?.disconnect();
  } catch {
    // Best-effort cleanup only.
  }
  resetAdmissionRedis();
  delete globalQueue.__cocinacoreWarmupRedis;
  delete globalQueue.__cocinacoreWarmupBlockingRedis;
  delete globalQueue.__cocinacoreWarmupQueue;
  delete globalQueue.__cocinacoreWarmupQueueEvents;
  delete globalQueue.__cocinacoreWarmupWorker;
}

export async function runMealPlanWarmupJob(
  payload: WarmupMealPlanInput
): Promise<WarmupMealPlanResult | null> {
  const producerConnection = ensureRedisConnection();
  const blockingConnection = ensureBlockingRedisConnection();
  if (!producerConnection || !blockingConnection) return null;

  const redisReady = await Promise.all([
    waitUntilWarmupRedisReady(producerConnection),
    waitUntilWarmupRedisReady(blockingConnection),
  ]);
  if (redisReady.some((ready) => !ready)) {
    resetWarmupInfrastructure();
    return null;
  }

  const queue = ensureWarmupQueue();
  if (!queue) return null;

  const queueEvents = ensureWarmupQueueEvents();
  const worker = ensureWarmupWorker();
  if (!queueEvents || !worker) return null;

  const resourcesReady = await Promise.all([
    waitUntilWarmupResourceReady(queue),
    waitUntilWarmupResourceReady(queueEvents),
    waitUntilWarmupResourceReady(worker),
  ]);
  if (resourcesReady.some((ready) => !ready)) {
    resetWarmupInfrastructure();
    return null;
  }

  const jobId =
    payload.actorUserId && payload.actorTenantId
      ? `warmup:${payload.actorTenantId}:${payload.actorUserId}-${payload.warmupRequestId ?? crypto.randomUUID()}`
      : `warmup:anonymous:${crypto.randomUUID()}`;
  const reservationId = `${jobId}:${crypto.randomUUID()}`;
  if (!(await reserveWarmupSlot(queue, reservationId))) return null;

  let renewalTimer: ReturnType<typeof setInterval> | undefined;
  let leaseLost = false;
  let rejectLeaseLost: (() => void) | undefined;
  const leaseLostSignal = new Promise<never>((_, reject) => {
    rejectLeaseLost = () => reject(new Error('Warmup admission lease lost'));
  });
  const markLeaseLost = () => {
    if (leaseLost) return;
    leaseLost = true;
    rejectLeaseLost?.();
  };
  try {
    renewalTimer = setInterval(() => {
      void renewWarmupSlot(queue, reservationId)
        .then((renewed) => {
          if (!renewed) markLeaseLost();
        })
        .catch(() => {
          markLeaseLost();
        });
    }, WARMUP_ADMISSION_RENEWAL_INTERVAL_MS);
    const job = await queue.add('hydrate', payload, { jobId });
    if (leaseLost) {
      await job.remove().catch(() => undefined);
      return null;
    }
    return await waitForWarmupJobResult(
      () => job.waitUntilFinished(queueEvents) as Promise<WarmupMealPlanResult>,
      leaseLostSignal,
      () => leaseLost,
      () => job.remove()
    );
  } finally {
    if (renewalTimer) clearInterval(renewalTimer);
    await releaseWarmupSlot(queue, reservationId);
  }
}

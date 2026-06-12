import IORedis from 'ioredis';
import { Queue, QueueEvents, Worker } from 'bullmq';
import {
  hydrateMealPlanWarmup,
  type WarmupMealPlanInput,
  type WarmupMealPlanResult,
} from '@/lib/meal-planner/recipe-warmup';

const WARMUP_QUEUE_NAME = 'cocinacore:meal-plan:warmup';

type GlobalWarmupQueue = typeof globalThis & {
  __cocinacoreWarmupRedis?: IORedis;
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
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
    });
  }
  return globalQueue.__cocinacoreWarmupRedis;
}

function ensureWarmupQueue(): Queue | null {
  const connection = ensureRedisConnection();
  if (!connection) return null;

  const globalQueue = getGlobalWarmupQueue();
  if (!globalQueue.__cocinacoreWarmupQueue) {
    globalQueue.__cocinacoreWarmupQueue = new Queue(WARMUP_QUEUE_NAME, {
      connection: connection as never,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1500,
        },
        removeOnComplete: 25,
        removeOnFail: 25,
      },
    });
  }
  return globalQueue.__cocinacoreWarmupQueue;
}

function ensureWarmupQueueEvents(): QueueEvents | null {
  const connection = ensureRedisConnection();
  if (!connection) return null;

  const globalQueue = getGlobalWarmupQueue();
  if (!globalQueue.__cocinacoreWarmupQueueEvents) {
    globalQueue.__cocinacoreWarmupQueueEvents = new QueueEvents(WARMUP_QUEUE_NAME, {
      connection: connection as never,
    });
  }
  return globalQueue.__cocinacoreWarmupQueueEvents;
}

function ensureWarmupWorker(): Worker | null {
  const connection = ensureRedisConnection();
  if (!connection) return null;

  const globalQueue = getGlobalWarmupQueue();
  if (!globalQueue.__cocinacoreWarmupWorker) {
    globalQueue.__cocinacoreWarmupWorker = new Worker(
      WARMUP_QUEUE_NAME,
      async (job) => hydrateMealPlanWarmup(job.data as WarmupMealPlanInput),
      { connection: connection as never }
    );
  }
  return globalQueue.__cocinacoreWarmupWorker;
}

export function isWarmupQueueEnabled(): boolean {
  return Boolean(getRedisUrl());
}

export async function runMealPlanWarmupJob(
  payload: WarmupMealPlanInput
): Promise<WarmupMealPlanResult | null> {
  const queue = ensureWarmupQueue();
  if (!queue) return null;

  ensureWarmupWorker();
  const queueEvents = ensureWarmupQueueEvents();
  if (!queueEvents) return null;

  await queueEvents.waitUntilReady();
  const job = await queue.add('hydrate', payload);
  return (await job.waitUntilFinished(queueEvents)) as WarmupMealPlanResult;
}

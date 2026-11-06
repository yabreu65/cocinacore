import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import IORedis from 'ioredis';
import { buildAuthUser } from './session';
import { findUserByIdForAuth } from '@/lib/db/repositories/userRepository';
import type { AuthUser } from './types';

const WARMUP_CAPABILITY_TTL_MS = 15 * 60 * 1000;
const CAPABILITY_REDIS_COMMAND_TIMEOUT_MS = 1_000;
const CAPABILITY_ISSUER = 'cocinacore';
const CAPABILITY_AUDIENCE = 'cocinacore:recipe-generate';

export interface MealPlanWarmupCapabilityContext {
  method: 'POST';
  path: '/api/recipe-generate';
  operation: 'recipe-generate';
  jobId: string;
  bodyHash: string;
}

export interface ResolvedMealPlanWarmupCapability {
  user: AuthUser;
  context: MealPlanWarmupCapabilityContext;
}

type WarmupCapabilityPayload = MealPlanWarmupCapabilityContext & {
  issuer: typeof CAPABILITY_ISSUER;
  audience: typeof CAPABILITY_AUDIENCE;
  userId: string;
  tenantId: string;
  issuedAt: number;
  expiresAt: number;
  jti: string;
};

type CapabilityRedisState = typeof globalThis & {
  __cocinacoreCapabilityRedis?: IORedis;
  __cocinacoreCapabilityRedisPromise?: Promise<IORedis | null>;
  __cocinacoreCapabilityRedisUnavailableUntil?: number;
};

const CONSUME_CAPABILITY_LUA = `
local now = redis.call('TIME')
local nowMs = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local expiresAt = tonumber(ARGV[1])
if not expiresAt or nowMs >= expiresAt then
  return 0
end

local ttl = expiresAt - nowMs
local result = redis.call('SET', KEYS[1], '1', 'PX', ttl, 'NX')
if result == 'OK' then
  return 1
end
return 0
`;

function getSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret === 'CHANGE_ME') throw new Error('AUTH_SECRET is not configured.');
  return secret;
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function canonicalize(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`);
  return `{${entries.join(',')}}`;
}

export function hashCapabilityPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalize(payload)).digest('hex');
}

function getCapabilityRedisState(): CapabilityRedisState {
  return globalThis as CapabilityRedisState;
}

async function getCapabilityRedis(): Promise<IORedis | null> {
  const state = getCapabilityRedisState();
  const unavailableUntil = state.__cocinacoreCapabilityRedisUnavailableUntil ?? 0;
  if (unavailableUntil > Date.now()) return null;
  delete state.__cocinacoreCapabilityRedisUnavailableUntil;
  if (state.__cocinacoreCapabilityRedis) return state.__cocinacoreCapabilityRedis;
  if (state.__cocinacoreCapabilityRedisPromise) return state.__cocinacoreCapabilityRedisPromise;

  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    state.__cocinacoreCapabilityRedisUnavailableUntil = Date.now() + 1_000;
    return null;
  }

  state.__cocinacoreCapabilityRedisPromise = (async () => {
    let client: IORedis | undefined;
    try {
      client = new IORedis(redisUrl, {
        lazyConnect: true,
        connectTimeout: CAPABILITY_REDIS_COMMAND_TIMEOUT_MS,
        commandTimeout: CAPABILITY_REDIS_COMMAND_TIMEOUT_MS,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
      });
      client.on('error', () => undefined);
      await client.connect();
      state.__cocinacoreCapabilityRedis = client;
      return client;
    } catch {
      try {
        client?.disconnect();
      } catch {
        // The failed client is discarded below.
      }
      state.__cocinacoreCapabilityRedis?.disconnect();
      delete state.__cocinacoreCapabilityRedis;
      state.__cocinacoreCapabilityRedisUnavailableUntil = Date.now() + 1_000;
      return null;
    } finally {
      state.__cocinacoreCapabilityRedisPromise = undefined;
    }
  })();

  return state.__cocinacoreCapabilityRedisPromise;
}

function resetCapabilityRedis(): void {
  const state = getCapabilityRedisState();
  try {
    state.__cocinacoreCapabilityRedis?.disconnect();
  } catch {
    // The stale client is discarded below.
  }
  delete state.__cocinacoreCapabilityRedis;
  delete state.__cocinacoreCapabilityRedisPromise;
  state.__cocinacoreCapabilityRedisUnavailableUntil = Date.now() + 1_000;
}

async function consumeCapability(jti: string, expiresAt: number): Promise<boolean> {
  const client = await getCapabilityRedis();
  if (!client) return false;

  try {
    const result = await client.eval(
      CONSUME_CAPABILITY_LUA,
      1,
      `cocinacore:capability:used:${jti}`,
      expiresAt
    );
    return result === 1;
  } catch {
    resetCapabilityRedis();
    return false;
  }
}

export function createMealPlanWarmupCapability(
  userId: string,
  tenantId: string,
  context: MealPlanWarmupCapabilityContext
): string {
  const now = Date.now();
  const payload: WarmupCapabilityPayload = {
    ...context,
    issuer: CAPABILITY_ISSUER,
    audience: CAPABILITY_AUDIENCE,
    userId,
    tenantId,
    issuedAt: now,
    expiresAt: now + WARMUP_CAPABILITY_TTL_MS,
    jti: crypto.randomUUID(),
  };
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export async function resolveMealPlanWarmupCapability(
  capability: string | null,
  expectedContext: MealPlanWarmupCapabilityContext
): Promise<ResolvedMealPlanWarmupCapability | null> {
  if (!capability) return null;
  const [encoded, providedSignature, ...extraParts] = capability.split('.');
  if (!encoded || !providedSignature || extraParts.length > 0 || providedSignature.length !== 43) {
    return null;
  }

  const expectedSignature = sign(encoded);
  // Compare the canonical encoded bytes, not only the decoded HMAC bytes.
  // Base64url has non-significant trailing bits that can otherwise create
  // alternate textual signatures decoding to the same digest.
  const provided = Buffer.from(providedSignature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let payload: WarmupCapabilityPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as WarmupCapabilityPayload;
  } catch {
    return null;
  }

  const contextMatches = Object.entries(expectedContext).every(
    ([key, value]) => payload[key as keyof MealPlanWarmupCapabilityContext] === value
  );
  const now = Date.now();
  if (
    payload.issuer !== CAPABILITY_ISSUER ||
    payload.audience !== CAPABILITY_AUDIENCE ||
    !contextMatches ||
    typeof payload.userId !== 'string' ||
    typeof payload.tenantId !== 'string' ||
    typeof payload.jti !== 'string' ||
    payload.jti.length < 16 ||
    !Number.isSafeInteger(payload.issuedAt) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    payload.expiresAt <= now ||
    payload.issuedAt > now ||
    payload.expiresAt - payload.issuedAt > WARMUP_CAPABILITY_TTL_MS
  ) {
    return null;
  }

  const user = await findUserByIdForAuth(payload.userId);
  if (!user || user.tenant_id !== payload.tenantId) return null;
  if (!(await consumeCapability(payload.jti, payload.expiresAt))) return null;
  return { user: await buildAuthUser(user), context: expectedContext };
}

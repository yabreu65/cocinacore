export type E2ETargetEnvironment = Readonly<Record<string, string | undefined>>;

export interface E2EDatabaseTarget {
  protocol: string;
  host: string;
  port: string;
  database: string;
}

export interface E2ERedisTarget {
  protocol: string;
  host: string;
  port: string;
  database: string;
}

export interface ValidatedE2ETargets {
  databaseUrl: string;
  redisUrl: string;
  databaseTarget: E2EDatabaseTarget;
  redisTarget: E2ERedisTarget;
}

function parseTarget(value: string | undefined, variable: string): URL {
  if (!value) {
    throw new Error(`${variable} is required for isolated E2E tests.`);
  }

  try {
    return new URL(value);
  } catch {
    throw new Error(`${variable} must be a valid URL.`);
  }
}

function requireLoopbackPort(url: URL, variable: string, port: string): void {
  if (url.hostname !== '127.0.0.1') {
    throw new Error(`${variable} host must be exactly 127.0.0.1.`);
  }
  if (url.port !== port) {
    throw new Error(`${variable} port must be ${port}.`);
  }
}

export function applyValidatedTargetsToRunner(
  environment: Record<string, string | undefined>
): ValidatedE2ETargets {
  const targets = validateE2ETargets(environment);
  environment.DATABASE_URL = targets.databaseUrl;
  environment.REDIS_URL = targets.redisUrl;
  return targets;
}

export function validateE2ETargets(environment: E2ETargetEnvironment): ValidatedE2ETargets {
  const databaseUrl = environment.E2E_DATABASE_URL;
  const database = parseTarget(databaseUrl, 'E2E_DATABASE_URL');
  if (database.protocol !== 'postgres:' && database.protocol !== 'postgresql:') {
    throw new Error('E2E_DATABASE_URL protocol must be postgres: or postgresql:.');
  }
  requireLoopbackPort(database, 'E2E_DATABASE_URL', '5435');
  if (database.pathname !== '/cocinacore_local_db') {
    throw new Error('E2E_DATABASE_URL database must be /cocinacore_local_db.');
  }

  const redisUrl = environment.E2E_REDIS_URL;
  const redis = parseTarget(redisUrl, 'E2E_REDIS_URL');
  if (redis.protocol !== 'redis:') {
    throw new Error('E2E_REDIS_URL protocol must be redis:.');
  }
  requireLoopbackPort(redis, 'E2E_REDIS_URL', '6381');
  if (!/^\/(?:0|[1-9]\d*)$/.test(redis.pathname) || redis.search || redis.hash) {
    throw new Error('E2E_REDIS_URL must use a conventional Redis database path.');
  }

  return {
    databaseUrl: databaseUrl!,
    redisUrl: redisUrl!,
    databaseTarget: {
      protocol: database.protocol,
      host: database.hostname,
      port: database.port,
      database: database.pathname.slice(1),
    },
    redisTarget: {
      protocol: redis.protocol,
      host: redis.hostname,
      port: redis.port,
      database: redis.pathname.slice(1),
    },
  };
}

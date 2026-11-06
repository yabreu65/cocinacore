import { randomUUID } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { applyValidatedTargetsToRunner } from './e2e/database-target';
import { requireE2EExecutionId } from './e2e/fixtures/isolation';
import { buildStandaloneServerFixtureEnv } from './e2e/standalone-server-env';

const targets = applyValidatedTargetsToRunner(process.env);
const configuredExecutionId = process.env.COCINACORE_E2E_EXECUTION_ID;
if (configuredExecutionId && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(configuredExecutionId)) {
  throw new Error('COCINACORE_E2E_EXECUTION_ID must be a safe lane identifier.');
}
const executionId = configuredExecutionId ?? `pw-${Date.now()}-${randomUUID().slice(0, 8)}`;
const distDir = `.next-e2e-${executionId}`;
process.env.COCINACORE_E2E_EXECUTION_ID = executionId;
process.env.COCINACORE_E2E_CACHE_NAMESPACE = executionId;
process.env.COCINACORE_E2E_DISPOSABLE = 'true';
process.env.COCINACORE_E2E_WORKERS = '1';
requireE2EExecutionId(process.env);
const configuredAppPort = process.env.E2E_APP_PORT ?? '4320';
const appPort = Number(configuredAppPort);
const configuredProviderPort = process.env.E2E_PROVIDER_PORT ?? '4319';
const providerPort = Number(configuredProviderPort);
if (
  !/^\d+$/.test(configuredAppPort) ||
  !Number.isInteger(appPort) ||
  appPort < 1 ||
  appPort > 65535
) {
  throw new Error('E2E_APP_PORT must be an integer from 1 to 65535.');
}

function requireRestrictedDatabaseUrl(variable: string, expectedRole: string): string {
  const value = process.env[variable];
  if (!value) throw new Error(`${variable} is required for isolated E2E tests.`);
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new Error(`${variable} must be a valid database URL.`);
  }
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    target.hostname !== targets.databaseTarget.host ||
    target.port !== targets.databaseTarget.port ||
    target.pathname !== `/${targets.databaseTarget.database}` ||
    decodeURIComponent(target.username) !== expectedRole
  ) {
    throw new Error(`${variable} must use the expected isolated PostgreSQL role and database.`);
  }
  return value;
}

const authDatabaseUrl = requireRestrictedDatabaseUrl('AUTH_DATABASE_URL', 'cocinacore_auth');
const ownerMetricsDatabaseUrl = requireRestrictedDatabaseUrl(
  'OWNER_METRICS_DATABASE_URL',
  'cocinacore_owner_metrics'
);
const ownerGlobalWriterDatabaseUrl = requireRestrictedDatabaseUrl(
  'OWNER_GLOBAL_WRITER_DATABASE_URL',
  'cocinacore_global_writer'
);
if (
  !/^\d+$/.test(configuredProviderPort) ||
  !Number.isInteger(providerPort) ||
  providerPort < 1 ||
  providerPort > 65535
) {
  throw new Error('E2E_PROVIDER_PORT must be an integer from 1 to 65535.');
}

console.info('[e2e] validated targets (credentials redacted)', {
  runner: {
    database: targets.databaseTarget,
    redis: targets.redisTarget,
  },
  appServer: {
    database: targets.databaseTarget,
    redis: targets.redisTarget,
  },
});

const standaloneServerCommand = [
  'env -u DATABASE_URL -u AUTH_DATABASE_URL -u OWNER_METRICS_DATABASE_URL -u OWNER_GLOBAL_WRITER_DATABASE_URL -u BOOTSTRAP_DATABASE_URL -u MIGRATION_DATABASE_URL -u COCINACORE_ACTIVATION_DATABASE_URL npm run build',
  `mkdir -p ${distDir}/standalone/${distDir}`,
  `node -e 'const fs=require("node:fs");const path=require("node:path");const d=process.argv[1];if(!/^\\.next-e2e-[A-Za-z0-9_-]{1,96}$/.test(d))process.exit(1);for(const child of [path.join("standalone",d,"static"),"standalone/public"])fs.rmSync(path.join(d,child),{recursive:true,force:true})' ${distDir}`,
  `cp -R ${distDir}/static ${distDir}/standalone/${distDir}/static`,
  `cp -R public ${distDir}/standalone/public`,
  `PORT=${appPort} HOSTNAME=127.0.0.1 node ${distDir}/standalone/server.js`,
].join(' && ');

const appServerFixtureEnv = buildStandaloneServerFixtureEnv(process.env, providerPort);

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/*.production.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `E2E_PROVIDER_PORT=${providerPort} HOSTNAME=127.0.0.1 node e2e/provider-server.mjs`,
      url: `http://127.0.0.1:${providerPort}/__e2e/health`,
      reuseExistingServer: false,
    },
    {
      command: standaloneServerCommand,
      url: `http://127.0.0.1:${appPort}`,
      reuseExistingServer: false,
      env: {
        ...appServerFixtureEnv,
        DATABASE_URL: targets.appDatabaseUrl,
        AUTH_DATABASE_URL: authDatabaseUrl,
        OWNER_METRICS_DATABASE_URL: ownerMetricsDatabaseUrl,
        OWNER_GLOBAL_WRITER_DATABASE_URL: ownerGlobalWriterDatabaseUrl,
        REDIS_URL: targets.redisUrl,
        COCINACORE_SEPARATED_DB_LANES_ENABLED: 'true',
        COCINACORE_SEPARATE_AUTH_DB: 'true',
        COCINACORE_SIGNUP_BOOTSTRAP_ENABLED: 'true',
        COCINACORE_SIGNUP_MAINTENANCE: 'false',
        COCINACORE_OWNER_METRICS_DB_ENABLED: 'true',
        COCINACORE_OWNER_GLOBAL_WRITER_ENABLED: 'true',
        COCINACORE_E2E_NEXT_DIST_DIR: distDir,
        E2E_DATABASE_URL: '',
        E2E_APP_DATABASE_URL: '',
        E2E_REDIS_URL: '',
        BOOTSTRAP_DATABASE_URL: '',
        MIGRATION_DATABASE_URL: '',
        MIGRATION_ADMIN_PASSWORD: '',
        COCINACORE_ACTIVATION_DATABASE_URL: '',
        CI_E2E_ADMIN_DATABASE_URL: '',
        E2E_USER_EMAIL: '',
        E2E_USER_PASSWORD: '',
        E2E_OWNER_EMAIL: '',
        E2E_OWNER_PASSWORD: '',
      },
    },
  ],
});

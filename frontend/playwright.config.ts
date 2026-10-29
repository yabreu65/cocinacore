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
  'npm run build',
  'mkdir -p .next/standalone/.next',
  'rm -rf .next/standalone/.next/static .next/standalone/public',
  'cp -R .next/static .next/standalone/.next/static',
  'cp -R public .next/standalone/public',
  `PORT=${appPort} HOSTNAME=127.0.0.1 node .next/standalone/server.js`,
].join(' && ');

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
        ...buildStandaloneServerFixtureEnv(process.env, providerPort),
        DATABASE_URL: targets.databaseUrl,
        REDIS_URL: targets.redisUrl,
      },
    },
  ],
});

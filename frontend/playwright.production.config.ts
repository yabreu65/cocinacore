import { defineConfig, devices } from '@playwright/test';
import { validateProductionEnvironment } from './src/lib/e2e-production-config';

const production = validateProductionEnvironment(process.env);

export default defineConfig({
  testDir: './e2e/production',
  testMatch: '**/*.production.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: production.baseURL,
    trace: 'off',
    video: 'off',
  },
});

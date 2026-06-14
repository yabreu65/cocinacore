import { defineConfig, devices } from '@playwright/test';

const standaloneServerCommand = [
  'npm run build',
  'mkdir -p .next/standalone/.next',
  'rm -rf .next/standalone/.next/static .next/standalone/public',
  'cp -R .next/static .next/standalone/.next/static',
  'cp -R public .next/standalone/public',
  'PORT=3000 HOSTNAME=0.0.0.0 node .next/standalone/server.js',
].join(' && ');

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: standaloneServerCommand,
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgresql://cocinacore_user:cocinacore_password@localhost:5433/cocinacore_local_db',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e-auth-secret-change-me',
      GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? 'CHANGE_ME',
      STORAGE_DRIVER: process.env.STORAGE_DRIVER ?? 'local',
      LOCAL_UPLOAD_DIR: process.env.LOCAL_UPLOAD_DIR ?? './uploads',
    },
  },
});

import { Page } from '@playwright/test';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_EMAIL = process.env.E2E_USER_EMAIL ?? 'test@cocinacore.local';
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD ?? 'TestPassword123!';

/**
 * Authenticate through the app login API so Supabase issues real session cookies.
 */
export async function injectAuth(
  page: Page,
  userId: string = TEST_USER_ID
): Promise<void> {
  const response = await page.request.post('/api/auth/login', {
    data: {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    },
  });

  if (!response.ok()) {
    throw new Error(
      `E2E login failed for ${TEST_EMAIL} (${userId}). Seed a confirmed Supabase auth user or set E2E_USER_EMAIL/E2E_USER_PASSWORD.`
    );
  }
}

/**
 * Clear auth cookies (for testing unauthenticated flows)
 */
export async function clearAuth(page: Page): Promise<void> {
  await page.context().clearCookies();
}

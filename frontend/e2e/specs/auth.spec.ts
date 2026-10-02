import { test, expect } from '@playwright/test';
import { injectAuth, clearAuth, hasExplicitE2ECredentials } from '../fixtures/auth';
import { LoginPage } from '../pages/login';

test.describe('Authentication', () => {
  test('signup is disabled when either explicit E2E credential is configured', () => {
    expect(hasExplicitE2ECredentials('e2e-email@example.invalid', undefined)).toBe(true);
    expect(hasExplicitE2ECredentials(undefined, 'configured-placeholder')).toBe(true);
    expect(hasExplicitE2ECredentials(undefined, undefined)).toBe(false);
  });

  test('unauthenticated user is redirected to login', async ({ page }) => {
    await clearAuth(page);
    await page.goto('/app');

    // Should redirect to login
    await expect(page).toHaveURL(/.*login.*/);
  });

  test('unauthenticated user is redirected to login from legacy dashboard', async ({ page }) => {
    await clearAuth(page);
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/.*login.*/);
  });

  test('unauthenticated user is redirected to login from shopping-list', async ({ page }) => {
    await clearAuth(page);
    await page.goto('/shopping-list');

    await expect(page).toHaveURL(/.*login.*/);
  });

  test('authenticated user can access protected routes', async ({ page }) => {
    await injectAuth(page);

    const profileResponse = await page.request.get('/api/profile');
    expect(profileResponse.status()).toBe(200);

    await page.goto('/app');

    // Should stay on /app
    await expect(page).toHaveURL('/app');
    await expect(page.locator('body')).toContainText('CocinaCore');
  });

  test('login page loads correctly', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await expect(page).toHaveURL('/login');
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();
  });
});

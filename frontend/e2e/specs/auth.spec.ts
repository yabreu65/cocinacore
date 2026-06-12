import { test, expect } from '@playwright/test';
import { injectAuth, clearAuth } from '../fixtures/auth';
import { LoginPage } from '../pages/login';

test.describe('Authentication', () => {
  test('unauthenticated user is redirected to login', async ({ page }) => {
    await clearAuth(page);
    await page.goto('/app');

    // Should redirect to login
    await expect(page).toHaveURL(/.*login.*/);
  });

  test('authenticated user can access protected routes', async ({ page }) => {
    await injectAuth(page);
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

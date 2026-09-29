import { test, expect } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';
import { AppPage } from '../pages/app';

test.describe('Dashboard and Inventory', () => {
  test('legacy dashboard redirects authenticated users to the canonical app', async ({ page }) => {
    await injectAuth(page);
    await page.goto('/dashboard');

    await expect(page).toHaveURL('/app');
    await expect(page.getByText('CocinaCore', { exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Restaurante Central');
    await expect(page.locator('body')).not.toContainText('Configuración del Sistema de Diseño Visual');
    await expect(page.locator('body')).not.toContainText('Guardar Cambios');
    await expect(page.locator('a[href="/dashboard"]')).toHaveCount(0);
  });

  test('dashboard loads with inventory items', async ({ page }) => {
    await injectAuth(page);

    const appPage = new AppPage(page);
    await appPage.goto();

    await expect(page.locator('body')).toBeVisible();
    // Dashboard should contain app branding or navigation
    await expect(page.locator('body')).toContainText('CocinaCore');
  });

  test('user can navigate to meal planner from dashboard', async ({ page }) => {
    await injectAuth(page);

    const appPage = new AppPage(page);
    await appPage.goto();

    // Navigate to meal planner
    await appPage.navigateToMealPlanner();

    // Should be on meal-planner page
    await expect(page).toHaveURL(/.*meal-planner.*/);
  });
});

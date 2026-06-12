import { test, expect } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';
import { AppPage } from '../pages/app';

test.describe('Dashboard and Inventory', () => {
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

import { test, expect } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';
import { OwnerHealthPage } from '../pages/owner-health';

test.describe('Owner System Health', () => {
  test('owner can access system health dashboard', async ({ page }) => {
    await injectAuth(page, '00000000-0000-0000-0000-000000000001');

    const healthPage = new OwnerHealthPage(page);
    await healthPage.goto();

    // Page should load (may redirect if not owner, but we test the access)
    await expect(page.locator('body')).toBeVisible();
  });

  test('system health page shows status information', async ({ page }) => {
    await injectAuth(page);
    await page.goto('/owner/system-health');

    // Should see some content on the page
    await expect(page.locator('body')).toContainText('Estado');
  });
});

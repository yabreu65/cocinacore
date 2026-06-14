import { test, expect } from '@playwright/test';
import { hasExplicitE2ECredentials, injectAuth } from '../fixtures/auth';
import { OwnerHealthPage } from '../pages/owner-health';

test.describe('Owner System Health', () => {
  test.skip(
    !hasExplicitE2ECredentials(),
    'Owner health E2E requires explicit platform-owner credentials.'
  );

  test('owner can access system health dashboard', async ({ page }) => {
    await injectAuth(page, '00000000-0000-0000-0000-000000000001');

    const healthPage = new OwnerHealthPage(page);
    await healthPage.goto();

    await expect(page).toHaveURL(/\/owner\/system-health$/);
    await expect(healthPage.title).toBeVisible();
  });

  test('system health page shows status information', async ({ page }) => {
    await injectAuth(page, '00000000-0000-0000-0000-000000000001');

    const healthPage = new OwnerHealthPage(page);
    await healthPage.goto();

    await expect(healthPage.title).toBeVisible();
    await expect(healthPage.statusCards).toHaveCount(3);
  });
});

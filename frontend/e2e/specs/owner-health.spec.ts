import { test, expect } from '@playwright/test';
import { hasExplicitOwnerCredentials, injectOwnerAuth } from '../fixtures/auth';
import { OwnerHealthPage } from '../pages/owner-health';

test.describe('Owner System Health', () => {
  test.skip(
    !hasExplicitOwnerCredentials(),
    'Owner health E2E requires explicit platform-owner credentials.'
  );

  test('owner can access system health dashboard', async ({ page }) => {
    await injectOwnerAuth(page);

    const healthPage = new OwnerHealthPage(page);
    await healthPage.goto();

    await expect(page).toHaveURL(/\/owner\/system-health$/);
    await expect(healthPage.title).toBeVisible();
  });

  test('system health page shows status information', async ({ page }) => {
    await injectOwnerAuth(page);

    const healthPage = new OwnerHealthPage(page);
    await healthPage.goto();

    await expect(healthPage.title).toBeVisible();
    await expect(healthPage.statusCards).toHaveCount(3);
  });
});

import { expect, test } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';

const sessionId = '00000000-0000-4000-8000-000000000001';

test.describe('M6 cooking teacher safety boundary', () => {
  test('rejects anonymous teacher requests before loading session context', async ({ page }) => {
    const response = await page.request.post(`/api/cooking-sessions/${sessionId}/teacher`, {
      data: { question: 'Explicame el paso actual.' },
    });

    expect(response.status()).toBe(401);
  });

  test('rejects an invalid question without invoking a provider', async ({ page }) => {
    await injectAuth(page);
    const response = await page.request.post(`/api/cooking-sessions/${sessionId}/teacher`, {
      data: { question: '' },
    });

    expect(response.status()).toBe(400);
  });
});

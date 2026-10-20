import { expect, test } from '@playwright/test';
import { readProductionAuthEnvironment } from '../../src/lib/e2e-production-config';
import { authenticateProductionUser } from '../../src/lib/production-e2e-auth';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

test('authenticated user can read a bounded active recipe list', async ({ request }) => {
  const auth = readProductionAuthEnvironment(process.env);
  await authenticateProductionUser(request, auth);

  const response = await request.get('/api/recipes?archived=active&limit=10&offset=0');
  expect(response.ok()).toBe(true);

  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new Error('Recipe list response has an invalid shape.');
  }
  expect(Array.isArray(payload.items)).toBe(true);
});

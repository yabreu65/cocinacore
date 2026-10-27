import { expect, test, type APIRequestContext } from '@playwright/test';
import { readProductionAuthEnvironment } from '../../src/lib/e2e-production-config';
import { authenticateProductionUser } from '../../src/lib/production-e2e-auth';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function annotatePartial(description: string): void {
  test.info().annotations.push({ type: 'partial', description });
}

function assertNoPrivateFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoPrivateFields);
    return;
  }
  if (!isRecord(value)) return;

  expect(value).not.toHaveProperty('tenant_id');
  expect(value).not.toHaveProperty('user_id');
  expect(value).not.toHaveProperty('password');
  expect(value).not.toHaveProperty('token');
  Object.values(value).forEach(assertNoPrivateFields);
}

function assertCoverageForecast(payload: unknown, horizonDays: 7 | 14): JsonRecord {
  if (!isRecord(payload) || !isRecord(payload.forecast)) {
    throw new Error('Coverage response has an invalid shape.');
  }
  const forecast = payload.forecast;
  expect(forecast.horizonDays).toBe(horizonDays);
  expect(['ready', 'unknown']).toContain(forecast.status);
  expect(typeof forecast.timeZone === 'string' || forecast.timeZone === null).toBe(true);
  expect(typeof forecast.scheduledMealCount).toBe('number');
  expect(typeof forecast.consumedMealCount).toBe('number');
  expect(Array.isArray(forecast.items)).toBe(true);
  expect(isRecord(forecast.summary)).toBe(true);

  for (const item of forecast.items as unknown[]) {
    if (!isRecord(item)) throw new Error('Coverage item has an invalid shape.');
    expect(typeof item.normalizedName).toBe('string');
    expect(['sufficient', 'partial', 'missing', 'unknown']).toContain(item.status);
    for (const field of ['requiredQuantity', 'availableQuantity', 'missingQuantity']) {
      expect(item[field] === null || typeof item[field] === 'number').toBe(true);
    }
  }

  assertNoPrivateFields(payload);
  return forecast;
}

async function authenticate(request: APIRequestContext) {
  return authenticateProductionUser(request, readProductionAuthEnvironment(process.env));
}

async function existingMealPlanId(request: APIRequestContext) {
  await authenticate(request);
  const response = await request.get('/api/meal-plan');
  expect(response.status()).toBe(200);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || payload.plan === null || typeof payload.id !== 'string') {
    annotatePartial('No existe un menú persistido compatible para completar la prueba.');
    return null;
  }
  expect(payload.id).toMatch(/^[0-9a-f-]{36}$/i);
  return payload.id;
}

test.describe('M4 production read-only acceptance', () => {
  test('U1 coverage preserves the requested 7-day horizon and honest uncertainty', async ({
    request,
  }) => {
    await authenticate(request);
    for (const horizonDays of [7, 14] as const) {
      const response = await request.get(`/api/meal-plan/coverage?horizonDays=${horizonDays}`);
      expect(response.status()).toBe(200);
      const forecast = assertCoverageForecast(await response.json(), horizonDays);
      if (forecast.status === 'unknown') {
        annotatePartial(
          'La cobertura productiva no tiene agenda o porciones confirmadas suficientes.'
        );
      }
    }
  });

  test('U2 waste prevention returns a bounded read-only report', async ({ request }) => {
    await authenticate(request);
    const response = await request.get('/api/waste-prevention');
    expect(response.status()).toBe(200);
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !isRecord(payload.report)) {
      throw new Error('Waste prevention response has an invalid shape.');
    }
    const report = payload.report;
    expect(['ready', 'unknown']).toContain(report.status);
    expect(typeof report.timeZone).toBe('string');
    expect(typeof report.windowDays).toBe('number');
    expect(Array.isArray(report.lots)).toBe(true);
    expect(Array.isArray(report.suggestions)).toBe(true);
    for (const lot of report.lots as unknown[]) {
      if (!isRecord(lot)) throw new Error('Waste lot has an invalid shape.');
      expect(['expired', 'due_today', 'due_soon', 'later', 'unknown']).toContain(lot.status);
      expect(['known', 'unknown']).toContain(lot.quantityStatus);
      expect(lot.expirationDate === null || typeof lot.expirationDate === 'string').toBe(true);
    }
    for (const suggestion of report.suggestions as unknown[]) {
      if (!isRecord(suggestion)) throw new Error('Waste suggestion has an invalid shape.');
      expect(['full', 'partial', 'unknown']).toContain(suggestion.coverage);
      expect(Array.isArray(suggestion.ingredients)).toBe(true);
    }
    assertNoPrivateFields(payload);
    if (report.status === 'unknown' || (report.lots as unknown[]).length === 0) {
      annotatePartial(
        'No hubo evidencia productiva suficiente de vencimientos para un PASS completo.'
      );
    }
  });

  test('U3 adaptive proposal is read-only and tied to the authenticated meal plan', async ({
    request,
  }) => {
    const mealPlanId = await existingMealPlanId(request);
    if (!mealPlanId) return;

    const response = await request.post('/api/meal-plan/adaptive-proposal', {
      data: { mealPlanId },
    });
    expect(response.status()).toBe(200);
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !isRecord(payload.proposal)) {
      throw new Error('Adaptive proposal response has an invalid shape.');
    }
    expect(payload.mealPlanId).toBe(mealPlanId);
    expect(typeof payload.expectedUpdatedAt).toBe('string');
    expect(typeof payload.sourceFingerprint).toBe('string');
    const proposal = payload.proposal;
    expect(isRecord(proposal.plan)).toBe(true);
    expect(Array.isArray(proposal.changes)).toBe(true);
    expect(Array.isArray(proposal.lockedSlotKeys)).toBe(true);
    expect(Array.isArray(proposal.evidence)).toBe(true);
    expect(['high', 'medium', 'low', 'unknown']).toContain(proposal.confidence);
    expect(isRecord(proposal.metrics)).toBe(true);
    expect(Array.isArray(proposal.limitations)).toBe(true);
    assertNoPrivateFields(payload);
  });

  test('U4 shopping suggestions are read-only for both supported horizons', async ({ request }) => {
    const mealPlanId = await existingMealPlanId(request);
    if (!mealPlanId) return;

    for (const horizonDays of [7, 14] as const) {
      const response = await request.get(
        `/api/meal-plan/shopping-suggestions?mealPlanId=${encodeURIComponent(mealPlanId)}&horizon=${horizonDays}`
      );
      expect(response.status()).toBe(200);
      const payload: unknown = await response.json();
      if (!isRecord(payload) || !Array.isArray(payload.items) || !isRecord(payload.cost)) {
        throw new Error('Shopping suggestions response has an invalid shape.');
      }
      expect(payload.mealPlanId).toBe(mealPlanId);
      expect(typeof payload.expectedUpdatedAt).toBe('string');
      expect(payload.horizonDays).toBe(horizonDays);
      expect(['ready', 'unknown']).toContain(payload.status);
      expect(['complete', 'partial', 'unknown']).toContain(payload.cost.status);
      for (const item of payload.items) {
        if (!isRecord(item)) throw new Error('Shopping item has an invalid shape.');
        expect(['buy', 'review']).toContain(item.status);
        expect(typeof item.normalizedName).toBe('string');
        expect(typeof item.ingredientName).toBe('string');
        expect(typeof item.alreadyPresent).toBe('boolean');
        expect(item.quantityToBuy === null || typeof item.quantityToBuy === 'number').toBe(true);
      }
      assertNoPrivateFields(payload);
      if (payload.status === 'unknown') {
        annotatePartial('El menú productivo no permite calcular compras con evidencia completa.');
      }
    }
  });

  test('protected M4 endpoints reject anonymous requests', async ({ request }) => {
    const paths = [
      '/api/meal-plan/coverage?horizonDays=7',
      '/api/meal-plan/coverage?horizonDays=14',
      '/api/waste-prevention',
      '/api/meal-plan',
      '/api/meal-plan/adaptive-proposal',
      '/api/meal-plan/shopping-suggestions?mealPlanId=00000000-0000-0000-0000-000000000000&horizon=7',
    ];
    for (const path of paths) {
      const response = await request.get(path);
      expect([401, 403]).toContain(response.status());
    }
  });
});

import { expect, test, type Page } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';
import { STUB_MEAL_PLAN_RESPONSE } from '../fixtures/stubs';

const oldId = 'old-plan';
const newId = 'new-plan';
const schedule = { startDate: '2999-01-01', timeZone: 'UTC', confirmedAt: '2026-01-01T00:00:00Z', portionConfirmation: { peopleCount: 3, confirmedAt: '2026-01-01T00:00:00Z' } };
const shopping = (status: 'unknown' | 'ready') => ({ items: [], status, reason: status === 'unknown' ? 'schedule_not_confirmed' : undefined, expectedUpdatedAt: 'fixture', sourceFingerprint: 'fixture', cost: { status: 'unknown', estimatedTotal: null, knownItemCount: 0, itemCount: 0 } });

async function setup(page: Page, confirmed = false) {
  await injectAuth(page);
  await page.route('**/api/meal-plan/consumption**', (route) => route.fulfill({ json: { consumptions: {} } }));
  await page.route('**/api/meal-plan', (route) => route.fulfill({ json: route.request().method() === 'GET'
    ? { id: oldId, plan: { ...STUB_MEAL_PLAN_RESPONSE.plan, ...(confirmed ? { schedule } : {}) }, content: null, peopleCount: 3, period: 'week' }
    : { id: newId, plan: STUB_MEAL_PLAN_RESPONSE.plan } }));
}

async function fillConfirmation(page: Page) {
  await page.getByLabel('Fecha de inicio').fill('2999-01-01');
  await page.getByLabel(/Confirmo que revisé/).check();
}

test('confirms only explicitly, reports unknown quantities, and refreshes shopping', async ({ page }) => {
  await setup(page);
  let posts = 0;
  let reads = 0;
  await page.route('**/api/meal-plan/shopping-suggestions**', (route) => route.fulfill({ json: shopping(++reads === 1 ? 'unknown' : 'ready') }));
  await page.route('**/api/meal-plan/schedule', (route) => { posts++; return route.fulfill({ json: { mealPlanId: oldId, schedule } }); });
  await page.goto('/meal-planner');
  await expect(page.getByRole('heading', { name: '1. Confirmar fecha y porciones' })).toBeVisible();
  await expect(page.getByText('Este menú guardado es para 3 comensales.')).toBeVisible();
  await expect(page.getByText(/no se puede calcular su compra exacta/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar agenda y porciones' })).toBeDisabled();
  await page.getByLabel('Fecha de inicio').fill('2000-01-01');
  await page.getByLabel(/Confirmo que revisé/).check();
  await page.getByRole('button', { name: 'Confirmar agenda y porciones' }).click();
  expect(posts).toBe(0);
  await page.getByLabel('Fecha de inicio').fill('2999-01-01');
  await page.getByRole('button', { name: 'Confirmar agenda y porciones' }).click();
  await expect(page.getByRole('heading', { name: 'Agenda confirmada' })).toBeVisible();
  await expect.poll(() => reads).toBe(2);
  expect(posts).toBe(1);
});

test('confirmed plans do not require reconfirmation', async ({ page }) => {
  await setup(page, true);
  await page.route('**/api/meal-plan/shopping-suggestions**', (route) => route.fulfill({ json: shopping('ready') }));
  await page.goto('/meal-planner');
  await expect(page.getByRole('heading', { name: 'Agenda confirmada' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar agenda y porciones' })).toHaveCount(0);
});

test('409 is visible and does not claim success', async ({ page }) => {
  await setup(page);
  await page.route('**/api/meal-plan/shopping-suggestions**', (route) => route.fulfill({ json: shopping('unknown') }));
  await page.route('**/api/meal-plan/schedule', (route) => route.fulfill({ status: 409, json: { error: 'El menú cambió. Revisa las cantidades actuales.' } }));
  await page.goto('/meal-planner');
  await fillConfirmation(page);
  await page.getByRole('button', { name: 'Confirmar agenda y porciones' }).click();
  await expect(page.getByRole('alert')).toContainText('El menú cambió');
  await expect(page.getByRole('heading', { name: 'Agenda confirmada' })).toHaveCount(0);
});

test('a late old-plan schedule cannot replace a newly generated plan', async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let received = false;
  let finished!: () => void;
  const responseFinished = new Promise<void>((resolve) => { finished = resolve; });
  await page.route('**/api/meal-plan/shopping-suggestions**', (route) => route.fulfill({ json: shopping('unknown') }));
  await page.route('**/api/meal-plan/schedule', async (route) => { received = true; await held; await route.fulfill({ json: { mealPlanId: oldId, schedule } }).catch(() => undefined); finished(); });
  try {
    await page.goto('/meal-planner');
    await fillConfirmation(page);
    await page.getByRole('button', { name: 'Confirmar agenda y porciones' }).click();
    await expect.poll(() => received).toBe(true);
    await page.getByRole('button', { name: 'Generar menú' }).click();
    await expect(page.getByRole('heading', { name: '1. Confirmar fecha y porciones' })).toBeVisible();
    release();
    await responseFinished;
    await expect(page.getByRole('heading', { name: 'Agenda confirmada' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '1. Confirmar fecha y porciones' })).toBeVisible();
  } finally { release(); }
});

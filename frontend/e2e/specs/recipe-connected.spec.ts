import { expect, test, type Page } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';
import {
  cleanupConnectedRecipeData,
  clearRecipeCache,
  closeE2EDatabase,
  latestRecipeHistory,
  recipeHistoryCount,
  resolveAuthenticatedE2EIdentity,
  seedConnectedRecipeData,
  type ConnectedRecipeSeed,
} from '../fixtures/database';

const PROVIDER_INSPECTION_URL = 'http://127.0.0.1:4319/__e2e/requests';
const PROVIDER_RESET_URL = 'http://127.0.0.1:4319/__e2e/reset';
const GENERATED_TITLE = 'Pollo conectado determinista';

type ProviderRequest = {
  pathname: string;
  body: {
    contents?: Array<{ parts?: Array<{ text?: string }> }>;
  };
};

type ProviderInspection = {
  generationCallCount: number;
  requests: ProviderRequest[];
};

async function resetProvider(page: Page): Promise<void> {
  const response = await page.request.post(PROVIDER_RESET_URL);
  expect(response.ok()).toBeTruthy();
}

async function inspectProvider(page: Page): Promise<ProviderInspection> {
  const response = await page.request.get(PROVIDER_INSPECTION_URL);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as ProviderInspection;
}

function generationPrompt(inspection: ProviderInspection): string {
  const generation = inspection.requests.find((request) =>
    request.pathname.endsWith(':generateContent')
  );
  return generation?.body.contents?.[0]?.parts?.[0]?.text ?? '';
}

async function generateRecipe(page: Page, mode: 'free' | 'rag'): Promise<void> {
  await page.goto('/recipes/search');
  await expect(page.getByRole('heading', { name: 'Buscar recetas' })).toBeVisible();

  await page.getByLabel(/Quiero cocinar con/).fill('chicken');
  const restrictions = page.getByLabel('Restricciones (separadas por comas)');
  await restrictions.fill('none');
  await expect(restrictions).toHaveValue('none');
  await page.getByLabel('Modo').selectOption(mode);
  await page.getByRole('button', { name: 'Generar receta' }).click();

  await expect(page.getByRole('heading', { name: GENERATED_TITLE, exact: true })).toBeVisible();
}

test.describe('Connected recipe search', () => {
  test.describe.configure({ mode: 'serial' });

  let seed: ConnectedRecipeSeed | null = null;

  test.beforeEach(async ({ page }, testInfo) => {
    await injectAuth(page);
    await clearRecipeCache();
    await resetProvider(page);
    const identity = await resolveAuthenticatedE2EIdentity(page);
    seed = await seedConnectedRecipeData({
      identity,
      runId: `recipe-connected-${testInfo.title}`,
      includeRagChunks: !testInfo.title.includes('no-context'),
    });
  });

  test.afterEach(async ({ page }) => {
    if (seed) {
      await cleanupConnectedRecipeData(seed);
      seed = null;
    }
    await clearRecipeCache();
    await resetProvider(page);
  });

  test.afterAll(async () => {
    await closeE2EDatabase();
  });

  test('uses authenticated persisted context, authorized RAG sources, history, and cache', async ({
    page,
  }) => {
    if (!seed) throw new Error('Connected recipe seed was not initialized.');

    await generateRecipe(page, 'rag');

    const firstInspection = await inspectProvider(page);
    const prompt = generationPrompt(firstInspection);
    expect(firstInspection.generationCallCount).toBe(1);
    expect(prompt).toContain('tomato');
    expect(prompt).toContain('rice');
    expect(prompt).toContain('chicken');
    expect(prompt).toContain('Preferencias: family');
    expect(prompt).toContain('Evitar: peanut');
    expect(prompt).toContain('Nivel: Intermedio');
    expect(prompt).toContain('Ingredientes solicitados explícitamente: chicken');
    expect(prompt).toContain(seed.globalBookTitle);
    expect(prompt).toContain(seed.tenantBookTitle);
    expect(prompt).not.toContain(seed.tenantBSecretMarker);
    expect(prompt).not.toContain(seed.tenantBBookTitle);

    await expect(page.getByRole('heading', { name: 'Fuentes del recetario' })).toHaveCount(0);
    await expect(page.getByText(seed.globalBookTitle, { exact: true })).toHaveCount(0);
    await expect(page.getByText(seed.tenantBookTitle, { exact: true })).toHaveCount(0);
    await expect(page.getByText('Página 7', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Página 11', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Historial', exact: true })).toHaveAttribute('href', '/recipes/history');
    await expect(page.getByText(seed.tenantBBookTitle, { exact: true })).toHaveCount(0);
    await expect(page.getByText(seed.tenantBSecretMarker, { exact: true })).toHaveCount(0);

    const firstHistory = await latestRecipeHistory(seed.identity);
    expect(firstHistory).not.toBeNull();
    expect(firstHistory?.user_id).toBe(seed.identity.userId);
    expect(firstHistory?.tenant_id).toBe(seed.identity.tenantId);
    expect(firstHistory?.recipe_payload.mode).toBe('rag');
    expect(firstHistory?.recipe_payload.ragContextUsed).toBe(true);
    expect(firstHistory?.recipe_payload.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: seed.globalBookTitle })])
    );
    expect(firstHistory?.recipe_payload.sources).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ title: seed.tenantBBookTitle })])
    );
    expect(firstHistory?.recipe_payload.structuredIngredients).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'pollo' })])
    );
    expect(await recipeHistoryCount(seed.identity)).toBe(seed.originalHistoryIds.length + 1);

    await page.getByRole('button', { name: 'Generar receta' }).click();
    await expect
      .poll(() => recipeHistoryCount(seed!.identity))
      .toBe(seed.originalHistoryIds.length + 2);
    const cachedInspection = await inspectProvider(page);
    expect(cachedInspection.generationCallCount).toBe(1);

    await page.getByRole('link', { name: 'Historial', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Historial de recetas' })).toBeVisible();
    const historyEntry = page.getByRole('listitem').filter({ hasText: GENERATED_TITLE }).first();
    await expect(historyEntry).toBeVisible();
    await expect(
      historyEntry.getByRole('button', { name: 'Marcar para consultar' })
    ).toHaveAttribute('aria-pressed', 'false');
    await historyEntry.getByRole('button', { name: 'Ver detalle' }).click();
    await expect(historyEntry).toContainText('Cociná el arroz y reservá.');

    const historySources = historyEntry.getByRole('region', { name: 'Fuentes del recetario' });
    await expect(historySources).toContainText(seed.globalBookTitle);
    await expect(historySources).toContainText(seed.tenantBookTitle);
    await expect(historySources).not.toContainText(seed.tenantBBookTitle);
    await expect(historySources).toContainText('Página 7');
    await expect(historySources).toContainText('Página 11');
    await expect(historySources).not.toContainText(seed.tenantBSecretMarker);


    await historyEntry.getByRole('button', { name: 'Marcar para consultar' }).click();
    await expect.poll(async () => (await latestRecipeHistory(seed!.identity))?.is_saved).toBe(true);

    await page.reload();
    const reloadedHistoryEntry = page
      .getByRole('listitem')
      .filter({ hasText: GENERATED_TITLE })
      .first();
    await expect(reloadedHistoryEntry).toBeVisible();
    await expect(
      reloadedHistoryEntry.getByRole('button', { name: 'Quitar marca' })
    ).toHaveAttribute('aria-pressed', 'true');

    await page.getByLabel('Mostrar recetas').selectOption('saved');
    await expect(reloadedHistoryEntry).toBeVisible();
    await reloadedHistoryEntry.getByRole('button', { name: 'Quitar marca' }).click();
    await expect
      .poll(async () => (await latestRecipeHistory(seed!.identity))?.is_saved)
      .toBe(false);

    await page.reload();
    await expect(page.getByLabel('Mostrar recetas')).toHaveValue('saved');
    await expect(page.getByRole('listitem').filter({ hasText: GENERATED_TITLE })).toHaveCount(0);
    await expect(
      page.getByText('Aún no hay ideas marcadas para consultar.', { exact: true })
    ).toBeVisible();

    await page.getByLabel('Mostrar recetas').selectOption('all');
    const allHistoryEntry = page.getByRole('listitem').filter({ hasText: GENERATED_TITLE }).first();
    await expect(allHistoryEntry).toBeVisible();
    await expect(
      allHistoryEntry.getByRole('button', { name: 'Marcar para consultar' })
    ).toHaveAttribute('aria-pressed', 'false');
  });

  test('uses persisted context in authenticated free mode without citations', async ({ page }) => {
    if (!seed) throw new Error('Connected recipe seed was not initialized.');

    await generateRecipe(page, 'free');

    const prompt = generationPrompt(await inspectProvider(page));
    expect(prompt).toContain('tomato');
    expect(prompt).toContain('rice');
    expect(prompt).toContain('chicken');
    expect(prompt).toContain('Preferencias: family');
    expect(prompt).toContain('Evitar: peanut');
    await expect(page.getByRole('heading', { name: 'Fuentes del recetario' })).toHaveCount(0);

    const history = await latestRecipeHistory(seed.identity);
    expect(history?.recipe_payload.mode).toBe('free');
    expect(history?.recipe_payload.ragContextUsed).toBe(false);
  });

  test('returns a no-context RAG recipe without fake citations', async ({ page }) => {
    if (!seed) throw new Error('Connected recipe seed was not initialized.');

    await generateRecipe(page, 'rag');

    const prompt = generationPrompt(await inspectProvider(page));
    expect(prompt).toContain('Sin contexto documental relevante encontrado para esta búsqueda.');
    await expect(page.getByRole('heading', { name: 'Fuentes del recetario' })).toHaveCount(0);
    await expect(page.getByText(seed.globalBookTitle, { exact: true })).toHaveCount(0);
    await expect(page.getByText(seed.tenantBookTitle, { exact: true })).toHaveCount(0);
    await expect(
      page.getByText('No se encontró contexto documental relevante para esta receta.', {
        exact: true,
      })
    ).toBeVisible();

    const history = await latestRecipeHistory(seed.identity);
    expect(history?.recipe_payload.mode).toBe('rag');
    expect(history?.recipe_payload.ragContextUsed).toBe(false);
    expect(history?.recipe_payload.sources).toEqual([]);
  });
  test('keeps saved restrictions and rejects incompatible proposals in free and PDF modes', async ({ page }) => {
    if (!seed) throw new Error('Connected recipe seed was not initialized.');
    const originalCount = await recipeHistoryCount(seed.identity);
    for (const mode of ['free', 'rag'] as const) {
      await resetProvider(page);
      const response = await page.request.post('/api/recipe-generate', {
        data: { mode, ingredients: ['pollo'], culinaryProfile: { avoid: ['Vegano'] } },
      });
      expect(response.status()).toBe(422);
      expect(await response.json()).toMatchObject({ code: 'RECIPE_RESTRICTION_CONFLICT' });
      const inspection = await inspectProvider(page);
      expect(inspection.generationCallCount).toBe(1);
      const prompt = generationPrompt(inspection);
      expect(prompt).toContain('Restricciones duras: peanut, Vegano');
      expect(prompt).toContain('tienen prioridad sobre el contexto documental');
      if (mode === 'rag') expect(prompt).toContain(seed.globalBookTitle);
      expect(await recipeHistoryCount(seed.identity)).toBe(originalCount);
    }
  });

});

import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { injectAuth, installResponseCookies } from '../fixtures/auth';
import { clearRecipeCache } from '../fixtures/database';
import {
  closeRecipePersistentDatabase,
  cleanupConnectedRecipeRun,
  cleanupTemporaryRecipeUser,
  latestRecipeHistory,
  recipeImportLink,
  resolveRecipePersistentIdentity,
  type RecipePersistentIdentity,
} from '../fixtures/recipe-persistent';

const PROVIDER_RESET_URL = 'http://127.0.0.1:4319/__e2e/reset';
const GENERATED_TITLE = 'Pollo conectado determinista';
const TEST_PASSWORD = 'TemporaryE2EPassword123!';

async function signupTemporaryUser(page: Page, email: string): Promise<void> {
  const response = await page.request.post('/api/auth/signup', {
    data: {
      email,
      password: TEST_PASSWORD,
      confirmPassword: TEST_PASSWORD,
      fullName: 'Temporary E2E User',
      termsAccepted: true,
    },
  });
  if (!response.ok()) {
    throw new Error(`Temporary E2E signup failed (${response.status()}).`);
  }
  await installResponseCookies(page, response);
}

async function resolveIdentity(page: Page): Promise<RecipePersistentIdentity> {
  return resolveRecipePersistentIdentity(await page.request.get('/api/profile'));
}

async function resetProvider(page: Page): Promise<void> {
  const response = await page.request.post(PROVIDER_RESET_URL);
  expect(response.ok()).toBeTruthy();
}

async function createRecipe(
  page: Page,
  title: string,
  instructions: string,
  excludedIds: readonly string[] = []
) {
  await page.goto('/recipes');
  await page.getByRole('button', { name: 'Crear receta' }).click();
  await page.getByLabel('Título', { exact: true }).fill(title);
  await page.getByLabel('Pasos y notas').fill(instructions);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
  const response = await page.request.get('/api/recipes?archived=active&limit=100&offset=0');
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    items: Array<{ id: string; current_version: { title: string } }>;
  };
  const recipe = payload.items.find(
    (item) => item.current_version.title === title && !excludedIds.includes(item.id)
  );
  expect(recipe).toBeDefined();
  const recipeId = recipe!.id;
  return recipeId;
}

async function generateRecipe(page: Page): Promise<void> {
  await page.goto('/recipes/search');
  await expect(page.getByRole('heading', { name: 'Buscar recetas' })).toBeVisible();
  await page.getByLabel(/Quiero cocinar con/).fill('chicken');
  await page.getByLabel('Restricciones (separadas por comas)').fill('none');
  await page.getByLabel('Modo').selectOption('free');
  await page.getByRole('button', { name: 'Generar receta' }).click();
  await expect(page.getByRole('heading', { name: GENERATED_TITLE, exact: true })).toBeVisible();
}

test.describe('Connected persistent recipe lifecycle', () => {
  test.describe.configure({ mode: 'serial' });

  let primaryIdentity: RecipePersistentIdentity | null = null;
  let recipeIds: string[] = [];
  let historyIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
    await clearRecipeCache();
    await resetProvider(page);
    primaryIdentity = await resolveIdentity(page);
    recipeIds = [];
    historyIds = [];
  });

  test.afterEach(async ({ page }) => {
    if (primaryIdentity) {
      await cleanupConnectedRecipeRun(primaryIdentity, recipeIds, historyIds);
    }
    await clearRecipeCache();
    await resetProvider(page);
  });

  test.afterAll(async () => {
    await closeRecipePersistentDatabase();
  });

  test('creates, edits, versions, restores, archives, searches, and unarchives a recipe', async ({
    page,
  }) => {
    const suffix = randomUUID().slice(0, 8);
    const originalTitle = `E2E Persistent ${suffix}`;
    const editedTitle = `E2E Persistent Edited ${suffix}`;
    const recipeId = await createRecipe(page, originalTitle, 'Primera instrucción');
    recipeIds.push(recipeId);

    await page.getByLabel('Buscar recetas').fill(originalTitle);
    await expect(page.getByRole('link', { name: originalTitle, exact: true })).toBeVisible();
    await page.getByRole('link', { name: originalTitle, exact: true }).click();
    await expect(page.getByRole('heading', { name: originalTitle, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Editar' }).click();
    await page.getByLabel('Título', { exact: true }).fill(editedTitle);
    await page.getByLabel('Pasos y notas').fill('Instrucción editada');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('heading', { name: editedTitle, exact: true })).toBeVisible();
    await expect(page.getByText(`Versión 1 · ${originalTitle}`, { exact: true })).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Restaurar como nueva versión' }).click();
    await expect(page.getByRole('heading', { name: originalTitle, exact: true })).toBeVisible();
    await expect(page.getByText(`Versión 3 · ${originalTitle}`, { exact: true })).toBeVisible();

    const archiveResponse = page.waitForResponse(
      (response) => response.url().includes(`/api/recipes/${recipeId}/archive`) && response.ok()
    );
    await page.getByRole('button', { name: 'Archivar' }).click();
    await archiveResponse;
    await expect(page.getByRole('button', { name: 'Desarchivar' })).toBeVisible();
    await page.goto('/recipes');
    const activeResponse = page.waitForResponse(
      (response) => response.url().includes('/api/recipes?archived=active') && response.ok()
    );
    await page.getByLabel('Estado de recetas').selectOption('active');
    await activeResponse;
    await expect(page.getByRole('link', { name: originalTitle, exact: true })).toHaveCount(0);
    const archivedResponse = page.waitForResponse(
      (response) => response.url().includes('/api/recipes?archived=archived') && response.ok()
    );
    await page.getByLabel('Estado de recetas').selectOption('archived');
    await archivedResponse;
    await expect(page.getByRole('link', { name: originalTitle, exact: true })).toBeVisible();
    await page.getByRole('link', { name: originalTitle, exact: true }).click();
    const unarchiveResponse = page.waitForResponse(
      (response) => response.url().includes(`/api/recipes/${recipeId}/archive`) && response.ok()
    );
    await page.getByRole('button', { name: 'Desarchivar' }).click();
    await unarchiveResponse;
    await expect(page.getByRole('button', { name: 'Archivar' })).toBeVisible();
    await page.goto('/recipes');
    const activeAfterUnarchiveResponse = page.waitForResponse(
      (response) => response.url().includes('/api/recipes?archived=active') && response.ok()
    );
    await page.getByLabel('Estado de recetas').selectOption('active');
    await activeAfterUnarchiveResponse;
    await expect(page.getByRole('link', { name: originalTitle, exact: true })).toBeVisible();

    const detail = await page.request.get(`/api/recipes/${recipeId}`);
    expect(detail.ok()).toBeTruthy();
  });

  test('imports structured AI output and retains its source history', async ({ page }) => {
    await generateRecipe(page);
    const history = await latestRecipeHistory(primaryIdentity!);
    expect(history).not.toBeNull();
    const historyId = history!.id;
    historyIds.push(historyId);
    expect(history!.recipe_title).toBe(GENERATED_TITLE);
    expect(history!.recipe_payload.structuredIngredients ?? []).not.toHaveLength(0);

    await page.getByRole('button', { name: 'Importar al recetario' }).click();
    await expect(page.getByRole('status')).toContainText('Receta importada.');
    const imported = await recipeImportLink(primaryIdentity!, historyId, GENERATED_TITLE);
    expect(imported).not.toBeNull();
    expect(imported?.history_id).toBe(historyId);
    if (imported) recipeIds.push(imported.recipe_id);

    await page.getByRole('link', { name: 'Ver en el recetario' }).click();
    await expect(page.getByRole('heading', { name: GENERATED_TITLE, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ingredientes' })).toBeVisible();
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: /pollo|tomate|arroz/i })
        .first()
    ).toBeVisible();
    expect(await latestRecipeHistory(primaryIdentity!)).not.toBeNull();
  });

  test('warns when importing a duplicate title and keeps both recipes', async ({ page }) => {
    const beforeResponse = await page.request.get('/api/recipes?archived=all&limit=100&offset=0');
    expect(beforeResponse.ok()).toBeTruthy();
    const beforePayload = (await beforeResponse.json()) as { items: Array<{ id: string }> };
    const beforeIds = beforePayload.items.map((item) => item.id);
    const originalRecipeId = await createRecipe(
      page,
      GENERATED_TITLE,
      'Original persistent instructions',
      beforeIds
    );
    recipeIds.push(originalRecipeId);
    await generateRecipe(page);
    const history = await latestRecipeHistory(primaryIdentity!);
    expect(history).not.toBeNull();
    historyIds.push(history!.id);

    await page.getByRole('button', { name: 'Importar al recetario' }).click();
    const importedLink = page.getByRole('link', { name: 'Ver en el recetario' });
    await expect(importedLink).toBeVisible();
    const importedHref = await importedLink.getAttribute('href');
    const importedRecipeId = importedHref?.split('/').pop();
    if (!importedRecipeId) throw new Error('Imported recipe link did not include a recipe id.');
    recipeIds.push(importedRecipeId);
    await expect(page.getByText('Hay recetas con títulos similares', { exact: false })).toBeVisible();
    await page.goto('/recipes');
    await expect(page.getByRole('link', { name: GENERATED_TITLE, exact: true })).toHaveCount(2);
    const response = await page.request.get('/api/recipes?archived=active&limit=100&offset=0');
    const payload = (await response.json()) as {
      items: Array<{ id: string; current_version: { title: string } }>;
    };
    expect(
      payload.items.filter((item) => item.current_version.title === GENERATED_TITLE)
    ).toHaveLength(2);
  });

  test('denies a separately signed-up tenant access to the primary user recipe', async ({
    page,
    browser,
  }) => {
    const suffix = randomUUID();
    const title = `E2E Tenant Private ${suffix.slice(0, 8)}`;
    const recipeId = await createRecipe(page, title, 'Private instructions');
    recipeIds.push(recipeId);
    const context: BrowserContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
    });
    let temporaryIdentity: RecipePersistentIdentity | null = null;

    try {
      const secondPage = await context.newPage();
      const email = `e2e-${suffix}@cocinacore.local`;
      await signupTemporaryUser(secondPage, email);
      temporaryIdentity = await resolveIdentity(secondPage);
      expect(temporaryIdentity.userId).not.toBe(primaryIdentity!.userId);
      expect(temporaryIdentity.tenantId).not.toBe(primaryIdentity!.tenantId);

      const listResponse = await secondPage.request.get(
        '/api/recipes?archived=all&limit=100&offset=0'
      );
      expect(listResponse.ok()).toBeTruthy();
      const list = (await listResponse.json()) as { items: Array<{ id: string }> };
      expect(list.items).toEqual([]);
      expect((await secondPage.request.get(`/api/recipes/${recipeId}`)).status()).toBe(404);
      expect(
        (
          await secondPage.request.patch(`/api/recipes/${recipeId}`, {
            data: {
              title: `Hijacked ${suffix}`,
              instructions: 'Forbidden',
              servings: 2,
              ingredients: [],
            },
          })
        ).status()
      ).toBe(404);
      expect(
        (
          await secondPage.request.post(`/api/recipes/${recipeId}/restore`, {
            data: { versionId: recipeId },
          })
        ).status()
      ).toBe(404);
      expect(
        (
          await secondPage.request.patch(`/api/recipes/${recipeId}/archive`, {
            data: { archived: true },
          })
        ).status()
      ).toBe(404);
      await secondPage.goto('/recipes');
      await secondPage.getByLabel('Buscar recetas').fill(title);
      await expect(secondPage.getByRole('link', { name: title, exact: true })).toHaveCount(0);
    } finally {
      if (temporaryIdentity) {
        await cleanupTemporaryRecipeUser(temporaryIdentity, primaryIdentity!);
      }
      await context.close();
    }
  });
});

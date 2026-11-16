import { expect, test } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';
import { clearRecipeCache } from '../fixtures/database';
import {
  cleanupConnectedRecipeRun,
  closeRecipePersistentDatabase,
  resolveRecipePersistentIdentity,
} from '../fixtures/recipe-persistent';

test.afterAll(async () => {
  await closeRecipePersistentDatabase();
});

test('preserves linked history and deletes only unlinked test history', async ({ page }) => {
  await injectAuth(page);
  await clearRecipeCache();
  const identity = await resolveRecipePersistentIdentity(await page.request.get('/api/profile'));
  const recipeIds: string[] = [];
  const historyIds: string[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const generated = await page.request.post('/api/recipe-generate', {
        data: { mode: 'free', ingredients: ['pollo'] },
      });
      expect(generated.ok()).toBeTruthy();
      const payload = (await generated.json()) as { recipeHistoryId: string };
      expect(payload.recipeHistoryId).toBeTruthy();
      historyIds.push(payload.recipeHistoryId);
    }
    expect(historyIds[0]).not.toBe(historyIds[1]);
    const created = await page.request.post('/api/recipes', {
      data: {
        title: 'E2E linked history provenance',
        instructions: 'Cocinar.',
        ingredients: [{ name: 'arroz', quantity: '1/3', unit: 'taza' }],
        sourceRecipeHistoryId: historyIds[0],
      },
    });
    expect(created.status()).toBe(201);
    const saved = (await created.json()) as { recipe: { id: string } };
    recipeIds.push(saved.recipe.id);
    const linked = await page.request.delete(`/api/recipe-history?id=${historyIds[0]}`);
    expect(linked.status()).toBe(409);
    expect(await linked.json()).toMatchObject({ code: 'RECIPE_HISTORY_LINKED' });
    const unlinked = await page.request.delete(`/api/recipe-history?id=${historyIds[1]}`);
    expect(unlinked.status()).toBe(200);
    const history = await page.request.get('/api/recipe-history');
    expect(history.ok()).toBeTruthy();
    const rows = (await history.json()) as { items: { id: string }[] };
    expect(rows.items.map(({ id }) => id)).toContain(historyIds[0]);
    expect(rows.items.map(({ id }) => id)).not.toContain(historyIds[1]);
    const recipe = await page.request.get(`/api/recipes/${saved.recipe.id}`);
    expect(recipe.ok()).toBeTruthy();
    expect(await recipe.json()).toMatchObject({
      recipe: { current_version: {
        source_recipe_history_id: historyIds[0],
        ingredients: [{ name: 'arroz', quantity: '1/3', unit: 'taza' }],
      } },
    });
  } finally {
    await cleanupConnectedRecipeRun(identity, recipeIds, historyIds);
    await clearRecipeCache();
  }
});

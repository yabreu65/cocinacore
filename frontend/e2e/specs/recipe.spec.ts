import { test, expect } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';
import { stubRecipeGenerate } from '../fixtures/stubs';
import { RecipePage } from '../pages/recipe';

test.describe('Recipe Generation', () => {
  test('user can generate a recipe with stubbed AI', async ({ page }) => {
    await injectAuth(page);
    await stubRecipeGenerate(page);

    const recipePage = new RecipePage(page);
    await recipePage.goto();

    // Wait for page to load
    await expect(recipePage.title).toBeVisible();

    // Add ingredient
    await recipePage.addIngredient('pollo, limón');

    // Generate recipe
    await recipePage.generateRecipe();

    // Should see stubbed recipe title
    await expect(page.locator('body')).toContainText('Pollo al horno', { timeout: 10000 });
  });

  test('recipe page loads for authenticated user', async ({ page }) => {
    await injectAuth(page);

    const recipePage = new RecipePage(page);
    await recipePage.goto();

    await expect(recipePage.title).toBeVisible();
    await expect(recipePage.generateButton).toBeVisible();
  });
});

import { test, expect } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';

const activeRecipe = {
  id: 'demo-recipe',
  category: 'Cena',
  tags: ['casera', 'rápida'],
  archived_at: null,
  created_at: '2026-11-19T09:00:00Z',
  updated_at: '2026-11-21T09:00:00Z',
  current_version: {
    id: 'demo-v2',
    version_number: 2,
    title: 'Tortilla de papas casera',
    instructions: '1. Cortar las papas.\n\n2. Batir los huevos y cocinar.',
    servings: 4,
    source_recipe_history_id: 'demo-history',
    ingredients: [
      { name: 'Papas', quantity: '500', unit: 'g' },
      { name: 'Huevos', quantity: '4', unit: 'unidades' },
    ],
  },
};
const previous = {
  ...activeRecipe.current_version,
  id: 'demo-v1',
  version_number: 1,
  source_recipe_history_id: null,
};

test.describe('Detalle de receta: mobile first', () => {
  test('prioritizes cooking, ingredient quantities and original history on a narrow phone', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectAuth(page);
    let restoreCalls = 0;
    await page.route('**/api/recipes/demo-recipe**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/versions')) {
        await route.fulfill({
          status: 200,
          json: { versions: [activeRecipe.current_version, previous] },
        });
      } else if (path.endsWith('/restore')) {
        restoreCalls += 1;
        await route.fulfill({ status: 409, json: { error: 'Demo read only' } });
      } else {
        await route.fulfill({ status: 200, json: { recipe: activeRecipe } });
      }
    });
    await page.route('**/api/inventory', (route) =>
      route.fulfill({ status: 200, json: { items: [] } })
    );
    await page.route('**/api/inventory/currency', (route) =>
      route.fulfill({ status: 200, json: { currency: null } })
    );

    await page.goto('/recipes/demo-recipe');
    await expect(
      page.getByRole('heading', { name: activeRecipe.current_version.title })
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navegación rápida' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cocinar ahora' })).toHaveAttribute(
      'href',
      '/app/cooking-intent?source=recipe&recipeId=demo-recipe'
    );
    await expect(page.getByRole('heading', { name: 'Ingredientes' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pasos y notas' })).toBeVisible();

    const ingredients = page.getByRole('list', { name: 'Ingredientes de la receta' });
    await expect(ingredients).toContainText('Papas');
    await expect(ingredients).toContainText('500 g');
    await page.getByLabel('Porciones deseadas').fill('8');
    await expect(ingredients).toContainText('1000 g');
    await expect(ingredients).toContainText('8 unidades');
    await expect(page.getByRole('status').filter({ hasText: 'Costo estimado' })).toBeVisible();

    await expect(page.getByRole('link', { name: 'Consultar historial original' })).toBeVisible();
    const restore = page.getByRole('button', { name: 'Restaurar como nueva versión' });
    page.once('dialog', (dialog) => dialog.dismiss());
    await restore.click();
    expect(restoreCalls).toBe(0);

    await page.getByRole('button', { name: 'Editar' }).click();
    await expect(page.getByRole('region', { name: 'Editar receta' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cerrar edición' })).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar edición' }).click();
    await expect(page.getByRole('region', { name: 'Editar receta' })).toHaveCount(0);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('preserves archived state and desktop navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await injectAuth(page);
    await page.route('**/api/recipes/demo-recipe**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const archivedRecipe = { ...activeRecipe, archived_at: '2026-11-20T10:00:00Z' };
      if (path.endsWith('/versions')) {
        await route.fulfill({
          status: 200,
          json: { versions: [activeRecipe.current_version, previous] },
        });
      } else {
        await route.fulfill({ status: 200, json: { recipe: archivedRecipe } });
      }
    });
    await page.route('**/api/inventory', (route) =>
      route.fulfill({ status: 200, json: { items: [] } })
    );
    await page.route('**/api/inventory/currency', (route) =>
      route.fulfill({ status: 200, json: { currency: null } })
    );
    await page.goto('/recipes/demo-recipe');
    await expect(page.getByRole('button', { name: 'Desarchivar' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cocinar ahora' })).toHaveCount(0);
    await expect(page.locator('aside').getByRole('link', { name: 'CocinaCore' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navegación rápida' })).toBeHidden();
  });
});

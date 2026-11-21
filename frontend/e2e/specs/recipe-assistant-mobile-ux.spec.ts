import { test, expect } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';

const generated = {
  title: 'Pollo al horno con verduras',
  recipe: 'Pollo al horno con verduras.\nCocinar el pollo y las verduras.',
  preparation: 'Cocinar el pollo y las verduras.',
  structuredIngredients: [
    { name: 'Pollo', normalized_name: 'pollo', quantity: 500, unit: 'g', structured: true },
  ],
  recipeHistoryId: '00000000-0000-4000-8000-000000000123',
  servings: 4,
  ragContextUsed: false,
  sources: [],
};

test.describe('Asistente de recetas: experiencia móvil', () => {
  test('makes the primary action reachable before the bottom nav and preserves PDF mode and review', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectAuth(page);

    let body: Record<string, unknown> | null = null;
    await page.route('**/api/recipe-generate', async (route) => {
      body = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 200, json: generated });
    });
    await page.goto('/recipes/search');
    await expect(page.getByRole('heading', { name: 'Buscar recetas' })).toBeVisible();

    const button = page.getByRole('button', { name: 'Generar receta' });
    const nav = page.getByRole('navigation', { name: 'Navegación rápida' });
    await expect(nav).toBeVisible();
    const [buttonBox, navBox] = await Promise.all([button.boundingBox(), nav.boundingBox()]);
    expect(buttonBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(navBox!.y);

    await page.getByLabel('Modo').selectOption('rag');
    await expect(
      page.getByText('Buscaremos información en los libros disponibles de la biblioteca.')
    ).toBeVisible();
    await page.getByLabel(/Quiero cocinar con/).fill('pollo\nzanahoria');
    await page.getByLabel('Restricciones (separadas por comas)').fill('sin leche');
    await page.getByText('Ponerle nombre a mi receta').click();
    await page.getByLabel('Nombre de receta (opcional)').fill('Pollo con verduras');

    await button.click();
    await expect(page.getByRole('heading', { name: generated.title })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Importar al recetario' })).toBeVisible();
    expect(body).toMatchObject({
      mode: 'rag',
      ingredients: ['pollo', 'zanahoria'],
      recipeName: 'Pollo con verduras',
      culinaryProfile: { avoid: ['sin leche'] },
    });
    await expect(
      page.getByText('No se encontró contexto documental relevante para esta receta.')
    ).toBeVisible();

    await page.getByRole('button', { name: 'Importar al recetario' }).click();
    await expect(page.getByRole('button', { name: 'Confirmar y guardar' })).toBeVisible();
    await expect(button).toBeDisabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    ).toBeLessThanOrEqual(1);
  });

  test('keeps the planned recipe name visible when arriving from the meal planner', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectAuth(page);
    await page.goto('/recipes/search?slot=lunch&title=Pollo%20al%20horno&ingredient=pollo');
    await expect(page.getByText('Receta que elegiste: Pollo al horno')).toBeVisible();
    await expect(page.getByLabel('Nombre de receta (opcional)')).toHaveValue('Pollo al horno');
    await expect(page.getByLabel(/Quiero cocinar con/)).toHaveValue('pollo');
  });

  test('keeps desktop navigation and accessible generation inputs', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await injectAuth(page);
    await page.goto('/recipes/search');
    await expect(page.getByRole('heading', { name: 'Buscar recetas' })).toBeVisible();
    await expect(page.getByLabel('Modo')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navegación rápida' })).toBeHidden();
    await expect(page.locator('aside').getByRole('link', { name: 'CocinaCore' })).toBeVisible();
  });
});

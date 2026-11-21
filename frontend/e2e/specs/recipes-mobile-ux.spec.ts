import { test, expect } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';

const recipe = (id: string, title: string, category: string, archived = false) => ({
  id,
  category,
  tags: ['casera'],
  archived_at: archived ? '2026-11-20T00:00:00.000Z' : null,
  created_at: '2026-11-19T00:00:00.000Z',
  updated_at: '2026-11-20T00:00:00.000Z',
  current_version: {
    id: id + '-v1',
    version_number: 1,
    title,
    instructions: 'Preparar los ingredientes.',
    servings: 2,
    ingredients: [{ name: 'Tomate', quantity: '2', unit: 'unidades' }],
  },
});

test.describe('UX mobile — Mis recetas', () => {
  test('makes search and primary actions accessible and groups advanced controls', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectAuth(page);
    await page.route('**/api/recipes?*', async (route) => {
      const archive = new URL(route.request().url()).searchParams.get('archived');
      const items =
        archive === 'archived'
          ? [recipe('arch-1', 'Tarta de limón', 'Postre', true)]
          : [
              recipe('r-1', 'Tortilla de papas', 'Almuerzo'),
              recipe('r-2', 'Ensalada fresca', 'Cena'),
            ];
      await route.fulfill({ status: 200, json: { items } });
    });

    await page.goto('/recipes');
    await expect(page.getByRole('heading', { name: 'Mi recetario' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navegación rápida' })).toBeVisible();
    await expect(page.getByText('2 recetas encontradas')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tortilla de papas', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preparar esta receta' }).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.getByLabel('Buscar recetas').fill('Ensalada');
    await expect(page.getByRole('link', { name: 'Tortilla de papas', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Ensalada fresca', exact: true })).toBeVisible();

    await page.getByText('Más filtros', { exact: true }).click();
    await page.getByRole('combobox', { name: 'Categoría' }).selectOption('Cena');
    await expect(page.getByText('Aplicados', { exact: true })).toBeVisible();

    await page.getByLabel('Buscar recetas').fill('');
    const card = page.getByRole('listitem').filter({
      has: page.getByRole('link', { name: 'Ensalada fresca', exact: true }),
    });
    await card.getByText('Más opciones', { exact: true }).click();
    await expect(card.getByRole('link', { name: 'Revisar preparación' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Añadir a una comida del menú' })).toBeVisible();

    await page.getByLabel('Estado de recetas').selectOption('archived');
    await expect(page.getByRole('link', { name: 'Tarta de limón', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preparar esta receta' })).toHaveCount(0);
  });

  test('preserves the desktop sidebar and accessible filters', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await injectAuth(page);
    await page.route('**/api/recipes?*', (route) =>
      route.fulfill({ status: 200, json: { items: [] } })
    );
    await page.goto('/recipes');
    await expect(page.locator('aside').getByRole('link', { name: 'CocinaCore' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navegación rápida' })).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Mi recetario' })).toBeVisible();
    await expect(page.getByText('Tu recetario empieza aquí')).toBeVisible();
  });
});

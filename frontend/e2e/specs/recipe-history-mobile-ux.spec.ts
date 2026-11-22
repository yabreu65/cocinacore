import { test, expect } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';

const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
const recipeHistoryRow = (id: string, title: string, saved = false) => ({
  id,
  recipe_title: title,
  recipe_payload: {
    title,
    summary: 'Una idea generada para la cena.',
    full_recipe: 'Preparación: cocinar los ingredientes y servir.',
    peopleCount: 4,
    structuredIngredients: [{ name: 'Arroz', quantity: 400, unit: 'g' }],
  },
  user_feedback: null as 'accepted' | 'discarded' | null,
  created_at: '2026-11-20T15:00:00.000Z',
  is_saved: saved,
});

test.describe('Historial de recetas — experiencia mobile-first', () => {
  test('keeps bookmarking, filtering, details, import review and destructive actions accessible', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectAuth(page);

    const items = [
      recipeHistoryRow(first, 'Pasta con champiñones'),
      recipeHistoryRow(second, 'Arroz con verduras', true),
    ];
    let deleteCalls = 0;
    let importCalls = 0;
    await page.route('**/api/recipe-history**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (method === 'GET') {
        const saved = url.searchParams.get('saved') === 'true';
        await route.fulfill({
          status: 200,
          json: { items: items.filter((row) => !saved || row.is_saved) },
        });
        return;
      }
      const row = items.find((entry) => entry.id === url.searchParams.get('id'));
      if (method === 'PATCH' && row) {
        if (url.searchParams.has('saved')) row.is_saved = url.searchParams.get('saved') === 'true';
        if (url.searchParams.has('feedback')) {
          row.user_feedback = url.searchParams.get('feedback') as 'accepted' | 'discarded';
        }
        await route.fulfill({ status: 200, json: { item: row } });
        return;
      }
      if (method === 'DELETE') {
        deleteCalls += 1;
        await route.fulfill({ status: 200, json: { ok: true } });
        return;
      }
      await route.fulfill({ status: 400, json: { error: 'Unexpected demo request' } });
    });
    await page.route('**/api/recipes', (route) => {
      importCalls += 1;
      return route.fulfill({ status: 201, json: { recipe: { id: 'demo-saved-recipe' } } });
    });

    await page.goto('/recipes/history');
    await expect(page.getByRole('heading', { name: 'Historial de recetas' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navegación rápida' })).toBeVisible();
    await expect(page.getByText('2 ideas encontradas')).toBeVisible();

    const firstCard = page
      .getByRole('listitem')
      .filter({ hasText: 'Pasta con champiñones' })
      .first();
    await firstCard.getByRole('button', { name: 'Ver detalle' }).click();
    await expect(firstCard).toContainText('Preparación: cocinar los ingredientes y servir.');
    await firstCard.getByRole('button', { name: 'Ocultar' }).click();

    await firstCard.getByRole('button', { name: 'Importar a Mi recetario' }).click();
    await expect(
      firstCard.getByRole('region', { name: 'Revisar antes de importar' })
    ).toBeVisible();
    await expect(firstCard.getByRole('button', { name: 'Confirmar y guardar' })).toBeVisible();
    expect(importCalls).toBe(0);
    await firstCard.getByRole('button', { name: 'Cancelar' }).click();
    await expect(firstCard.getByRole('region', { name: 'Revisar antes de importar' })).toHaveCount(
      0
    );

    await firstCard.getByRole('button', { name: 'Marcar para consultar' }).click();
    await expect(firstCard.getByRole('button', { name: 'Quitar marca' })).toBeVisible();
    await page.getByLabel('Mostrar recetas').selectOption('saved');
    await expect(page.getByText('2 ideas encontradas')).toBeVisible();
    await expect(page).toHaveURL(/saved=true/);

    await page.getByLabel('Mostrar recetas').selectOption('all');
    await firstCard.getByText('Más opciones', { exact: true }).click();
    await firstCard.getByRole('button', { name: 'Me gustó', exact: true }).click();
    await expect(firstCard.getByRole('button', { name: 'Me gustó', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    page.once('dialog', (dialog) => dialog.dismiss());
    await firstCard.getByRole('button', { name: 'Eliminar' }).click();
    expect(deleteCalls).toBe(0);
    await expect(firstCard).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    ).toBeLessThanOrEqual(1);
  });

  test('renders an understandable saved-empty state and preserves desktop navigation', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await injectAuth(page);
    await page.route('**/api/recipe-history**', (route) =>
      route.fulfill({ status: 200, json: { items: [] } })
    );

    await page.goto('/recipes/history?saved=true');
    await expect(page.getByRole('heading', { name: 'Historial de recetas' })).toBeVisible();
    await expect(page.getByText('Aún no hay ideas marcadas para consultar.')).toBeVisible();
    await expect(page.getByLabel('Mostrar recetas')).toHaveValue('saved');
    await expect(page.getByRole('navigation', { name: 'Navegación rápida' })).toBeHidden();
    await expect(page.locator('aside').getByRole('link', { name: 'CocinaCore' })).toBeVisible();
  });
});

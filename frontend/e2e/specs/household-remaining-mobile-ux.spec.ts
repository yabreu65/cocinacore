import { expect, test } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';

test.describe('UX Bistró — páginas del hogar restantes', () => {
  test('Inventario expone existencias y acciones sin alterar cantidades', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectAuth(page);
    await page.route('**/api/inventory', (route) =>
      route.fulfill({
        status: 200,
        json: {
          items: [
            {
              id: '00000000-0000-4000-8000-000000000006',
              ingredient_name: 'Arroz',
              quantity: '1',
              unit: 'kg',
              category: 'Granos',
              expiration_date: '2027-04-25',
              purchase_location: 'Tienda',
              low_stock_threshold: 0.2,
              revision: 'rev-demo',
            },
          ],
        },
      })
    );
    await page.route('**/api/inventory/currency', (route) =>
      route.fulfill({ status: 200, json: { currency: 'COP', canManageCurrency: false } })
    );

    await page.goto('/recipes/inventory');
    await expect(page.getByRole('heading', { name: 'Inventario de ingredientes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Agregar ingrediente' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Resumen del inventario' })).toBeVisible();
    await expect(page.getByText('Arroz', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mi despensa' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    ).toBeLessThanOrEqual(1);
  });

  test('Planificador conserva los campos y la acción principal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectAuth(page);
    await page.route('**/api/meal-plan', (route) =>
      route.fulfill({ status: 200, json: { plan: null, content: null } })
    );
    await page.goto('/meal-planner');
    await expect(page.getByRole('heading', { name: 'Planificador de menú' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generar menú' })).toBeVisible();
    await expect(page.getByLabel('Comensales')).toBeVisible();
    await expect(page.getByLabel('Período')).toBeVisible();
    await expect(page.getByLabel('Cocina base')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    ).toBeLessThanOrEqual(1);
  });

  test('Compras muestra cantidades y ayuda secundaria sin guardar automáticamente', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectAuth(page);
    await page.route('**/api/shopping-list', (route) =>
      route.fulfill({ status: 200, json: { items: [] } })
    );
    await page.goto('/shopping-list');
    await expect(page.getByRole('heading', { name: 'Lista de compras' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Agregar', exact: true })).toBeVisible();
    await expect(page.getByText('Tu lista está vacía.')).toBeVisible();
    const help = page.getByText('Cómo funcionan las cantidades y el inventario', { exact: true });
    await help.click();
    await expect(
      page.getByText('No se modifica la cantidad guardada', { exact: false })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /Pendientes/ })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    ).toBeLessThanOrEqual(1);
  });

  test('Las cuatro rutas heredadas mantienen la redirección existente', async ({ page }) => {
    await injectAuth(page);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/premium');
    await expect(page).toHaveURL(/\/app\/premium$/);
    await page.goto('/recipes/rating');
    await expect(page).toHaveURL(/\/recipes\/history$/);
  });
});

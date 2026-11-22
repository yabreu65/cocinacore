import { test, expect } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';

test.describe('UX mobile: Inicio y navegación del hogar', () => {
  test('prioritizes mobile home tasks and opens the full menu without horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectAuth(page);
    await page.goto('/app');

    const quick = page.getByRole('navigation', { name: 'Navegación rápida' });
    await expect(quick).toBeVisible();
    await expect(quick.getByRole('link', { name: 'Inicio' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    for (const label of ['Recetas', 'Planificar', 'Compras']) {
      await expect(quick.getByRole('link', { name: label })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Encontrar una receta' })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    const more = quick.getByRole('button', { name: 'Abrir menú de navegación' });
    await more.click();
    const dialog = page.getByRole('dialog', { name: 'Menú de navegación' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Perfil' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cerrar menú de navegación' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(more).toBeFocused();
  });

  test('preserves the desktop sidebar and hides the mobile quick navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await injectAuth(page);
    await page.goto('/app');
    await expect(page.getByRole('navigation', { name: 'Navegación rápida' })).toBeHidden();
    await expect(page.locator('aside').getByRole('link', { name: 'CocinaCore' })).toBeVisible();
  });
});

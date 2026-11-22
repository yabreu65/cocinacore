import { expect, test } from '@playwright/test';

test.describe('Área 3: cuatro pantallas del sitio público', () => {
  test('portada abre sesión, registro y documentos legales en móvil sin escrituras', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Tu cocina, más organizada/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute(
      'href',
      '/login'
    );
    await expect(page.getByRole('link', { name: 'Crear cuenta' })).toHaveAttribute(
      'href',
      '/signup'
    );
    await expect(page.getByRole('link', { name: 'Empezar gratis' })).toHaveAttribute(
      'href',
      '/signup'
    );
    const footer = page.getByRole('navigation', { name: 'Información legal' });
    await expect(footer.getByRole('link', { name: 'Privacidad' })).toHaveAttribute(
      'href',
      '/privacy'
    );
    await expect(footer.getByRole('link', { name: 'Términos' })).toHaveAttribute('href', '/terms');
    await expect(footer.getByRole('link', { name: 'Cookies' })).toHaveAttribute('href', '/cookies');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    ).toBeLessThanOrEqual(1);
  });

  test('documentos legales están en español y permiten navegar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const item of [
      { route: '/privacy', title: 'Política de privacidad', heading: 'Información que recopilamos' },
      { route: '/terms', title: 'Términos del servicio', heading: 'Aceptación de los términos' },
      { route: '/cookies', title: 'Política de cookies', heading: 'Qué son las cookies' },
    ]) {
      await page.goto(item.route);
      await expect(page.getByRole('heading', { name: item.title })).toBeVisible();
      await expect(page.getByRole('heading', { name: new RegExp(item.heading) })).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: 'Documentos legales' }).getByRole('link')
      ).toHaveCount(3);
      await expect(page.getByRole('link', { name: 'Volver a CocinaCore' })).toHaveAttribute(
        'href',
        '/'
      );
      await expect(
        page.getByText('Versión en español del documento existente.', { exact: false })
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      ).toBeLessThanOrEqual(1);
    }
  });

  test('sitio también funciona a 320 px sin desbordamiento horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    for (const route of ['/', '/privacy', '/terms', '/cookies']) {
      await page.goto(route);
      await expect(page.locator('main h1')).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      ).toBeLessThanOrEqual(1);
    }
  });

  test('escritorio muestra navegación y todas las páginas legales', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('navigation').first()).toBeVisible();
    for (const route of ['/privacy', '/terms', '/cookies']) {
      await page.goto(route);
      await expect(page.getByRole('navigation', { name: 'Documentos legales' })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      ).toBeLessThanOrEqual(1);
    }
  });
});

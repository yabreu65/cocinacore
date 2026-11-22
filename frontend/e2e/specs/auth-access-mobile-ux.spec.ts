import { test, expect } from '@playwright/test';

const assertNoHorizontalOverflow = async (page: import('@playwright/test').Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
};

test.describe('Área 2: Acceso y seguridad — mobile-first', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // The suite is visual and read-only: prevent any account mutation.
    await page.route('**/api/auth/**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fulfill({ status: 503, json: { error: 'No real account writes in UX spec' } });
        return;
      }
      await route.continue();
    });
  });

  test('login keeps email/password, recovery, password visibility and signup accessible', async ({
    page,
  }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Iniciar sesión', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Correo electrónico' })).toBeVisible();
    const password = page.locator('input[name="password"]');
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Mostrar', exact: true }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Ocultar', exact: true }).click();
    await expect(password).toHaveAttribute('type', 'password');
    await expect(page.getByRole('link', { name: '¿Olvidaste tu contraseña?' })).toHaveAttribute(
      'href',
      '/forgot-password'
    );
    await expect(page.getByRole('link', { name: 'Crear una cuenta' })).toHaveAttribute(
      'href',
      '/signup'
    );
    await expect(page.getByText('Google y GitHub (en preparación)')).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test('signup keeps its four fields, terms acceptance and nonfunctional OAuth disclosure', async ({
    page,
  }) => {
    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: 'Crear cuenta', exact: true })).toBeVisible();
    await expect(page.locator('input[name="fullName"]')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toHaveAttribute('type', 'password');
    await expect(page.locator('input[name="confirmPassword"]')).toHaveAttribute('type', 'password');
    await expect(
      page.getByRole('checkbox', { name: 'Acepto términos y privacidad' })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crear cuenta gratis' })).toBeVisible();
    await expect(page.getByText('Google y GitHub (en preparación)')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute(
      'href',
      '/login'
    );
    await assertNoHorizontalOverflow(page);
  });

  test('forgot password validates locally; reset without token is safely disabled', async ({
    page,
  }) => {
    await page.goto('/forgot-password');
    await expect(page.getByRole('heading', { name: 'Recuperar contraseña' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Solicitar recuperación' })).toBeVisible();
    await page.locator('input[name="email"]').fill('correo-invalido');
    await page.getByRole('button', { name: 'Solicitar recuperación' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Ingresá un correo válido.' })
    ).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.goto('/reset-password');
    await expect(page.getByRole('heading', { name: 'Nueva contraseña' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Guardar contraseña' })).toBeDisabled();
    await assertNoHorizontalOverflow(page);

    await page.goto('/reset-password?token=ejemplo-visual-no-valido');
    await expect(page.locator('input[name="password"]')).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Guardar contraseña' })).toBeEnabled();
    await assertNoHorizontalOverflow(page);
  });

  test('MFA and legacy invitation remain informative, never activate or reveal bearer tokens', async ({
    page,
  }) => {
    await page.goto('/mfa');
    await expect(page.getByRole('heading', { name: 'Verificación en dos pasos' })).toBeVisible();
    await expect(page.getByText('Verificación temporalmente no disponible')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Volver al login' })).toHaveAttribute(
      'href',
      '/login'
    );
    await expect(page.locator('input')).toHaveCount(0);
    await assertNoHorizontalOverflow(page);

    const secret = 'ejemplo-visual-token-no-autorizado';
    await page.goto('/invite/' + secret);
    await expect(page.getByRole('heading', { name: 'Invitación a CocinaCore' })).toBeVisible();
    await expect(page.getByText('Invitaciones no disponibles')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(secret);
    await expect(page.getByRole('link', { name: 'Ir a iniciar sesión' })).toHaveAttribute(
      'href',
      '/login'
    );
    await assertNoHorizontalOverflow(page);
  });

  test('desktop login and signup show the same genuine product benefits', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const route of ['/login', '/signup']) {
      await page.goto(route);
      await expect(page.getByText('Recetas en un solo lugar')).toBeVisible();
      await expect(page.getByText('Tu menú más claro')).toBeVisible();
      await expect(page.getByText('Compras e ingredientes')).toBeVisible();
      await assertNoHorizontalOverflow(page);
    }
  });
});

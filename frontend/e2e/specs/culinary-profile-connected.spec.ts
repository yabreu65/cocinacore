import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('persists culinary profile details for the authenticated synthetic user', async ({ page }) => {
  test.skip(
    process.env.COCINACORE_ISOLATED_E2E !== '1',
    'Requires the isolated E2E runner to prevent creating data in the default environment.'
  );

  const uniqueId = randomUUID();
  const email = `m2-profile-e2e-${uniqueId}@cocinacore.local`;
  const password = `M2ProfileE2E!${randomUUID()}`;
  const signupResponse = await page.request.post('/api/auth/signup', {
    data: {
      email,
      password,
      confirmPassword: password,
      fullName: 'M2 Culinary Profile E2E',
      termsAccepted: true,
    },
  });
  expect(signupResponse.ok()).toBeTruthy();
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Perfil', exact: true })).toBeVisible();

  const availableTime = page.getByLabel('Tiempo disponible (minutos)');
  const dislikedIngredients = page.getByLabel('Ingredientes que no te gustan');
  const allergies = page.getByLabel('Alergias');

  await availableTime.fill('45');
  await dislikedIngredients.fill('aceitunas\ncilantro');
  await allergies.fill('cacahuate\nmariscos');

  await page.getByRole('button', { name: 'Añadir persona' }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('E2E Household Member');
  await page.getByLabel('Grupo de edad').selectOption('child');

  await page.getByRole('button', { name: 'Guardar perfil culinario' }).click();
  await expect(
    page.getByText('Perfil culinario guardado. CocinaCore ya usará estas preferencias.')
  ).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Perfil', exact: true })).toBeVisible();
  await expect(page.getByLabel('Tiempo disponible (minutos)')).toHaveValue('45');
  await expect(page.getByLabel('Ingredientes que no te gustan')).toHaveValue('aceitunas\ncilantro');
  await expect(page.getByLabel('Alergias')).toHaveValue('cacahuate\nmariscos');

  await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('E2E Household Member');
  await expect(page.getByLabel('Grupo de edad')).toHaveValue('child');
});

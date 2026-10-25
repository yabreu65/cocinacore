import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

interface ProviderRequestCapture {
  pathname: string;
  body: {
    contents?: Array<{
      parts?: Array<{ text?: string }>;
    }>;
  };
}

interface ProviderCapture {
  generationCallCount: number;
  requests: ProviderRequestCapture[];
}

async function providerCaptureUrl(path: string): Promise<string> {
  const port = process.env.E2E_PROVIDER_PORT;
  if (!port || !/^\d+$/.test(port)) throw new Error('E2E provider port is unavailable.');
  return `http://127.0.0.1:${port}${path}`;
}

test('connects saved culinary context to safe Today recommendations and recipe handoff', async ({ page }) => {
  test.skip(
    process.env.COCINACORE_ISOLATED_E2E !== '1',
    'Requires the isolated E2E runner to prevent creating data in the default environment.'
  );

  const uniqueId = randomUUID();
  const email = `m2-today-e2e-${uniqueId}@cocinacore.local`;
  const password = `M2TodayE2E!${randomUUID()}`;
  const fullName = `M2Today Synthetic ${uniqueId}`;
  const profileFullName = `M2Today Profile ${uniqueId}`;
  const memberName = `M2Household Synthetic ${uniqueId}`;
  const adultMemberName = `M2Adult Synthetic ${uniqueId}`;
  const signupResponse = await page.request.post('/api/auth/signup', {
    data: { email, password, confirmPassword: password, fullName, termsAccepted: true },
  });
  expect(signupResponse.ok()).toBe(true);

  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Perfil', exact: true })).toBeVisible();
  await page.getByLabel('Nombre completo').fill(profileFullName);
  await page.getByLabel('Tiempo disponible (minutos)').fill('240');
  await page.getByLabel('Alergias').fill('peanut');
  await page.getByRole('button', { name: 'Añadir persona' }).click();
  await page.getByLabel('Nombre', { exact: true }).fill(memberName);
  await page.getByLabel('Grupo de edad').selectOption('child');
  await page.getByRole('button', { name: 'Añadir persona' }).click();
  const householdNames = page.getByLabel('Nombre', { exact: true });
  await householdNames.nth(1).fill(adultMemberName);
  await page.getByLabel('Grupo de edad').nth(1).selectOption('adult');
  await page.getByRole('button', { name: 'Guardar perfil culinario' }).click();
  await expect(page.getByText('Perfil culinario guardado. CocinaCore ya usará estas preferencias.')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Perfil', exact: true })).toBeVisible();
  await expect(page.getByLabel('Nombre completo')).toHaveValue(profileFullName);
  await expect(page.getByLabel('Alergias')).toHaveValue('peanut');
  await expect(page.getByLabel('Tiempo disponible (minutos)')).toHaveValue('240');
  await expect(householdNames.nth(0)).toHaveValue(memberName);
  await expect(householdNames.nth(1)).toHaveValue(adultMemberName);
  await expect(page.getByLabel('Grupo de edad').nth(0)).toHaveValue('child');
  await expect(page.getByLabel('Grupo de edad').nth(1)).toHaveValue('adult');

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: '¿Qué cocino hoy?' })).toBeVisible();
  const resetResponse = await fetch(await providerCaptureUrl('/__e2e/reset'), { method: 'POST' });
  expect(resetResponse.ok).toBe(true);

  await page.getByRole('radio', { name: 'Almuerzo' }).click();
  await page.getByRole('button', { name: 'Ver opciones' }).click();
  await expect(page.getByRole('heading', { name: 'Opciones para Almuerzo' })).toBeVisible();
  const todaySection = page.getByRole('region', { name: '¿Qué cocino hoy?' });
  const safeTitles = ['Tomato rice bowl', 'Bean and corn tacos', 'Spinach pasta'];
  for (const title of safeTitles) {
    await expect(todaySection.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  await expect(todaySection.getByRole('heading', { name: 'Peanut bowl', exact: true })).toHaveCount(0);
  await expect(todaySection.getByRole('article')).toHaveCount(3);

  const captureResponse = await fetch(await providerCaptureUrl('/__e2e/requests'));
  expect(captureResponse.ok).toBe(true);
  const capture = (await captureResponse.json()) as ProviderCapture;
  expect(capture.generationCallCount).toBe(1);
  const todayRequest = capture.requests.find((entry) => entry.pathname.endsWith(':generateContent'));
  expect(Boolean(todayRequest)).toBe(true);
  const prompt = todayRequest?.body.contents?.[0]?.parts?.[0]?.text ?? '';
  const contextMarker = 'Trusted meal context JSON:\n';
  const contextStart = prompt.indexOf(contextMarker);
  const contextEnd = prompt.indexOf('\nOptional trusted cookbook text', contextStart);
  const contextText = contextStart < 0
    ? ''
    : prompt.slice(contextStart + contextMarker.length, contextEnd < 0 ? undefined : contextEnd);
  let context: {
    slot?: string;
    maxPrepMinutes?: number;
    allergies?: string[];
    householdCounts?: { adult: number; teen: number; child: number };
  };
  try {
    context = JSON.parse(contextText) as typeof context;
  } catch {
    throw new Error('Provider meal context was missing or invalid.');
  }
  expect(context.slot === 'lunch').toBe(true);
  expect(context.maxPrepMinutes === 240).toBe(true);
  expect(context.allergies?.some((allergy) => allergy.toLowerCase() === 'peanut')).toBe(true);
  expect(context.householdCounts?.adult === 1).toBe(true);
  expect(context.householdCounts?.teen === 0).toBe(true);
  expect(context.householdCounts?.child === 1).toBe(true);
  expect(prompt.includes(fullName)).toBe(false);
  expect(prompt.includes(profileFullName)).toBe(false);
  expect(prompt.includes(email)).toBe(false);
  expect(prompt.includes(password)).toBe(false);
  expect(prompt.includes(memberName)).toBe(false);
  expect(prompt.includes(adultMemberName)).toBe(false);

  const selectedTitle = safeTitles[0];
  await todaySection.getByLabel(`Porciones originales: ${selectedTitle}`).fill('2');
  await todaySection.getByLabel(`Porciones deseadas: ${selectedTitle}`).fill('2');
  const recipeButton = todaySection.getByRole('button', { name: `Ver receta: ${selectedTitle}` });
  await expect(recipeButton).toBeEnabled();
  await recipeButton.click();
  await expect(page).toHaveURL(/\/recipes\/search\?/);
  const handoffUrl = new URL(page.url());
  expect(handoffUrl.pathname === '/recipes/search').toBe(true);
  expect(handoffUrl.searchParams.get('slot') === 'lunch').toBe(true);
  expect(handoffUrl.searchParams.get('title') === selectedTitle).toBe(true);
  const selectedOptionIngredients: Record<string, string[]> = {
    'Tomato rice bowl': ['rice', 'tomato', 'olive oil'],
    'Bean and corn tacos': ['beans', 'corn', 'tortillas'],
    'Spinach pasta': ['pasta', 'spinach', 'garlic'],
  };
  const expectedIngredients = selectedOptionIngredients[selectedTitle];
  expect(JSON.stringify(handoffUrl.searchParams.getAll('ingredient')) === JSON.stringify(expectedIngredients)).toBe(true);
  expect((await page.getByLabel('Nombre de receta (opcional)').inputValue()) === selectedTitle).toBe(true);
  expect((await page.getByLabel(/Quiero cocinar con/).inputValue()) === expectedIngredients.join('\n')).toBe(true);

  const afterHandoffResponse = await fetch(await providerCaptureUrl('/__e2e/requests'));
  expect(afterHandoffResponse.ok).toBe(true);
  const afterHandoff = (await afterHandoffResponse.json()) as ProviderCapture;
  expect(afterHandoff.generationCallCount).toBe(1);
});

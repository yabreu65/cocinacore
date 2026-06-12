import { Page } from '@playwright/test';

export const STUB_RECIPE_RESPONSE = {
  recipe: '[TITULO]\n\nPollo al horno\n\n[INGREDIENTES]\n- 1 kg pollo\n- 2 unidades limón\n\n[PREPARACIÓN]\n1. Precalentar horno a 180°C.\n2. Hornear por 45 minutos.\n\n[TIPS]\n- Usar temperatura media.',
  title: 'Pollo al horno',
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  mode: 'free',
  structuredIngredients: [
    { quantity: '1', unit: 'kg', name: 'pollo' },
    { quantity: '2', unit: 'unidades', name: 'limón' },
  ],
};

export const STUB_MEAL_PLAN_RESPONSE = {
  content: 'LUNES\nDesayuno: Avena con frutas\nAlmuerzo: Pollo al horno con ensalada\nCena: Sopa de verduras\n\nMARTES\nDesayuno: Tostadas con aguacate\nAlmuerzo: Ensalada César con pollo\nCena: Pescado a la plancha\n\nMIÉRCOLES\nDesayuno: Smoothie de frutas\nAlmuerzo: Pasta con salsa de tomate\nCena: Wrap de vegetales',
};

/**
 * Stub the recipe generation API endpoint
 */
export async function stubRecipeGenerate(page: Page): Promise<void> {
  await page.route('/api/recipe-generate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(STUB_RECIPE_RESPONSE),
    });
  });
}

/**
 * Stub the meal plan generation API endpoint
 */
export async function stubMealPlan(page: Page): Promise<void> {
  await page.route('/api/meal-plan', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(STUB_MEAL_PLAN_RESPONSE),
    });
  });
}

/**
 * Stub the embeddings API endpoint
 */
export async function stubEmbeddings(page: Page): Promise<void> {
  await page.route('/api/embeddings', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        embeddings: [[0.1, 0.2, 0.3]],
      }),
    });
  });
}

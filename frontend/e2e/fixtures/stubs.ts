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

const STUB_MEAL_PLAN_DAYS = [
  'LUNES',
  'MARTES',
  'MIÉRCOLES',
  'JUEVES',
  'VIERNES',
  'SÁBADO',
  'DOMINGO',
];

export const STUB_MEAL_PLAN_RESPONSE = {
  plan: {
    period: 'week',
    dayCount: STUB_MEAL_PLAN_DAYS.length,
    days: STUB_MEAL_PLAN_DAYS.map((label, index) => ({
      dayIndex: index + 1,
      label,
      meals: [
        {
          mealType: 'breakfast',
          title: 'Avena con frutas',
          description: null,
          ingredients: [{ name: 'avena', quantity: null, unit: null }],
        },
        {
          mealType: 'lunch',
          title: 'Pollo al horno',
          description: null,
          ingredients: [{ name: 'pollo', quantity: null, unit: null }],
        },
        {
          mealType: 'dinner',
          title: 'Sopa de verduras',
          description: null,
          ingredients: [{ name: 'verduras', quantity: null, unit: null }],
        },
      ],
    })),
  },
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

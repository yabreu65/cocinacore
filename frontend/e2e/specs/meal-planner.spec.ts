import { test, expect } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';
import { stubMealPlan } from '../fixtures/stubs';
import { MealPlannerPage } from '../pages/meal-planner';

test.describe('Meal Planner', () => {
  test('user can generate a meal plan with stubbed AI', async ({ page }) => {
    await injectAuth(page);
    await stubMealPlan(page);

    const mealPlannerPage = new MealPlannerPage(page);
    await mealPlannerPage.goto();

    // Wait for page to load
    await expect(mealPlannerPage.title).toBeVisible();

    // Generate plan
    await mealPlannerPage.generatePlan();

    // Should see stubbed meal plan content
    await expect(page.locator('body')).toContainText('LUNES', { timeout: 10000 });
  });

  test('meal planner page loads for authenticated user', async ({ page }) => {
    await injectAuth(page);

    const mealPlannerPage = new MealPlannerPage(page);
    await mealPlannerPage.goto();

    await expect(mealPlannerPage.title).toBeVisible();
    await expect(mealPlannerPage.generateButton).toBeVisible();
  });
});

import { Page, Locator } from '@playwright/test';

export class AppPage {
  readonly page: Page;
  readonly title: Locator;
  readonly generateRecipeButton: Locator;
  readonly inventorySection: Locator;
  readonly mealPlannerLink: Locator;
  readonly recipesLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.locator('h1, [data-testid="dashboard-title"]').first();
    this.generateRecipeButton = page.locator('button:has-text("Generar"), button:has-text("Crear")').first();
    this.inventorySection = page.locator('[data-testid="inventory-section"], :has-text("Inventario")').first();
    this.mealPlannerLink = page.locator('a[href="/meal-planner"], :has-text("Meal Planner")').first();
    this.recipesLink = page.locator('a[href="/recipes/search"], :has-text("Recetas")').first();
  }

  async goto(): Promise<void> {
    await this.page.goto('/app');
  }

  async navigateToMealPlanner(): Promise<void> {
    await this.mealPlannerLink.click();
  }

  async navigateToRecipes(): Promise<void> {
    await this.recipesLink.click();
  }
}

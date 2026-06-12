import { Page, Locator } from '@playwright/test';

export class RecipePage {
  readonly page: Page;
  readonly title: Locator;
  readonly generateButton: Locator;
  readonly ingredientsInput: Locator;
  readonly recipeResult: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.locator('h1:has-text("Recetas"), h1:has-text("Buscar")').first();
    this.generateButton = page.locator('button:has-text("Generar"), button:has-text("Crear receta")').first();
    this.ingredientsInput = page.locator('input[placeholder*="ingrediente"], textarea[placeholder*="ingrediente"]').first();
    this.recipeResult = page.locator('[data-testid="recipe-result"], :has-text("Pollo al horno")').first();
  }

  async goto(): Promise<void> {
    await this.page.goto('/recipes/search');
  }

  async addIngredient(ingredient: string): Promise<void> {
    await this.ingredientsInput.fill(ingredient);
  }

  async generateRecipe(): Promise<void> {
    await this.generateButton.click();
  }

  async getRecipeTitle(): Promise<string | null> {
    return this.recipeResult.textContent();
  }
}

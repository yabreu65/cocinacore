import { Page, Locator } from '@playwright/test';

export class MealPlannerPage {
  readonly page: Page;
  readonly title: Locator;
  readonly generateButton: Locator;
  readonly planResult: Locator;
  readonly periodSelector: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.locator('h1:has-text("Meal Planner"), h1:has-text("Planificador")').first();
    this.generateButton = page.locator('button:has-text("Generar"), button:has-text("Planificar")').first();
    this.planResult = page.locator('[data-testid="meal-plan-result"], :has-text("LUNES")').first();
    this.periodSelector = page.locator('select, [data-testid="period-selector"]').first();
  }

  async goto(): Promise<void> {
    await this.page.goto('/meal-planner');
  }

  async selectPeriod(period: string): Promise<void> {
    await this.periodSelector.selectOption(period);
  }

  async generatePlan(): Promise<void> {
    await this.generateButton.click();
  }

  async getPlanContent(): Promise<string | null> {
    return this.planResult.textContent();
  }
}

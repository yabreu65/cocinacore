import { Page, Locator } from '@playwright/test';

export class OwnerHealthPage {
  readonly page: Page;
  readonly title: Locator;
  readonly statusCards: Locator;
  readonly supabaseStatus: Locator;
  readonly redisStatus: Locator;
  readonly geminiStatus: Locator;
  readonly openrouterStatus: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.locator('h1:has-text("System Health"), h1:has-text("Estado")').first();
    this.statusCards = page.locator('[data-testid="status-card"]').or(page.locator('.status-card'));
    this.supabaseStatus = page.locator(':has-text("Supabase")').first();
    this.redisStatus = page.locator(':has-text("Redis")').first();
    this.geminiStatus = page.locator(':has-text("Gemini")').first();
    this.openrouterStatus = page.locator(':has-text("OpenRouter")').first();
  }

  async goto(): Promise<void> {
    await this.page.goto('/owner/system-health');
  }

  async getStatusCount(): Promise<number> {
    return this.statusCards.count();
  }
}

import { Page, Locator } from '@playwright/test';

export class OwnerHealthPage {
  readonly page: Page;
  readonly title: Locator;
  readonly statusCards: Locator;
  readonly postgresqlStatus: Locator;
  readonly redisStatus: Locator;
  readonly geminiStatus: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.getByRole('heading', { name: /System Health|Estado/i }).first();
    this.statusCards = page.getByTestId('status-card');
    this.postgresqlStatus = page.getByTestId('status-card').filter({ hasText: 'PostgreSQL' }).first();
    this.redisStatus = page.getByTestId('status-card').filter({ hasText: 'Redis' }).first();
    this.geminiStatus = page.getByTestId('status-card').filter({ hasText: 'Gemini' }).first();
  }

  async goto(): Promise<void> {
    await this.page.goto('/owner/system-health');
  }

  async getStatusCount(): Promise<number> {
    return this.statusCards.count();
  }
}
